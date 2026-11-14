"use client";

import type { MicVAD } from "@ricky0123/vad-web";

/**
 * Voice mode for the assistant: a hands-free conversation.
 *
 * - The microphone stays on. A speech detector (Silero VAD, running in the browser) notices
 *   when the patient starts and stops talking; about a second of silence ends their turn, a
 *   shorter pause doesn't.
 * - What they say is turned into text by the browser's speech recognition (in Chrome that's
 *   Google's service, in Edge Microsoft's: the patient agrees to that first) and sent as a
 *   normal chat message.
 * - The reply is read aloud as it's written (the browser's voices; the most natural one there
 *   is, e.g. Edge's "Online (Natural)" voices), a phrase or two at a time, one queued ahead so
 *   there are no gaps. No utterance is longer than MAX_CHUNK_CHARS: short sentences are
 *   merged up to it, a longer one is cut at a comma, a dash or a space (Chrome can stop a long
 *   utterance partway).
 * - Talking over it interrupts it, but only once the recogniser has heard real words that
 *   aren't the assistant's own (its voice comes out of the speakers and reaches the
 *   microphone; the browser's echo cancellation doesn't reliably remove speech-synthesis
 *   audio). "Stop speaking" silences a reply at once.
 * - Each reply is shown as text; whether its voice played, and played to the end, is tracked
 *   separately (ReplyOutcome). A spoken "yes" can confirm a booking only if the yes/no
 *   question was played to the end: every utterance of the reply (the question is its last
 *   part) started and finished, none failed, was cut off or cancelled, and none was skipped for
 *   want of a voice (`confirming` on the next turn). Otherwise the server asks it again, and a
 *   note says the card's button confirms.
 * - When the speech service's connection drops, it reconnects (a few tries a minute).
 * - It ends with the End button, closing the panel, leaving the tab, a video call starting,
 *   or two minutes of silence. Why each reply and each session ended is logged to the
 *   browser console ("[voice] …") for testing.
 */

export type VoiceLanguage = "ur" | "en";
export type VoiceState = "off" | "starting" | "listening" | "hearing" | "thinking" | "speaking" | "reconnecting";

/** The voices' language. */
const SPEECH_LANG: Record<VoiceLanguage, string> = { ur: "ur-PK", en: "en-IN" };
/** Recognition language codes to try, in order. Browsers' speech services differ: Chrome
 * (Google) takes ur-PK; Edge (Microsoft) refuses ur-PK — as a "network" error the moment it
 * starts — but takes ur-IN (still Urdu script). The one that works is remembered. */
const RECOGNITION_LANGS: Record<VoiceLanguage, string[]> = { ur: ["ur-PK", "ur-IN"], en: ["en-IN", "en-US"] };
const RECOGNITION_LANG_KEY = "mc_voice_recognition_lang_"; // + language: the code that worked here
const REFUSED_WITHIN_MS = 4000; // a "network" error this soon after starting, before any words: the code is refused

function rememberedRecognitionLang(language: VoiceLanguage): string | null {
  try {
    const code = window.localStorage.getItem(RECOGNITION_LANG_KEY + language);
    return code && RECOGNITION_LANGS[language].includes(code) ? code : null;
  } catch {
    return null;
  }
}

function rememberRecognitionLang(language: VoiceLanguage, code: string) {
  try {
    window.localStorage.setItem(RECOGNITION_LANG_KEY + language, code);
  } catch {
    // not remembered
  }
}
const SILENCE_END_MS = 900; // a pause this long (plus the detector's own frames, ~1 s) ends the turn
const MIN_SPEECH_MS = 300; // shorter sounds (a cough, a click) aren't speech to the detector
const BUSY_MIN_SPEECH_MS = 450; // ...and while the assistant talks, a bit longer
const TEXT_END_MS = 1500; // when the detector hears nothing (quiet or very short speech): the recogniser's pause
const IDLE_END_MS = 120_000;
const ECHO_WINDOW_MS = 2500; // its own voice can still come back through the microphone this long after
const VOICED_WINDOW_MS = 2000; // an interruption needs the detector to have heard speech this recently
const RECONNECT_WINDOW_MS = 60_000;
const MAX_RECONNECTS = 4; // connection drops per minute before giving up
export const MAX_CHUNK_CHARS = 180; // per utterance (Chrome can stall on long ones)
const MIN_PIECE_CHARS = 40; // a long sentence isn't cut where it would leave a shorter scrap (except at a space)
const LOG_LIMIT = 100;

/** Said on its own over the assistant's voice, these stop it ("ruko", "bas", "stop"…). */
const STOP_WORDS = new Set(["stop", "wait", "ruko", "ruk", "rukein", "bas", "رکو", "رکیں", "روکو", "بس", "ٹھہرو", "ٹھہریں"]);

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Chrome and Edge (desktop and Android). Not Firefox (no speech recognition) and not
 * iPhone/iPad for now (untested there). */
