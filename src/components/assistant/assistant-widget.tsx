"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui";
import { ApiError, api, apiStream, messageOf, readEvents } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCall } from "@/lib/call";
import type {
  AssistantCard,
  AssistantConversation,
  AssistantConversationSummary,
  AssistantMessage,
  AssistantProposal,
  AssistantStatus,
} from "@/lib/types";
import { useIsClient } from "@/lib/use-is-client";

import { DoctorsCard, EmergencyCard, HistoryAccessCard, ProposalCard, TimesCard } from "./assistant-cards";
import { VoiceSession, voiceSupported } from "./voice-session";
import type { VoiceLanguage, VoiceState } from "./voice-session";

const MAX_CHARS = 2000;
const OPEN_KEY = "mc_assistant_conversation"; // the open conversation, kept for this tab
const VOICE_LANGUAGE_KEY = "mc_voice_language";

const VOICE_LABELS: Record<VoiceState, string> = {
  off: "",
  starting: "Starting the microphone…",
  listening: "Listening…",
  hearing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking (talk to interrupt)",
};

function savedVoiceLanguage(): VoiceLanguage {
  try {
    return window.localStorage.getItem(VOICE_LANGUAGE_KEY) === "en" ? "en" : "ur";
  } catch {
    return "ur";
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface VoiceTurn {
  language: VoiceLanguage;
  onText: (text: string) => void;
  signal: AbortSignal;
}

const SUGGESTIONS = [
  "Find a cardiologist in Lahore under Rs. 1,500",
  "Show my upcoming appointments",
  "Which doctor did I see last, and what was prescribed?",
  "Move my next appointment to another day",
];

interface Pending {
  text: string; // the patient's message, shown at once
  reply: string; // streamed so far
  status: string | null; // what a tool is doing
}

function remember(id: number | null) {
  try {
    if (id === null) window.sessionStorage.removeItem(OPEN_KEY);
    else window.sessionStorage.setItem(OPEN_KEY, String(id));
  } catch {
    // storage unavailable: the chat just starts fresh after a reload
  }
}

function remembered(): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(OPEN_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" strokeLinejoin="round" />
      <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function Cards({
  cards,
  proposals,
  historyAccess,
  busy,
  onPick,
  onProposal,
  onAllowHistory,
  onOpenLink,
}: {
  cards: AssistantCard[];
  proposals: Record<number, AssistantProposal>;
  historyAccess: boolean;
  busy: boolean;
  onPick: (text: string) => void;
  onProposal: (p: AssistantProposal) => void;
  onAllowHistory: () => void;
  onOpenLink: () => void;
}) {
  if (!cards.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {cards.map((card, i) => {
        switch (card.type) {
          case "emergency":
            return <EmergencyCard key={i} />;
          case "doctors":
            return <DoctorsCard key={i} items={card.items} onOpen={onOpenLink} />;
          case "times":
            return <TimesCard key={i} card={card} disabled={busy} onPick={onPick} />;
          case "history_access":
            return <HistoryAccessCard key={i} allowed={historyAccess} onAllow={onAllowHistory} />;
          case "proposal":
            return <ProposalCard key={i} proposal={proposals[card.proposal_id]} onChange={onProposal} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * The patients' AI assistant: a chat button on every page (patients only, when the server
 * has the assistant switched on), opening a panel that finds doctors, checks free times,
 * answers questions about the patient's appointments and (if they allow it) their health
 * record, and prepares bookings, cancellations and moves as cards they confirm.
 */
export function AssistantWidget() {
  const isClient = useIsClient();
  const { session } = useAuth();
  if (!isClient || session?.role !== "patient") return null;
  // Keyed by the patient: signing in as someone else starts from a clean slate.
  return <AssistantPanel key={session.userId} />;
}

function AssistantPanel() {
  const { stage, call } = useCall();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "list">("chat");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [proposals, setProposals] = useState<Record<number, AssistantProposal>>({});
  const [list, setList] = useState<AssistantConversationSummary[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<
    { kind: "allow" } | { kind: "voice" } | { kind: "delete"; id: number; title: string } | null
  >(null);
  // Voice mode (see voice-session.ts).
  const [voiceState, setVoiceState] = useState<VoiceState>("off");
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>(savedVoiceLanguage);
  const [caption, setCaption] = useState("");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [canTalk] = useState(voiceSupported);
  const voiceRef = useRef<VoiceSession | null>(null);
  const voiceLanguageRef = useRef(voiceLanguage);
  const conversationRef = useRef<number | null>(null);
  const sendRef = useRef<(text: string, voice?: VoiceTurn) => Promise<void>>(async () => {});
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Whether the assistant is on, and the patient's settings (again whenever the panel opens).
  useEffect(() => {
    let cancelled = false;
    api<AssistantStatus>("/assistant")
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const loadConversation = useCallback(async (id: number) => {
    setError(null);
    try {
      const c = await api<AssistantConversation>(`/assistant/conversations/${id}`);
      conversationRef.current = c.id;
      setConversationId(c.id);
      setMessages(c.messages);
      setProposals(Object.fromEntries(c.proposals.map((p) => [p.id, p])));
      remember(c.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        remember(null);
        conversationRef.current = null;
        setConversationId(null);
        setMessages([]);
      } else setError(messageOf(e));
    }
  }, []);

  function openPanel() {
    setOpen(true);
    // Brings back this tab's conversation (the panel may have been closed, or the page reloaded).
    const id = remembered();
    if (id !== null && conversationId === null && !messages.length && !pending) void loadConversation(id);
  }

  useEffect(() => {
    if (!open || view !== "list") return;
    let cancelled = false;
    api<AssistantConversationSummary[]>("/assistant/conversations")
      .then((data) => !cancelled && setList(data))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [open, view]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, open, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || confirming) return;
      voiceRef.current?.stop();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirming]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      voiceRef.current?.stop();
    },
    [],
  );

  // Voice mode never runs alongside a video call (they'd share the microphone), nor in a
  // tab the patient has left.
  useEffect(() => {
    if (call) voiceRef.current?.stop("Voice mode stopped because a video call started.");
  }, [call]);
  useEffect(() => {
    if (voiceState === "off") return;
    const onHide = () => document.hidden && voiceRef.current?.stop("Voice mode stopped because you left the page.");
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [voiceState]);

  /** Send a message. In voice mode a new turn replaces one still being answered (the patient
   * spoke over it), and the reply's text is also handed to the voice as it arrives. */
  async function send(text: string, voice?: VoiceTurn) {
    const message = text.trim();
    if (!message || (!voice && abortRef.current)) return;
    setError(null);
    if (!voice) setDraft("");
    setPending({ text: message, reply: "", status: null });
    const controller = new AbortController();
    voice?.signal.addEventListener("abort", () => controller.abort());
    abortRef.current?.abort();
    abortRef.current = controller;
    let id = conversationRef.current;
    const body = { text: message, conversation_id: id, ...(voice ? { voice: true, language: voice.language } : {}) };
    try {
      let res: Response | null = null;
      for (let attempt = 0; res === null; attempt += 1) {
        try {
          res = await apiStream("/assistant/messages", body, controller.signal);
        } catch (e) {
          // An interrupted reply may still be closing on the server for a moment.
          if (voice && e instanceof ApiError && e.status === 409 && attempt < 10 && !controller.signal.aborted) {
            await wait(400);
            continue;
          }
          throw e;
        }
      }
      for await (const { event, data } of readEvents(res)) {
        const d = data as Record<string, unknown>;
        if (event === "conversation") {
          id = d.id as number;
          conversationRef.current = id;
          setConversationId(id);
          remember(id);
        } else if (event === "delta") {
          voice?.onText(d.text as string);
          setPending((p) => p && { ...p, reply: p.reply + (d.text as string), status: null });
        } else if (event === "status") {
          setPending((p) => p && { ...p, status: d.text as string });
        } else if (event === "done" || event === "error") {
          if (event === "error") setError(d.message as string);
          const proposalsIn = (d.proposals as AssistantProposal[] | undefined) ?? [];
          setProposals((prev) => ({ ...prev, ...Object.fromEntries(proposalsIn.map((p) => [p.id, p])) }));
        }
      }
      // The saved conversation is the record: reload it (ids, merged reply, cards).
      if (id !== null) await loadConversation(id);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(messageOf(e));
        if (!voice) setDraft(message); // not sent (e.g. the daily limit): keep it to try again
        if (id !== null) await loadConversation(id);
        if (voice && e instanceof ApiError && (e.status === 429 || e.status === 403)) voiceRef.current?.stop(e.message);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPending(null);
      }
      void api<AssistantStatus>("/assistant")
        .then(setStatus)
        .catch(() => {});
      if (!voice) inputRef.current?.focus();
    }
  }
  useEffect(() => {
    sendRef.current = send;
  });

  async function startVoice() {
    if (voiceRef.current) return;
    setError(null);
    setVoiceNotice(null);
    const session = new VoiceSession(voiceLanguage, {
      onState: setVoiceState,
      onCaption: setCaption,
      onNotice: setVoiceNotice,
      onStopped: (message) => {
        if (voiceRef.current === session) voiceRef.current = null;
        setVoiceNotice(message);
      },
      sendTurn: (text, onText, signal) => sendRef.current(text, { language: voiceLanguageRef.current, onText, signal }),
    });
    voiceRef.current = session;
    await session.start();
  }

  function talk() {
    if (status?.voice_consent) void startVoice();
    else setConfirming({ kind: "voice" });
  }

  function endVoice() {
    voiceRef.current?.stop();
    setVoiceNotice(null);
  }

  function chooseLanguage(language: VoiceLanguage) {
    setVoiceLanguage(language);
    voiceLanguageRef.current = language;
    voiceRef.current?.setLanguage(language);
    try {
      window.localStorage.setItem(VOICE_LANGUAGE_KEY, language);
    } catch {
      // not remembered
    }
  }

  function closePanel() {
    voiceRef.current?.stop();
    setOpen(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  function newChat() {
    if (pending) return;
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setProposals({});
    setError(null);
    setView("chat");
    remember(null);
    inputRef.current?.focus();
  }

  async function setHistoryAccess(allowed: boolean) {
    setStatus(await api<AssistantStatus>("/assistant/settings", { method: "PUT", body: { history_access: allowed } }));
  }

  async function setVoiceConsent(agreed: boolean) {
    setStatus(await api<AssistantStatus>("/assistant/settings", { method: "PUT", body: { voice_consent: agreed } }));
  }

  async function deleteConversation(id: number) {
    await api(`/assistant/conversations/${id}`, { method: "DELETE" });
    setList((l) => l?.filter((c) => c.id !== id) ?? null);
    if (id === conversationId) newChat();
    setConfirming(null);
  }

  // Following a link from the chat on a phone (where the panel covers the page) closes it.
  const closeOnSmallScreens = () => window.matchMedia("(max-width: 639px)").matches && closePanel();

  if (!status?.available || stage !== null) return null;

  const busy = pending !== null;
  const left = Math.max(0, status.daily_limit - status.used_today);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Open the MedConnect assistant"
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-brand-700 px-4 py-3 font-semibold text-white shadow-lg hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          <ChatIcon />
          <span className="hidden sm:inline">Ask MedConnect</span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="MedConnect assistant"
          className="fixed inset-0 z-40 flex flex-col bg-white sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(42rem,calc(100dvh-6rem))] sm:w-[25rem] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-ink">MedConnect assistant</h2>
              <p className="truncate text-xs text-slate-500">Finds doctors and manages your appointments</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setView(view === "list" ? "chat" : "list")} disabled={busy}>
              {view === "list" ? "Back" : "Chats"}
            </Button>
            <Button size="sm" variant="ghost" onClick={newChat} disabled={busy} aria-label="New chat">
              New
            </Button>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close the assistant"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {view === "list" ? (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 rounded-lg border border-slate-200 p-3 text-sm">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={status.history_access}
                    onChange={(e) =>
                      e.target.checked
                        ? setConfirming({ kind: "allow" })
                        : void setHistoryAccess(false).catch((x) => setError(messageOf(x)))
                    }
                  />
                  <span>
                    <span className="font-semibold text-ink">Let the assistant read my health record</span>
                    <span className="block text-xs text-slate-600">
                      To answer questions about your medicines, diagnoses and visits. Items you marked private are never included.
                      You can switch this off any time.
                    </span>
                  </span>
                </label>
              </div>
              {status.voice_consent && (
                <div className="mb-4 rounded-lg border border-slate-200 p-3 text-sm">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked
                      onChange={() => {
                        voiceRef.current?.stop();
                        void setVoiceConsent(false).catch((x) => setError(messageOf(x)));
                      }}
                    />
                    <span>
                      <span className="font-semibold text-ink">Voice mode allowed</span>
                      <span className="block text-xs text-slate-600">
                        Your speech is turned into text by your browser&apos;s speech service (Google, in Chrome). Untick to
                        withdraw; you&apos;ll be asked again next time.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              <h3 className="text-sm font-semibold text-ink">Your conversations</h3>
              {list === null && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
              {list?.length === 0 && <p className="mt-2 text-sm text-slate-500">No conversations yet.</p>}
              <ul className="mt-2 space-y-1">
                {list?.map((c) => (
                  <li key={c.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        void loadConversation(c.id);
                        setView("chat");
                      }}
                      className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 ${c.id === conversationId ? "bg-brand-50 font-semibold text-brand-800" : "text-ink"}`}
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming({ kind: "delete", id: c.id, title: c.title })}
                      aria-label={`Delete conversation: ${c.title}`}
                      className="rounded-lg px-2 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-slate-500">Conversations are deleted after 90 days without use.</p>
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {messages.length === 0 && !pending && (
                <div>
                  <p className="text-sm text-slate-700">
                    Hi! I can find doctors, check free times, and book, cancel or move your appointments. Ask in English or Urdu.
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-ink hover:border-brand-700 hover:bg-brand-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <p
                      dir="auto"
                      className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-brand-700 px-3 py-2 text-sm text-white"
                    >
                      {m.content}
                    </p>
                  </div>
                ) : (
                  <div key={m.id} className="max-w-[95%]" data-testid="assistant-reply">
                    {m.content && (
                      <p
                        dir="auto"
                        className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-ink"
                      >
                        {m.content}
                      </p>
                    )}
                    <Cards
                      cards={m.cards}
                      proposals={proposals}
                      historyAccess={status.history_access}
                      busy={busy}
                      onPick={(t) => void send(t)}
                      onProposal={(p) => setProposals((prev) => ({ ...prev, [p.id]: p }))}
                      onAllowHistory={() => setConfirming({ kind: "allow" })}
                      onOpenLink={closeOnSmallScreens}
                    />
                  </div>
                ),
              )}
              {pending && (
                <>
                  <div className="flex justify-end">
                    <p
                      dir="auto"
                      className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-brand-700 px-3 py-2 text-sm text-white"
                    >
                      {pending.text}
                    </p>
                  </div>
                  <div className="max-w-[95%]">
                    {pending.reply && (
                      <p
                        dir="auto"
                        className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-ink"
                      >
                        {pending.reply}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500" role="status">
                      {pending.status ?? (pending.reply ? "" : "Thinking…")}
                    </p>
                  </div>
                </>
              )}
              {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
            </div>
          )}

          {view === "chat" && voiceState !== "off" && (
            <div className="border-t border-slate-200 p-3" data-testid="voice-bar">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-3 w-3 shrink-0 rounded-full ${voiceState === "hearing" ? "bg-red-600" : voiceState === "speaking" ? "bg-brand-600" : voiceState === "listening" ? "bg-emerald-500" : "bg-slate-400"}`}
                />
                <p role="status" className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                  {VOICE_LABELS[voiceState]}
                </p>
                <div className="inline-flex rounded-lg border border-slate-300 p-0.5" role="group" aria-label="Voice language">
                  {(["ur", "en"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={voiceLanguage === l}
                      onClick={() => chooseLanguage(l)}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${voiceLanguage === l ? "bg-brand-700 text-white" : "text-ink hover:bg-slate-50"}`}
                    >
                      {l === "ur" ? "اردو" : "English"}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="danger" onClick={endVoice}>
                  End
                </Button>
              </div>
              {caption && (
                <p dir="auto" className="mt-2 text-sm text-slate-700" data-testid="voice-caption">
                  {caption}
                </p>
              )}
              {voiceNotice && <p className="mt-2 text-xs text-amber-800">{voiceNotice}</p>}
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                Speak naturally; pause when you&apos;re done. You can interrupt. Say &quot;yes&quot; (ہاں) to confirm what it
                asks. Your speech is turned into text by your browser&apos;s speech service (Google, in Chrome).
              </p>
            </div>
          )}
          {view === "chat" && voiceState === "off" && (
            <form onSubmit={submit} className="border-t border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <label htmlFor="assistant-input" className="sr-only">
                  Message the assistant
                </label>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  rows={1}
                  maxLength={MAX_CHARS}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={left === 0}
                  placeholder={left === 0 ? "Daily message limit reached" : "Ask about doctors or appointments…"}
                  className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand-700"
                />
                <Button type="submit" disabled={busy || !draft.trim() || left === 0}>
                  Send
                </Button>
                {canTalk && (
                  <Button
                    variant="secondary"
                    onClick={talk}
                    disabled={busy || left === 0}
                    aria-label="Start a voice conversation"
                    title="Talk to the assistant"
                  >
                    <MicIcon />
                  </Button>
                )}
              </div>
              {voiceNotice && <p className="mt-2 text-xs text-amber-800">{voiceNotice}</p>}
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                AI assistant: it can make mistakes and doesn&apos;t give medical advice. In an emergency call 1122.
                {left <= 10 && ` ${left} message${left === 1 ? "" : "s"} left today.`}
              </p>
            </form>
          )}
        </section>
      )}

      {confirming?.kind === "voice" && (
        <ConfirmDialog
          title="Talk to the assistant?"
          confirmLabel="Agree and start"
          busyLabel="Starting…"
          cancelLabel="Not now"
          onConfirm={async () => {
            await setVoiceConsent(true);
            setConfirming(null);
            void startVoice();
          }}
          onClose={() => setConfirming(null)}
        >
          <p>
            In voice mode the microphone stays on until you press End. What you say is turned into text by your browser&apos;s
            speech service — <span className="font-semibold text-ink">in Chrome, that&apos;s Google</span>— so your words,
            including any health details you mention, are sent to it for that. The text is then handled like a typed message.
          </p>
          <p>
            Replies are read aloud, and you can talk over them. When the assistant prepares a booking, cancellation or new time,
            it asks you to confirm: a clear &quot;yes&quot; (ہاں) carries it out, &quot;no&quot; (نہیں) doesn&apos;t.
          </p>
          <p>You can withdraw this agreement any time under Chats.</p>
        </ConfirmDialog>
      )}
      {confirming?.kind === "allow" && (
        <ConfirmDialog
          title="Let the assistant read your health record?"
          confirmLabel="Allow"
          busyLabel="Saving…"
          cancelLabel="Not now"
          onConfirm={async () => {
            await setHistoryAccess(true);
            setConfirming(null);
          }}
          onClose={() => setConfirming(null)}
        >
          <p>
            The assistant will be able to read your allergies, conditions, medicines, diagnoses and visit records to answer your
            questions. Items you marked private are never included.
          </p>
          <p>
            Your questions and the parts of your record needed to answer them are sent to an AI service that doesn&apos;t keep
            them. You can switch this off any time under Chats.
          </p>
        </ConfirmDialog>
      )}
      {confirming?.kind === "delete" && (
        <ConfirmDialog
          title="Delete this conversation?"
          confirmLabel="Delete conversation"
          busyLabel="Deleting…"
          cancelLabel="Keep it"
          tone="danger"
          onConfirm={() => deleteConversation(confirming.id)}
          onClose={() => setConfirming(null)}
        >
          <p>
            <span className="font-semibold text-ink">{confirming.title}</span> will be deleted. Appointments you booked or changed
            through it aren&apos;t affected.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
