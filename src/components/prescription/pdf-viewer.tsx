"use client";

import { useEffect, useRef, useState } from "react";

import { api, messageOf } from "@/lib/api";

import { Alert, Button } from "../ui";

/**
 * A prescription's PDF in a full-screen panel (the doctor's preview of a draft, or an issued
 * one), with Download and Open in a new tab. Fetched with the access token, so not a plain
 * link. Phones often can't show a PDF inside a page: there, Open/Download are what work.
 */
export function PdfViewer({
  prescriptionId,
  number,
  title,
  onClose,
}: {
  prescriptionId: number;
  number: string;
  title: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    api<Blob>(`/prescriptions/${prescriptionId}/pdf`, { responseType: "blob" })
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setUrl(created);
      })
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [prescriptionId]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const filename = `Prescription-${number}.pdf`;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-slate-900/80">
      <div className="flex flex-wrap items-center gap-2 bg-white px-4 py-3">
        <p className="min-w-0 flex-1 truncate font-semibold text-ink">{title}</p>
        {url && (
          <>
            <a
              href={url}
              target="_blank"
              rel="noopener"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50"
            >
              Open in new tab
            </a>
            <a
              href={url}
              download={filename}
              className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Download PDF
            </a>
          </>
        )}
        <Button ref={closeRef} variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="flex-1 overflow-hidden p-2 sm:p-4">
        {error ? (
          <div className="mx-auto max-w-md pt-10">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : url ? (
          <iframe title={title} src={url} className="h-full w-full rounded-lg bg-white" />
        ) : (
          <p className="pt-10 text-center text-sm text-white">Preparing the PDF…</p>
        )}
      </div>
    </div>
  );
}
