"use client";

import type { MicVAD } from "@ricky0123/vad-web";

/**
 * Voice mode for the assistant: a hands-free conversation.
 *
 * - The microphone stays on. A speech detector (Silero VAD, running in the browser) notices
 *   when the patient starts and stops talking; about a second of silence ends their turn, a
 *   shorter pause doesn't.
 * - What they say is turned into text by the browser's speech recognition (in Chrome that's
 *   Google's service: the patient agrees to that first) and sent as a normal chat message.
 * - The reply is read aloud sentence by sentence as it's written (the browser's own voices).
 * - Talking over it (barge-in) stops the voice at once and cancels the reply being written.
 * - It ends with the End button, closing the panel, leaving the tab, a video call starting,
 *   or two minutes of silence.
 *
 * The assistant's own voice comes out of the speakers and can reach the microphone, so
 * while it speaks the detector needs louder, longer speech to count as an interruption, and
 * recognised text that matches what it just said is ignored.
 */

export type VoiceLanguage = "ur" | "en";
export type VoiceState = "off" | "starting" | "listening" | "hearing" | "thinking" | "speaking";

const RECOGNITION_LANG: Record<VoiceLanguage, string> = { ur: "ur-PK", en: "en-IN" };
const SILENCE_END_MS = 900; // a pause this long (plus the detector's own frames, ~1 s) ends the turn
const MIN_SPEECH_MS = 300; // shorter sounds (a cough, a click) aren't a turn or an interruption
const BARGE_IN_MIN_SPEECH_MS = 450; // ...and while the assistant talks, a bit longer
const FALLBACK_END_MS = 1800; // if the detector missed quiet speech, the recogniser's text still ends the turn
const IDLE_END_MS = 120_000;
const ECHO_WINDOW_MS = 2500;

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

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Reads text aloud as it arrives, one sentence at a time. */
class Speaker {
  private buffer = "";
  private pending = 0;
  private ended = true;
  private generation = 0;
  private idleWaiters: (() => void)[] = [];
  private voice: SpeechSynthesisVoice | null = null;
  private lang = "ur-PK";
  /** What it said recently (to recognise its own voice coming back through the microphone). */
  recent = "";
  lastSpokeAt = 0;

  constructor(
    language: VoiceLanguage,
    private onStart: () => void,
    private onNoVoice: (missing: boolean) => void,
  ) {
    this.setLanguage(language);
    window.speechSynthesis.addEventListener?.("voiceschanged", this.pickVoice);
  }

  dispose() {
    window.speechSynthesis.removeEventListener?.("voiceschanged", this.pickVoice);
    this.cancel();
  }

  setLanguage(language: VoiceLanguage) {
    this.lang = language === "ur" ? "ur-PK" : "en-IN";
    this.pickVoice();
  }

