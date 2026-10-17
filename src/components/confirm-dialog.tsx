"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { messageOf } from "@/lib/api";

import { Alert, Button } from "./ui";

// Clicks this soon after the dialog opens are ignored: a double-tap on the button that
// opened it must neither confirm (if it lands on the confirm button) nor dismiss the question
// before it's read (if it lands on the backdrop).
export const ARM_DELAY_MS = 400;

/**
 * "Are you sure?" for actions that can't simply be undone (booking, cancelling, accepting,
 * completing). The safe choice has the focus; Escape or a click outside closes it.
 * `onConfirm` runs the action; if it throws, the error is shown and the dialog stays open.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = "Go back",
  tone = "primary",
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "accent" | "danger";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeButton = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(0);
  // Kept in refs so the focus/Escape setup runs once even if the parent re-renders.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    openedAt.current = Date.now();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    safeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busyRef.current && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus(); // back to where the user was
    };
  }, []);

  const justOpened = () => Date.now() - openedAt.current < ARM_DELAY_MS;

  async function confirm() {
    if (busy || justOpened()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={() => !busy && !justOpened() && onClose()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-lg font-bold text-ink">
          {title}
        </h2>
        <div id="confirm-body" className="mt-2 space-y-2 text-sm text-slate-600">
          {children}
        </div>
        {error && (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={safeButton} variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={confirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
