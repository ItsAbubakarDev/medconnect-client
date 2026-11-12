"use client";

import {
  ChatCloseIcon,
  ChatEntry,
  ChatToggle,
  useChat,
  useMaybeLayoutContext,
  useRemoteParticipants,
} from "@livekit/components-react";
import type { ReceivedChatMessage } from "@livekit/components-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { documentTitle, formatSize } from "@/lib/health";
import type { CallDocument, MedicalDocument } from "@/lib/types";

import { ConfirmDialog } from "./confirm-dialog";
import { FileViewer, WORD_TYPE, callFileUrls } from "./health/file-viewer";

// A chat message announcing a shared document: "[[doc:<share id>]] <title>". The document
// itself is fetched from the server (only the two people on the appointment can open it).
const DOC_MESSAGE = /^\[\[doc:(\d+)\]\]\s?([\s\S]*)$/;

/** Three letters for the file badge. */
function badgeOf(d: MedicalDocument): string {
  const f = d.files[0];
  if (!f) return "DOC";
  if (f.is_dicom) return "DCM";
  if (f.content_type === "application/pdf") return "PDF";
  if (f.content_type === WORD_TYPE) return "DOC";
  if (f.content_type.startsWith("image/")) return "IMG";
  return "FILE";
}

function kindOf(d: MedicalDocument): string {
  const f = d.files[0];
  if (!f) return "Document";
  if (f.is_dicom) return d.files.length > 1 ? `Scan · ${d.files.length} images` : "Scan";
  if (f.content_type === "application/pdf") return "PDF";
  if (f.content_type === WORD_TYPE) return "Word";
  if (f.content_type.startsWith("image/")) return "Photo";
  return "File";
}