  private pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const prefix = this.lang.slice(0, 2);
    this.voice =
      voices.find((v) => v.lang.replace("_", "-") === this.lang) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ??
      null;
    // Voices load late in Chrome; only say one is missing once the list has arrived.
    if (voices.length) this.onNoVoice(this.voice === null);
  };

  get available() {
    return this.voice !== null || window.speechSynthesis.getVoices().length === 0;
  }

  begin() {
    this.buffer = "";
    this.ended = false;
  }

  feed(text: string) {
    this.buffer += text;
    // A sentence is complete at . ! ? ۔ ؟ followed by a space, or at a line break.
    let match: RegExpExecArray | null;
    while ((match = /[.!?۔؟]+(?=\s)|\n+/.exec(this.buffer))) {
      const end = match.index + match[0].length;
      this.say(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
    }
  }

  end() {
    this.ended = true;
    this.say(this.buffer);
    this.buffer = "";
    this.settle();
  }

  private say(raw: string) {
    const text = raw
      .replace(/\[interrupted\]/g, "")
      .replace(/^[\s>*#-]+/gm, "")
      .replace(/[*_#`]/g, "")
      .replace(/\s*[()[\]]\s*/g, ", ") // brackets read as pauses
      .replace(/^[,\s]+|[,\s]+$/g, "")
      .trim();
    if (!text || !this.voice) return;
    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.lang;
    utterance.voice = this.voice;
    const done = () => {
      if (generation !== this.generation) return;
      this.pending = Math.max(0, this.pending - 1);
      this.lastSpokeAt = Date.now();
      this.settle();
    };
    utterance.onstart = () => generation === this.generation && this.onStart();
    utterance.onend = done;
    utterance.onerror = done;
    this.pending += 1;
    this.recent = `${this.recent} ${text}`.slice(-800);
    this.lastSpokeAt = Date.now();
    window.speechSynthesis.speak(utterance);
  }

  private settle() {
    if (this.ended && this.pending === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  /** Resolves when everything fed so far has been said (or cancelled). */
  idle(): Promise<void> {
    if (this.ended && this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  get speaking() {
    return this.pending > 0;
  }

  cancel() {
    this.generation += 1;
    this.pending = 0;
    this.buffer = "";
    this.ended = true;
    window.speechSynthesis.cancel();
    this.settle();
  }

  /** Recognised text that is (mostly) what it just said: its own voice, not the patient's.
   * A short answer once it has stopped talking is always the patient's — "yes" right after
   * "…please say yes or no" is an answer, not an echo. */
  isEcho(text: string): boolean {
    if (Date.now() - this.lastSpokeAt > ECHO_WINDOW_MS && !this.speaking) return false;
    const heard = words(text);
    if (!heard.length) return true;
    if (!this.speaking && heard.length < 3) return false;
    const said = new Set(words(this.recent));
    return heard.filter((w) => said.has(w)).length / heard.length >= (this.speaking ? 0.6 : 0.8);
  }
}

export interface VoiceCallbacks {
  onState: (state: VoiceState) => void;
  /** What is being heard right now (live caption), "" when nothing. */
  onCaption: (text: string) => void;
  /** A note to show (e.g. no voice for the language on this device), or null. */
  onNotice: (text: string | null) => void;
  /** Voice mode stopped by itself; `message` says why (null: ended normally). */
  onStopped: (message: string | null) => void;
  /** Send what the patient said; feed the reply's text to `onText` as it streams. Resolves
   * when the reply is complete; rejects (or resolves) after `signal` aborts. */
  sendTurn: (text: string, onText: (text: string) => void, signal: AbortSignal) => Promise<void>;
}

export class VoiceSession {
  private state: VoiceState = "off";
  private vad: MicVAD | null = null;
  private recognition: Recognition | null = null;
  private recognitionRunning = false;
  private flushed: (() => void) | null = null;
  private heard: string[] = [];
  private interim = "";
  private turn: AbortController | null = null;
  private finishing = false;
  private vadSpeaking = false; // the detector hears speech right now
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private speaker: Speaker;
  private stopped = false;

  constructor(
    private language: VoiceLanguage,
    private cb: VoiceCallbacks,
  ) {
    this.speaker = new Speaker(
      language,
      () => this.turn && this.setState("speaking"),
      (missing) => this.cb.onNotice(missing ? this.noVoiceNote() : null),
    );
  }

  private noVoiceNote() {
    return this.language === "ur"
      ? "This device has no Urdu voice, so replies are shown as text only. You can still talk, or switch to English."
      : "This device has no English voice, so replies are shown as text only.";
  }

  private setState(state: VoiceState) {
    if (this.stopped && state !== "off") return;
    this.state = state;
    this.cb.onState(state);
    // While it talks (or is about to), an interruption has to be clearer than ordinary speech.
    const busy = state === "speaking" || state === "thinking";
    this.vad?.setOptions({
      positiveSpeechThreshold: busy ? 0.7 : 0.5,
      negativeSpeechThreshold: busy ? 0.55 : 0.35,
      minSpeechMs: busy ? BARGE_IN_MIN_SPEECH_MS : MIN_SPEECH_MS,
    });
  }

  async start() {
    this.setState("starting");
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
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: SILENCE_END_MS,
        minSpeechMs: MIN_SPEECH_MS,
        preSpeechPadMs: 200,
        startOnLoad: false,
        onSpeechStart: () => this.onSpeechStart(),
        onSpeechRealStart: () => this.onSpeechRealStart(),
        onSpeechEnd: () => {
          this.vadSpeaking = false;
          void this.finishTurn();
        },
        onVADMisfire: () => {
          this.vadSpeaking = false;
          if (this.state === "hearing" && !this.heardText()) this.setState("listening");
        },
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
      );
    }
  }

  stop(message: string | null = null) {
    if (this.stopped) return;
    this.stopped = true;
    this.turn?.abort();
    this.turn = null;
    this.speaker.dispose();
    this.clearTimers();
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
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
    this.speaker.setLanguage(language);
    this.restartRecognition();
  }

  // ---- speech detection

  private onSpeechStart() {
    this.vadSpeaking = true;
    this.armIdle();
    if (this.state === "listening") this.setState("hearing");
  }

  private onSpeechRealStart() {
    this.armIdle();
    if (this.state === "speaking" || this.state === "thinking") {
      // Barge-in: stop talking, drop the reply being written, listen to the new turn.
      this.speaker.cancel();
      this.turn?.abort();
      this.turn = null;
      this.heard = [];
      this.interim = "";
      this.setState("hearing");
    } else if (this.state === "listening") {
      this.setState("hearing");
    }
  }

  // ---- speech recognition

  private startRecognition() {
    const Ctor = recognitionCtor();
    if (!Ctor || this.stopped || this.recognitionRunning) return;
    const recognition = new Ctor();
    recognition.lang = RECOGNITION_LANG[this.language];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => this.onResult(e);
    recognition.onerror = (e) => this.onRecognitionError(e.error);
    recognition.onend = () => {
      this.recognitionRunning = false;
      if (this.flushed) {
        const done = this.flushed;
        this.flushed = null;
        done();
      } else if (!this.stopped) {
        // Chrome ends recognition after a while of silence or a network hiccup: carry on.
        setTimeout(() => this.startRecognition(), 250);
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

  private onResult(e: RecognitionEvent) {
    // While it thinks or talks, what the microphone picks up is (almost always) its own voice;
    // a real interruption is caught by the speech detector, which clears this and listens.
    if (this.state === "thinking" || this.state === "speaking") return;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const result = e.results[i];
      const text = result[0].transcript.trim();
      if (!text) continue;
      if (result.isFinal) {
        if (!this.speaker.isEcho(text)) this.heard.push(text);
      } else {
        interim += `${text} `;
      }
    }
    this.interim = this.speaker.isEcho(interim) ? "" : interim.trim();
    const caption = this.heardText();
    if (!caption) return;
    this.cb.onCaption(caption);
    this.armIdle();
    if (this.state === "listening") this.setState("hearing");
    // In case the detector didn't catch quiet speech, the recogniser's text alone ends the turn
    // (when the detector does hear it, its own end of speech ends the turn).
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => !this.vadSpeaking && void this.finishTurn(), FALLBACK_END_MS);
  }

  private onRecognitionError(error: string) {
    if (error === "not-allowed" || error === "service-not-allowed") {
      this.stop("Speech recognition is blocked. Allow the microphone for this site to use voice mode.");
    } else if (error === "network") {
      this.stop("Speech recognition needs an internet connection. Voice mode has stopped.");
    } else if (error === "language-not-supported") {
      this.stop(`This browser can't recognise ${this.language === "ur" ? "Urdu" : "English"} speech.`);
    }
    // "no-speech", "aborted", "audio-capture": recognition simply restarts.
  }

  private heardText() {
    return [...this.heard, this.interim].join(" ").replace(/\s+/g, " ").trim();
  }

  // ---- turns

  private async finishTurn() {
    if (this.finishing || this.stopped || (this.state !== "hearing" && this.state !== "listening")) return;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
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
    const controller = new AbortController();
    this.turn = controller;
    this.setState("thinking");
    this.speaker.begin();
    try {
      await this.cb.sendTurn(text, (piece) => this.turn === controller && this.speaker.feed(piece), controller.signal);
    } catch {
      // aborted (barge-in) or failed (the chat shows the error)
    }
    if (this.turn !== controller) return; // interrupted: a new turn has taken over
    this.speaker.end();
    await this.speaker.idle();
    if (this.turn === controller) {
      this.turn = null;
      this.setState("listening");
      this.armIdle();
    }
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.state === "listening") this.stop("Voice mode ended after two minutes of silence.");
      else this.armIdle();
    }, IDLE_END_MS);
  }

  private clearTimers() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
  }
}