export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return (
    !apple &&
    !/Firefox\//.test(ua) &&
    recognitionCtor() !== null &&
    !!navigator.mediaDevices?.getUserMedia &&
    "speechSynthesis" in window
  );
}

const isEdge = () => typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Recent events, newest last (for testing on real devices: `[voice]` in the console). */
export const voiceLog: string[] = [];
function log(message: string) {
  voiceLog.push(`${new Date().toLocaleTimeString()} ${message}`);
  if (voiceLog.length > LOG_LIMIT) voiceLog.shift();
  console.info(`[voice] ${message}`);
}

// ---- how things are said

const EN_DAYS: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
const UR_DAYS: Record<string, string> = {
  Mon: "پیر", Tue: "منگل", Wed: "بدھ", Thu: "جمعرات", Fri: "جمعہ", Sat: "ہفتہ", Sun: "اتوار",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];
const UR_MONTHS = ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"];

function urduTime(hour24: number, minute: number): string {
  const part = hour24 >= 4 && hour24 < 12 ? "صبح" : hour24 < 16 && hour24 >= 12 ? "دوپہر" : hour24 >= 16 && hour24 < 19 ? "شام" : "رات";
  const hour = hour24 % 12 || 12;
  return minute ? `${part} ${hour} بج کر ${minute} منٹ` : `${part} ${hour} بجے`;
}

/** The reply as it should be read aloud: no markdown or symbols; "Dr" as "Doctor"; fees as
 * rupees; "Fri 13 Nov, 7:00 PM" as words, in Urdu when the voice is Urdu. */