function DocCard({ share, onOpen, mine }: { share: CallDocument; onOpen: () => void; mine: boolean }) {
  const d = share.document;
  const size = d.files.reduce((n, f) => n + f.size_bytes, 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-lg bg-black/25 px-2.5 py-2 text-left text-sm hover:bg-black/40"
      title={`Open ${documentTitle(d)}`}
    >
      <span
        aria-hidden
        className="m-0! flex h-8 w-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-white/15 text-[0.65rem] font-bold"
      >
        {badgeOf(d)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{documentTitle(d)}</span>
        <span className="block truncate text-xs opacity-75">
          {kindOf(d)} · {formatSize(size)} · {mine ? "shared by you" : `from ${share.shared_by_name ?? share.shared_by}`}
        </span>
      </span>
    </button>
  );
}

/** Pick a document from the patient's own health record to share in the call. */
function RecordPicker({ onPick, onClose }: { onPick: (d: MedicalDocument) => void; onClose: () => void }) {
  const [docs, setDocs] = useState<MedicalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<MedicalDocument[]>("/patients/me/documents")
      .then((list) => !cancelled && setDocs(list))
      .catch((e) => !cancelled && setError(messageOf(e)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-picker-title"
        className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white text-ink"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id="record-picker-title" className="font-bold">
            Share from your health record
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-3">
          {error && <p className="p-2 text-sm text-red-700">{error}</p>}
          {!docs && !error && <p className="p-2 text-sm text-slate-500">Loading your documents…</p>}
          {docs?.length === 0 && <p className="p-2 text-sm text-slate-600">There are no documents in your health record yet.</p>}
          <ul className="space-y-1">
            {docs?.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onPick(d)}
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                >
                  <span className="block truncate font-semibold">{documentTitle(d)}</span>
                  <span className="block truncate text-xs text-slate-600">
                    {kindOf(d)} · {formatDate(d.report_date)}
                    {d.is_private ? " · private" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

type Pending = { kind: "upload"; file: File } | { kind: "record"; doc: MedicalDocument };

/**
 * The in-call chat: LiveKit's messages (same look and behaviour as its own chat panel), plus
 * sharing documents. A shared file is uploaded to the server — kept with the appointment and
 * in the patient's health record — and announced in the chat; everything shared in this
 * appointment's calls is listed at the top, also for someone who joins later.
 */
export function CallChat({ appointmentId, style }: { appointmentId: number; style?: CSSProperties }) {
  const { session } = useAuth();
  const isPatient = session?.role === "patient";
  const { chatMessages, send, isSending } = useChat();
  const layout = useMaybeLayoutContext();
  const remote = useRemoteParticipants()[0];
  const otherName = remote?.name || (isPatient ? "your doctor" : "the patient");
  const ulRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastReadAt = useRef(0);
  const [docs, setDocs] = useState<CallDocument[]>([]);
  const [docsVersion, setDocsVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "Sharing report.pdf…"
  const [viewing, setViewing] = useState<CallDocument | null>(null);
  const [showAllDocs, setShowAllDocs] = useState(false);

  // Everything shared so far; refreshed whenever a "document shared" message comes in.
  const docMessages = chatMessages.filter((m) => DOC_MESSAGE.test(m.message)).length;
  useEffect(() => {
    let cancelled = false;
    api<CallDocument[]>(`/appointments/${appointmentId}/call-documents`)
      .then((list) => !cancelled && setDocs(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appointmentId, docMessages, docsVersion]);

  useEffect(() => {
    ulRef.current?.scrollTo({ top: ulRef.current.scrollHeight });
  }, [chatMessages, docs]);

  // The unread badge on the chat button (as LiveKit's own chat does it).
  useEffect(() => {
    if (!layout || chatMessages.length === 0) return;
    const latest = chatMessages[chatMessages.length - 1].timestamp;
    if (layout.widget.state?.showChat) {
      lastReadAt.current = latest;
      return;
    }
    const unread = chatMessages.filter((m) => m.timestamp > lastReadAt.current).length;
    if (unread > 0 && layout.widget.state?.unreadMessages !== unread)
      layout.widget.dispatch?.({ msg: "unread_msg", count: unread });
  }, [chatMessages, layout, layout?.widget]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || !inputRef.current) return;
    await send(text);
    inputRef.current.value = "";
    inputRef.current.focus();
  }

  async function share(p: Pending) {
    setBusy(`Sharing ${p.kind === "upload" ? p.file.name : documentTitle(p.doc)}…`);
    let shared: CallDocument;
    if (p.kind === "upload") {
      const form = new FormData();
      form.append("file", p.file, p.file.name);
      shared = await api<CallDocument>(`/appointments/${appointmentId}/call-documents`, { method: "POST", body: form });
    } else {
      shared = await api<CallDocument>(`/appointments/${appointmentId}/call-documents/from-record`, {
        method: "POST",
        body: { document_id: p.doc.id },
      });
    }
    setPending(null);
    setBusy(null);
    setDocs((list) => (list.some((d) => d.id === shared.id) ? list : [...list, shared])); // shown at once, then refreshed
    setDocsVersion((v) => v + 1);
    await send(`[[doc:${shared.id}]] ${documentTitle(shared.document)}`).catch(() => {});
  }

  const byId = new Map(docs.map((d) => [d.id, d]));
  const shownDocs = showAllDocs ? docs : docs.slice(-3);

  function entry(msg: ReceivedChatMessage, idx: number, all: ReceivedChatMessage[]) {
    const hideName = idx >= 1 && all[idx - 1].from === msg.from;
    const hideTimestamp = hideName && msg.timestamp - all[idx - 1].timestamp < 60_000;
    const doc = DOC_MESSAGE.exec(msg.message);
    if (!doc) return <ChatEntry key={msg.id ?? idx} entry={msg} hideName={hideName} hideTimestamp={hideTimestamp} />;
    const share = byId.get(Number(doc[1]));
    const local = !!msg.from?.isLocal;
    return (
      <li key={msg.id ?? idx} className="lk-chat-entry" data-lk-message-origin={local ? "local" : "remote"}>
        {!hideName && (
          <span className="lk-meta-data">
            <strong className="lk-participant-name">{local ? "You" : (msg.from?.name ?? msg.from?.identity)}</strong>
          </span>
        )}
        <span className="lk-message-body" style={{ width: "100%", maxWidth: "calc(100% - 32px)" }}>
          <span className="block text-xs opacity-80">{local ? "You shared a document" : "Shared a document"}</span>
          {share ? (
            <DocCard share={share} mine={share.shared_by === session?.role} onOpen={() => setViewing(share)} />
          ) : (
            <span className="block text-sm">{doc[2] || "Document"}</span>
          )}
        </span>
      </li>
    );
  }

  return (
    <div style={style} className="lk-chat">
      <div className="lk-chat-header">
        Messages
        {layout && (
          <ChatToggle className="lk-close-button">
            <ChatCloseIcon />
          </ChatToggle>
        )}
      </div>

      <div className="flex h-full min-h-0 flex-col self-stretch overflow-hidden">
        {docs.length > 0 && (
          <div className="border-b border-white/10 px-3 py-2" data-testid="shared-documents">
            <p className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide opacity-75">
              <span>Shared documents ({docs.length})</span>
              {docs.length > 3 && (
                <button type="button" className="normal-case underline" onClick={() => setShowAllDocs((v) => !v)}>
                  {showAllDocs ? "Show fewer" : "Show all"}
                </button>
              )}
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {shownDocs.map((s) => (
                <DocCard key={s.id} share={s} mine={s.shared_by === session?.role} onOpen={() => setViewing(s)} />
              ))}
            </div>
          </div>
        )}
        <ul className="lk-list lk-chat-messages flex-1" ref={ulRef}>
          {chatMessages.map(entry)}
        </ul>
        {busy && (
          <p role="status" className="px-3 py-1.5 text-xs opacity-80">
            {busy}
          </p>
        )}
      </div>

      <form className="lk-chat-form relative" onSubmit={submit}>
        <button
          type="button"
          className="lk-button shrink-0 px-3!"
          aria-label="Share a document"
          aria-haspopup={isPatient ? "menu" : undefined}
          aria-expanded={isPatient ? menuOpen : undefined}
          title="Share a document (PDF, photo, scan or Word file)"
          disabled={busy !== null}
          onClick={() => (isPatient ? setMenuOpen((o) => !o) : fileRef.current?.click())}
        >
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-3 z-10 mb-1 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#2a2a2a] shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
            >
              Upload a file
              <span className="block text-xs opacity-70">PDF, photo, scan or Word document</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                setPicking(true);
              }}
            >
              From my health record
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a document to share"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setPending({ kind: "upload", file });
          }}
        />
        <input
          className="lk-form-control lk-chat-form-input"
          disabled={isSending}
          ref={inputRef}
          type="text"
          placeholder="Enter a message..."
          aria-label="Message"
          onInput={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
          onKeyUp={(ev) => ev.stopPropagation()}
        />
        <button type="submit" className="lk-button lk-chat-form-button" disabled={isSending}>
          Send
        </button>
      </form>

      {picking && (
        <RecordPicker
          onClose={() => setPicking(false)}
          onPick={(doc) => {
            setPicking(false);
            setPending({ kind: "record", doc });
          }}
        />
      )}
      {pending && (
        <ConfirmDialog
          title={`Share “${pending.kind === "upload" ? pending.file.name : documentTitle(pending.doc)}” in the call?`}
          confirmLabel="Share"
          busyLabel="Sharing…"
          onConfirm={async () => {
            try {
              await share(pending);
            } catch (e) {
              setBusy(null);
              throw e; // shown in the dialog, which stays open
            }
          }}
          onClose={() => setPending(null)}
        >
          {pending.kind === "upload" && (
            <p>
              {pending.file.name} · {formatSize(pending.file.size)}
            </p>
          )}
          <p>
            {isPatient
              ? pending.kind === "upload"
                ? `${otherName} can open it straight away. It's also saved to your health record, linked to this visit.`
                : `${otherName} can open it from this call${pending.doc.is_private ? ", even though it's private in your record" : ""}.`
              : `${otherName} can open it straight away. It's also added to their health record as a document from you.`}
          </p>
        </ConfirmDialog>
      )}
      {viewing && (
        <FileViewer document={viewing.document} urls={callFileUrls(appointmentId, viewing.id)} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