export function spokenText(raw: string, language: VoiceLanguage): string {
  const ur = language === "ur";
  let t = raw
    .replace(/\[interrupted\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/^[\s>*#-]+/gm, "")
    .replace(/[*_#`~]/g, "")
    .replace(/([^.!?۔؟:,،\s])[ \t]*\n+/g, ur ? "$1۔ " : "$1. ") // a line without an ending: a full stop (a pause)
    .replace(/\n+/g, " ");
  t = t.replace(/\bDr\.?(?=\s)/g, ur ? "ڈاکٹر" : "Doctor");
  // Fees: "Rs. 2,000", "PKR 3,000", "3,000 PKR", "Rs2000".
  const rupees = ur ? "روپے" : "rupees";
  t = t
    .replace(/\b(?:Rs\.?|PKR)\s*(\d[\d,]*)/gi, (_, n: string) => `${n.replace(/,/g, "")} ${rupees}`)
    .replace(/(\d[\d,]*)\s*(?:PKR|Rs\b\.?)/gi, (_, n: string) => `${n.replace(/,/g, "")} ${rupees}`);
  // Times: "7:00 PM", "9:30 am", "11 AM".
  t = t.replace(/\b(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s?[Mm]\b\.?/g, (_, h: string, m: string | undefined, ap: string) => {
    const hour = Number(h);
    const minute = Number(m ?? 0);
    const pm = ap.toLowerCase() === "p";
    if (ur) return urduTime((hour % 12) + (pm ? 12 : 0), minute);
    return `${hour}${minute ? `:${m}` : ""} ${pm ? "PM" : "AM"}`;
  });
  // Short day and month names.
  t = t.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b\.?/g, (d: string) => (ur ? UR_DAYS : EN_DAYS)[d.slice(0, 3)]);
  t = t.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b\.?/g, (m: string) => {
    const i = MONTHS.indexOf(m.slice(0, 3));
    return (ur ? UR_MONTHS : EN_MONTHS)[i];
  });
  t = t
    .replace(/(\d),(?=\d{3}\b)/g, "$1") // 2,000 → 2000 (some voices read the comma)
    .replace(/\s*&\s*/g, ur ? " اور " : " and ")
    .replace(/\s*[()[\]{}]\s*/g, ", ") // brackets read as pauses
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+([,.!?؟۔،])/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/[,،]+([.!?؟۔])/g, "$1");
  return t.replace(/^[,\s]+|[,\s]+$/g, "").replace(/\s+/g, " ").trim();
}

function voiceScore(v: SpeechSynthesisVoice, lang: string): number {
  const tag = v.lang.replace("_", "-").toLowerCase();
  const want = lang.toLowerCase();
  let score = tag === want ? 10 : tag.startsWith(want.slice(0, 2)) ? 6 : -1000;
  if (/natural|neural|online/i.test(v.name)) score += 5; // Edge's Microsoft voices: far less robotic
  if (/google/i.test(v.name)) score += 2;
  if (v.default) score += 1;
  return score;
}

const naturalVoice = (v: SpeechSynthesisVoice) => /natural|neural|online/i.test(v.name);

// ---- utterances

/** Where a long sentence may be cut, best first: after a comma; after a semicolon or colon;
 * after a dash. The ASCII marks count only before a space (so "2,000", "10:30" and
 * "follow-up" are never cut); Urdu's "،" and "؛", and an em dash, always end a word. Failing
 * all of these: at a space. */
const CUTS = [/,(?= )|،/g, /[;:](?= )|؛/g, / -(?= )|—|–(?= )/g];

function cutPoint(text: string, max: number): number {
  for (const cut of CUTS) {
    let best = -1;
    for (const m of text.matchAll(cut)) {
      const end = m.index + m[0].length;
      if (end > max) break;
      if (end >= MIN_PIECE_CHARS) best = end;
    }
    if (best > 0) return best;
  }
  const space = text.lastIndexOf(" ", max);
  if (space > 0) return space;
  return text.indexOf(" ", max); // a word running past the limit: cut after it (-1: no space left)
}

/** A sentence as pieces of at most `max` characters, each cut at the best place within the
 * limit (see CUTS): never inside a word, so a single word longer than `max` stays whole.
 * Expects spokenText's output (plain spaces only). */
export function splitSentence(text: string, max = MAX_CHUNK_CHARS): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = cutPoint(rest, max);
    if (cut <= 0) break;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Takes the next utterance from `waiting`: its first piece, merged with as many of the
 * following ones as fit in `max` characters. */
export function nextUtterance(waiting: string[], max = MAX_CHUNK_CHARS): string {
  let chunk = waiting.shift() ?? "";
  while (waiting.length && chunk.length + 1 + waiting[0].length <= max) chunk += ` ${waiting.shift()}`;
  return chunk;
}

/** What became of one reply's voice. */
export interface ReplyOutcome {
  /** It had something to say (the chat shows the text either way). */
  displayed: boolean;
  /** Some of it was heard: an utterance started playing. */
  played: boolean;
  /** All of it was played to the end: every utterance started and got `end`; none failed, was
   * cut off or cancelled, and none was skipped for want of a voice. */
  complete: boolean;
  /** Why it isn't complete (null when it is). */
  problem: string | null;
}

/** For the log. */
function describeOutcome(o: ReplyOutcome): string {
  if (!o.displayed) return "nothing to read aloud";
  if (o.complete) return "shown, played to the end";
  return `shown, ${o.played ? "played in part" : "not played"} (${o.problem})`;
}

interface SpeakerEvents {
  /** An utterance of the current reply started playing. */
  onStart: () => void;
  /** The voice chosen for the language (null: none), once the browser's list has loaded. */
  onVoice: (voice: SpeechSynthesisVoice | null) => void;
  /** An utterance failed to play; `recovered`: it's being said again with another voice. */
  onError: (reason: string, recovered: boolean) => void;
}

/** Reads a reply aloud as it arrives: complete sentences are queued (a long one cut into
 * pieces, several short ones merged into one utterance, none over MAX_CHUNK_CHARS), and one
 * is always handed to the browser ahead so the next starts without a gap. Keeps track of
 * whether the reply was played, and played to the end (ReplyOutcome). Exported for checks. */
export class Speaker {
  private buffer = ""; // the sentence being written
  private waiting: string[] = []; // complete sentences (or pieces) not yet handed to the browser
  private pending = 0; // utterances handed to the browser and not finished
  private ended = true;
  // This reply so far: it had text; some of it started playing; the first reason not all of
  // it was heard (null: none yet).
  private displayed = false;
  private played = false;
  private problem: string | null = null;
  private generation = 0;
  private idleWaiters: ((outcome: ReplyOutcome) => void)[] = [];
  // Utterances being played or queued, kept referenced: Chrome drops the events of an
  // utterance it has garbage-collected, and the bookkeeping depends on every `end`.
  private live = new Set<SpeechSynthesisUtterance>();
  private voice: SpeechSynthesisVoice | null = null;
  private failedVoices = new Set<string>();
  private language: VoiceLanguage = "ur";
  private lang = "ur-PK";
  /** What it said recently (to recognise its own voice coming back through the microphone). */
  recent = "";
  lastSpokeAt = 0;

  constructor(
    language: VoiceLanguage,
    private events: SpeakerEvents,
  ) {
    this.setLanguage(language);
    window.speechSynthesis.addEventListener?.("voiceschanged", this.pickVoice);
  }

  dispose() {
    window.speechSynthesis.removeEventListener?.("voiceschanged", this.pickVoice);
    this.cancel();
  }

  setLanguage(language: VoiceLanguage) {
    this.language = language;
    this.lang = SPEECH_LANG[language];
    this.pickVoice();
  }

  private pickVoice = () => {
    const voices = window.speechSynthesis.getVoices().filter((v) => !this.failedVoices.has(v.voiceURI));
    const best = voices
      .map((v) => ({ v, score: voiceScore(v, this.lang) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    this.voice = best?.v ?? null;
    // Voices load late in Chrome; only report once the list has arrived.
    if (window.speechSynthesis.getVoices().length) this.events.onVoice(this.voice);
  };

  begin() {
    this.buffer = "";
    this.waiting = [];
    this.ended = false;
    this.displayed = false;
    this.played = false;
    this.problem = null;
  }

  /** The voice for the language was found (false: replies are text only). */
  get hasVoice() {
    return this.voice !== null;
  }

  feed(text: string) {
    this.buffer += text;
    // A sentence is complete at . ! ? ۔ ؟ followed by a space, or at a line break.
    let match: RegExpExecArray | null;
    while ((match = /[.!?۔؟]+(?=\s)|\n+/.exec(this.buffer))) {
      const end = match.index + match[0].length;
      this.queue(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
    }
    this.pump();
  }

  end() {
    this.ended = true;
    this.queue(this.buffer);
    this.buffer = "";
    this.pump();
    this.settle();
  }

  private queue(raw: string) {
    const text = spokenText(raw, this.language);
    if (!text) return;
    this.displayed = true;
    this.waiting.push(...splitSentence(text));
  }

  /** Keep one utterance playing and one queued; merge what's waiting beyond that. */
  private pump() {
    while (this.pending < 2 && this.waiting.length) this.say(nextUtterance(this.waiting));
  }

  /** Part of this reply won't be heard: the reply isn't complete (the first reason is kept). */
  private miss(reason: string) {
    if (this.problem === null) this.problem = reason;
  }

  private say(text: string, retry = false) {
    if (!this.voice) {
      // No voice for the language: this part is shown as text only.
      this.miss(`no ${this.language === "ur" ? "Urdu" : "English"} voice`);
      return;
    }
    const generation = this.generation;
    const voice = this.voice;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.lang;
    utterance.voice = voice;
    let started = false;
    const finish = () => {
      this.live.delete(utterance);
      this.pending = Math.max(0, this.pending - 1);
      this.lastSpokeAt = Date.now();
      this.pump();
      this.settle();
    };
    utterance.onstart = () => {
      if (generation !== this.generation) return;
      started = true;
      this.played = true;
      this.events.onStart();
    };
    utterance.onend = () => {
      if (generation !== this.generation) return;
      if (!started) this.miss("an utterance ended without playing");
      finish();
    };
    utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (generation !== this.generation) return;
      if (e.error === "interrupted" || e.error === "canceled") {
        // Not cancel() (that changes the generation first): the browser or the system stopped it.
        this.miss(`${e.error} by the browser`);
        this.events.onError(`${e.error} by the browser`, false);
        return finish();
      }
      // An online voice that failed (e.g. its connection dropped): say it again with the next one.
      const recover = !retry && !voice.localService;
      if (recover) {
        this.failedVoices.add(voice.voiceURI);
        this.pickVoice();
      }
      this.events.onError(e.error, recover && this.voice !== null);
      if (recover && this.voice) {
        this.live.delete(utterance);
        this.pending = Math.max(0, this.pending - 1);
        this.say(text, true);
        return;
      }
      this.miss(`playback error: ${e.error}`);
      finish();
    };
    this.pending += 1;
    this.live.add(utterance);
    this.recent = `${this.recent} ${text}`.slice(-800);
    this.lastSpokeAt = Date.now();
    window.speechSynthesis.speak(utterance);
  }

  /** The reply's voice so far (all of it once idle() has resolved, or after cancel()). */
  outcome(): ReplyOutcome {
    const problem =
      this.problem ?? (!this.displayed ? "nothing to say" : !this.played ? "not played" : null);
    return { displayed: this.displayed, played: this.played, complete: problem === null, problem };
  }

  private settle() {
    if (this.ended && this.pending === 0 && this.waiting.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      const outcome = this.outcome();
      waiters.forEach((w) => w(outcome));
    }
  }

  /** Resolves when everything fed so far has been said, or cancelled, with what became of it. */
  idle(): Promise<ReplyOutcome> {
    if (this.ended && this.pending === 0 && this.waiting.length === 0) return Promise.resolve(this.outcome());
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Audio of the reply is playing (or about to). */
  get playing() {
    return this.pending > 0;
  }

  cancel() {
    if (!this.ended || this.pending || this.waiting.length) this.miss("cancelled");
    this.generation += 1;
    this.pending = 0;
    this.live.clear();
    this.waiting = [];
    this.buffer = "";
    this.ended = true;
    window.speechSynthesis.cancel();
    this.settle();
  }

  /** It is talking, or was moments ago (so the microphone may still be picking it up). */
  get echoing() {
    return this.playing || Date.now() - this.lastSpokeAt < ECHO_WINDOW_MS;
  }

  recentWords(): Set<string> {
    return new Set(words(this.recent));
  }

  /** Recognised text that is (mostly) what it just said: its own voice, not the patient's.
   * A short answer once it has stopped talking is always the patient's — "yes" right after
   * "…please say yes or no" is an answer, not an echo. */
  isEcho(text: string): boolean {
    if (!this.echoing) return false;
    const heard = words(text);
    if (!heard.length) return true;
    if (!this.playing && heard.length < 3) return false;
    const said = this.recentWords();
    return heard.filter((w) => said.has(w)).length / heard.length >= (this.playing ? 0.6 : 0.8);
  }
}

export interface VoiceTurnRequest {
  text: string;
  /** The proposal whose yes/no question was heard to the end (only then may "yes" confirm it). */
  confirming: number | null;
  /** The reply's text, as it streams. */
  onText: (text: string) => void;
  signal: AbortSignal;
}

export interface VoiceCallbacks {
  onState: (state: VoiceState) => void;
  /** What is being heard right now (live caption), "" when nothing. */
  onCaption: (text: string) => void;
  /** A note to show (e.g. no voice for the language on this device), or null. */
  onNotice: (text: string | null) => void;
  /** Voice mode stopped by itself; `message` says why (null: ended normally). */
  onStopped: (message: string | null) => void;
  /** Send what the patient said. Resolves when the reply is complete, with the proposal its
   * yes/no question is about (if it ends with one); rejects (or resolves) after `signal` aborts. */
  sendTurn: (request: VoiceTurnRequest) => Promise<{ voiceConfirm: number | null }>;
}

export class VoiceSession {
  private state: VoiceState = "off";
  private vad: MicVAD | null = null;
  private recognition: Recognition | null = null;
  private recognitionRunning = false;
  private flushed: (() => void) | null = null;
  private heard: string[] = [];
  private interim = "";
  private turn: AbortController | null = null; // the reply being written / read
  private muted: AbortController | null = null; // a reply silenced with "Stop speaking"
  private armed: number | null = null; // the proposal whose question was heard to the end
  private finishing = false;
  private vadSpeaking = false; // the detector hears speech right now
  private vadHeardAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private networkErrors: number[] = [];
  private recognitionLang = ""; // the code recognition runs with (see RECOGNITION_LANGS)
  private recognitionStartedAt = 0;
  private recognitionGotWords = false; // since this recognition started
  private recognitionLangConfirmed = false;
  private retryDelay = 0;
  private voiceNote: string | null = null;
  private replyNote = false; // the notice shown is about the last reply (see showReplyNote)
  private speaker: Speaker;
  private stopped = false;

  constructor(
    private language: VoiceLanguage,
    private cb: VoiceCallbacks,
  ) {
    this.speaker = new Speaker(language, {
      onStart: () => {
        if (this.turn && this.muted !== this.turn && (this.state === "thinking" || this.state === "speaking")) {
          this.setState("speaking");
        }
      },
      onVoice: (voice) => {
        if (voice) log(`voice for ${this.language}: ${voice.name} (${voice.lang}${voice.localService ? ", on device" : ", online"})`);
        else log(`no voice for ${this.language}: replies are text only`);
        this.voiceNote = !voice
          ? this.noVoiceNote()
          : this.language === "ur" && !naturalVoice(voice) && !isEdge()
            ? "Tip: Microsoft Edge has a more natural Urdu voice."
            : null;
        this.replyNote = false;
        this.cb.onNotice(this.voiceNote);
      },
      onError: (reason, recovered) => {
        log(`voice playback error: ${reason}${recovered ? " (trying another voice)" : ""}`);
        if (!recovered) this.showReplyNote(`Part of the reply couldn't be played aloud (${reason}). It's shown as text.`);
      },
    });
  }

  private noVoiceNote() {
    return this.language === "ur"
      ? "This device has no Urdu voice, so replies are shown as text only. You can still talk, or switch to English."
      : "This device has no English voice, so replies are shown as text only.";
  }

  /** The yes/no question wasn't played to the end, so a spoken yes won't confirm it. */
  private unheardQuestionNote() {
    return this.speaker.hasVoice
      ? "The yes/no question wasn't played to the end, so saying yes will repeat it first. To confirm now, press the button on the card."
      : "Replies can't be read aloud here, so saying yes can't confirm. Press the button on the card to confirm.";
  }

  /** A note about the last reply: shown until the next turn, then the voice's own note is back. */
  private showReplyNote(text: string) {
    this.replyNote = true;
    this.cb.onNotice(text);
  }

  private clearReplyNote() {
    if (!this.replyNote) return;
    this.replyNote = false;
    this.cb.onNotice(this.voiceNote);
  }

  private setState(state: VoiceState) {
    if (this.stopped && state !== "off") return;
    this.state = state;
    this.cb.onState(state);
    // While it talks (or is about to), speech has to be clearer to count.
    const busy = state === "speaking" || state === "thinking";
    this.vad?.setOptions({
      positiveSpeechThreshold: busy ? 0.7 : 0.5,
      negativeSpeechThreshold: busy ? 0.55 : 0.35,
      minSpeechMs: busy ? BUSY_MIN_SPEECH_MS : MIN_SPEECH_MS,
    });
  }

  async start() {
    this.setState("starting");
    log("session starting");
    try {
      const { MicVAD } = await import("@ricky0123/vad-web");
      if (this.stopped) return;
      this.vad = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        ortConfig: (ort) => {
          ort.env.logLevel = "error";
          ort.env.wasm.numThreads = 1; // no cross-origin isolation needed
        },
        getStream: async () => {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          // What the browser actually turned on (it may ignore a request on some devices).
          const s = stream.getAudioTracks()[0]?.getSettings();
          if (s) log(`microphone: echo cancellation ${s.echoCancellation}, noise suppression ${s.noiseSuppression}, auto gain ${s.autoGainControl}`);
          return stream;
        },
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: SILENCE_END_MS,
        minSpeechMs: MIN_SPEECH_MS,
        preSpeechPadMs: 200,
        startOnLoad: false,
        onSpeechStart: () => this.onSpeechStart(),
        onSpeechRealStart: () => this.onSpeechRealStart(),
        onSpeechEnd: () => this.onSpeechEnd(),
        onVADMisfire: () => this.onMisfire(),
      });
      if (this.stopped) {
        await this.vad.destroy();
        return;
      }
      await this.vad.start();
      this.startRecognition();
      this.setState("listening");
      this.armIdle();
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      this.stop(
        denied
          ? "Microphone access was blocked. Allow the microphone for this site to use voice mode."
          : "Voice mode couldn't start on this device.",
        denied ? "microphone blocked" : `couldn't start (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  /** End voice mode. `message` is shown to the patient (null: nothing to say); `reason` is logged. */
  stop(message: string | null = null, reason = "ended") {
    if (this.stopped) return;
    log(`session stopped: ${reason}`);
    this.stopped = true;
    if (this.turn) log("reply ended: voice mode stopped");
    this.turn?.abort();
    this.turn = null;
    this.speaker.dispose();
    this.clearTimers();
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onstart = null;
      this.recognition.abort();
      this.recognition = null;
    }
    void this.vad?.destroy();
    this.vad = null;
    this.state = "off";
    this.cb.onState("off");
    this.cb.onCaption("");
    this.cb.onStopped(message);
  }

  setLanguage(language: VoiceLanguage) {
    this.language = language;
    this.recognitionLang = "";
    this.recognitionLangConfirmed = false;
    this.speaker.setLanguage(language);
    this.restartRecognition();
  }

  private chooseRecognitionLang(): string {
    if (!this.recognitionLang) {
      this.recognitionLang = rememberedRecognitionLang(this.language) ?? RECOGNITION_LANGS[this.language][0];
      log(`speech recognition language: ${this.recognitionLang}`);
    }
    return this.recognitionLang;
  }

  /** The browser refused the recognition language: the next code to try, or null. */
  private nextRecognitionLang(): string | null {
    const codes = RECOGNITION_LANGS[this.language];
    const next = codes[codes.indexOf(this.recognitionLang) + 1];
    return next ?? null;
  }

  /** Silence the reply now (its text still arrives in the chat) and listen. */
  stopSpeaking() {
    if (!this.turn || this.muted === this.turn) return;
    this.muted = this.turn;
    this.speaker.cancel();
    log(`reply voice stopped: Stop speaking pressed; ${describeOutcome(this.speaker.outcome())}`);
    this.heard = [];
    this.interim = "";
    this.setState("listening");
    this.armIdle();
  }

  // ---- speech detection (the detector decides when a turn ends, whenever it hears the speech)

  private onSpeechStart() {
    this.vadSpeaking = true;
    this.vadHeardAt = Date.now();
    this.armIdle();
    if (this.state === "listening") this.setState("hearing");
  }

  private onSpeechRealStart() {
    // Not an interruption by itself (it may be the assistant's own voice): that takes words.
    this.vadHeardAt = Date.now();
    this.armIdle();
    if (this.state === "listening") this.setState("hearing");
  }

  private onSpeechEnd() {
    this.vadSpeaking = false;
    this.vadHeardAt = Date.now();
    if (this.endTimer) clearTimeout(this.endTimer);
    void this.finishTurn();
  }

  private onMisfire() {
    this.vadSpeaking = false;
    // Too short for the detector ("ji"): if the recogniser caught words, its pause ends the turn.
    if (this.heardText()) this.planTextEnd();
    else if (this.state === "hearing") this.setState("listening");
  }

  // ---- speech recognition

  private startRecognition() {
    const Ctor = recognitionCtor();
    if (!Ctor || this.stopped || this.recognitionRunning) return;
    const recognition = new Ctor();
    recognition.lang = this.chooseRecognitionLang();
    this.recognitionStartedAt = Date.now();
    this.recognitionGotWords = false;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => this.onResult(e);
    recognition.onerror = (e) => this.onRecognitionError(e.error);
    recognition.onstart = () => this.onRecognitionStart();
    recognition.onend = () => {
      this.recognitionRunning = false;
      if (this.flushed) {
        const done = this.flushed;
        this.flushed = null;
        done();
      } else if (!this.stopped) {
        // Chrome ends recognition after a while of silence or a dropped connection: carry on
        // (after a growing wait when the connection keeps dropping).
        const delay = this.retryDelay || 250;
        this.retryDelay = 0;
        setTimeout(() => this.startRecognition(), delay);
      }
    };
    this.recognition = recognition;
    try {
      recognition.start();
      this.recognitionRunning = true;
    } catch {
      // already starting
    }
  }

  private restartRecognition() {
    if (!this.recognition) return;
    this.recognition.onend = () => {
      this.recognitionRunning = false;
      this.startRecognition();
    };
    this.recognition.abort();
  }

  /** Stop recognition so it delivers its last words, and wait for it (at most 1.5 s). */
  private flushRecognition(): Promise<void> {
    if (!this.recognition || !this.recognitionRunning) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.flushed = null;
        resolve();
      }, 1500);
      this.flushed = () => {
        clearTimeout(timer);
        resolve();
      };
      this.recognition!.stop();
    });
  }

  private onRecognitionStart() {
    if (this.state !== "reconnecting") return;
    // Back once it has run a few seconds without the connection dropping again.
    const startedAt = Date.now();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      const last = this.networkErrors[this.networkErrors.length - 1] ?? 0;
      if (this.state === "reconnecting" && last < startedAt) {
        log("speech service reconnected");
        this.setState("listening");
      }
    }, 3000);
  }

  private onResult(e: RecognitionEvent) {
    if (!this.recognitionLangConfirmed) {
      this.recognitionLangConfirmed = true;
      rememberRecognitionLang(this.language, this.recognitionLang);
    }
    this.recognitionGotWords = true;
    const finals: string[] = [];
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const result = e.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;
      if (result.isFinal) finals.push(text);
      else interim += `${text} `;
    }
    if (this.state === "reconnecting") {
      log("speech service reconnected");
      this.setState("listening");
    }
    if (this.state === "thinking" || this.state === "speaking") {
      // While it answers, the microphone mostly hears its own voice: only real words from the
      // patient interrupt it.
      if (!this.isInterruption([...finals, interim].join(" "))) return;
      this.bargeIn();
    }
    for (const text of finals) if (!this.speaker.isEcho(text)) this.heard.push(text);
    this.interim = this.speaker.isEcho(interim) ? "" : interim.trim();
    const caption = this.heardText();
    if (!caption) return;
    this.cb.onCaption(caption);
    this.armIdle();
    if (this.state === "listening") this.setState("hearing");
    this.planTextEnd();
  }

  /** Words the patient said over the reply: the detector heard speech just now, and the
   * recogniser has two or more words the assistant didn't just say, or a word like "ruko".
   * When it isn't talking (still thinking, nothing recent to echo), any words will do. */
  private isInterruption(text: string): boolean {
    const heard = words(text);
    if (!heard.length) return false;
    if (!this.vadSpeaking && Date.now() - this.vadHeardAt > VOICED_WINDOW_MS) return false;
    if (!this.speaker.echoing) return true;
    const said = this.speaker.recentWords();
    const fresh = heard.filter((w) => !said.has(w));
    return fresh.length >= 2 || fresh.some((w) => STOP_WORDS.has(w));
  }

  private bargeIn() {
    this.speaker.cancel();
    log(`reply ended: the patient spoke over it; ${describeOutcome(this.speaker.outcome())}`);
    this.turn?.abort();
    this.turn = null;
    this.armed = null;
    this.heard = [];
    this.interim = "";
    this.setState("hearing");
  }

  /** The recogniser's text ends the turn after a pause, but only when the detector isn't
   * hearing speech (then its own end of speech decides). */
  private planTextEnd() {
    if (this.endTimer) clearTimeout(this.endTimer);
    if (this.vadSpeaking) return;
    this.endTimer = setTimeout(() => !this.vadSpeaking && void this.finishTurn(), TEXT_END_MS);
  }

  private onRecognitionError(error: string) {
    if (error === "not-allowed" || error === "service-not-allowed") {
      this.stop("Speech recognition is blocked. Allow the microphone for this site to use voice mode.", "recognition blocked");
    } else if (
      (error === "network" || error === "language-not-supported") &&
      !this.recognitionLangConfirmed &&
      !this.recognitionGotWords &&
      Date.now() - this.recognitionStartedAt < REFUSED_WITHIN_MS &&
      this.nextRecognitionLang()
    ) {
      // Refused at once, with a language code that has never worked here: try the next code.
      const next = this.nextRecognitionLang()!;
      log(`speech recognition refused ${this.recognitionLang} (${error} at once); trying ${next}`);
      this.recognitionLang = next;
      this.retryDelay = 250;
    } else if (error === "network") {
      const now = Date.now();
      this.networkErrors = [...this.networkErrors.filter((t) => now - t < RECONNECT_WINDOW_MS), now];
      const tries = this.networkErrors.length;
      if (tries > MAX_RECONNECTS) {
        this.stop(
          "Voice mode stopped: the connection to the speech service keeps dropping. Check your internet and try again.",
          "connection lost",
        );
        return;
      }
      log(`speech service connection lost, reconnecting (try ${tries} of ${MAX_RECONNECTS})`);
      this.retryDelay = 1000 * 2 ** (tries - 1);
      if (!this.turn && (this.state === "listening" || this.state === "hearing")) this.setState("reconnecting");
    } else if (error === "language-not-supported") {
      this.stop(`This browser can't recognise ${this.language === "ur" ? "Urdu" : "English"} speech.`, "language not supported");
    } else if (error !== "no-speech" && error !== "aborted") {
      log(`speech recognition error: ${error} (restarting)`);
    }
    // "no-speech", "aborted", "audio-capture": recognition simply restarts.
  }

  private heardText() {
    return [...this.heard, this.interim].join(" ").replace(/\s+/g, " ").trim();
  }

  // ---- turns

  private async finishTurn() {
    if (this.finishing || this.stopped || (this.state !== "hearing" && this.state !== "listening")) return;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.finishing = true;
    try {
      await this.flushRecognition();
      const text = this.heardText();
      this.heard = [];
      this.interim = "";
      this.startRecognition(); // keep listening, for an interruption
      this.cb.onCaption("");
      if (!text) {
        this.setState("listening");
        return;
      }
      void this.ask(text);
    } finally {
      this.finishing = false;
    }
  }

  private async ask(text: string) {
    if (this.turn) {
      // A silenced reply still being written: the new turn replaces it.
      log("reply ended: replaced by the patient's next turn");
      this.turn.abort();
      this.muted = null;
    }
    const confirming = this.armed;
    this.armed = null;
    this.clearReplyNote();
    const controller = new AbortController();
    this.turn = controller;
    this.setState("thinking");
    this.speaker.begin();
    let voiceConfirm: number | null = null;
    try {
      ({ voiceConfirm } = await this.cb.sendTurn({
        text,
        confirming,
        signal: controller.signal,
        onText: (piece) => {
          if (this.turn === controller && this.muted !== controller) this.speaker.feed(piece);
        },
      }));
    } catch {
      // aborted (interrupted) or failed (the chat shows the error)
    }
    if (this.turn !== controller) return; // interrupted: a new turn has taken over
    const muted = this.muted === controller;
    if (!muted) this.speaker.end();
    const outcome = muted ? this.speaker.outcome() : await this.speaker.idle();
    if (this.turn !== controller) return;
    this.turn = null;
    if (muted) this.muted = null;
    // A spoken "yes" may confirm only a question played to the end: the question is the last
    // part of the reply, and all of the reply was played (shown, or partly played, isn't enough).
    const complete = !muted && outcome.complete;
    this.armed = voiceConfirm !== null && complete ? voiceConfirm : null;
    if (!muted) log(`reply ended: finished; ${describeOutcome(outcome)}`);
    if (voiceConfirm !== null && complete) log(`waiting for yes/no to proposal ${voiceConfirm} (question played to the end)`);
    else if (voiceConfirm !== null) {
      log(`yes/no question to proposal ${voiceConfirm} not played to the end (${muted ? "Stop speaking" : outcome.problem}): a spoken yes will ask it again; the card's button confirms`);
      this.showReplyNote(this.unheardQuestionNote());
    }
    // (After "Stop speaking" it's already listening, and may be hearing the patient.)
    if (this.state === "thinking" || this.state === "speaking") this.setState("listening");
    this.armIdle();
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.state === "listening") this.stop("Voice mode ended after two minutes of silence.", "two minutes of silence");
      else this.armIdle();
    }, IDLE_END_MS);
  }

  private clearTimers() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }
}
