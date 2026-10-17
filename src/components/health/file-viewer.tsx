"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, messageOf } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { documentLabel, documentTitle, formatSize } from "@/lib/health";
import type { DocumentFile, MedicalDocument } from "@/lib/types";

import { Alert, Button } from "../ui";

/** Paths for one document's files: the patient's own, or a doctor's through an appointment. */
export type FileUrls = (fileId: number, kind: "file" | "preview" | "download") => string;

const suffix = (kind: "file" | "preview" | "download") =>
  kind === "preview" ? "/preview" : kind === "download" ? "?download=true" : "";

export const patientFileUrls =
  (documentId: number): FileUrls =>
  (fileId, kind) =>
    `/patients/me/documents/${documentId}/files/${fileId}${suffix(kind)}`;

/** Through one appointment: every open is checked (and logged) by the server. */
export const doctorFileUrls =
  (appointmentId: number, documentId: number): FileUrls =>
  (fileId, kind) =>
    `/doctors/me/appointments/${appointmentId}/documents/${documentId}/files/${fileId}${suffix(kind)}`;

/** The doctor's own prescription on a consultation record (available for good). */
export const ownPrescriptionUrls =
  (consultationId: number): FileUrls =>
  (fileId, kind) =>
    `/doctors/me/consultations/${consultationId}/files/${fileId}${kind === "download" ? "?download=true" : ""}`;

/** Files in viewing order: a scan study's images series by series, in instance order. */
export function orderedFiles(files: DocumentFile[]): DocumentFile[] {
  const seriesOrder = new Map<string, number>();
  for (const f of files) if (!seriesOrder.has(f.series_uid ?? "")) seriesOrder.set(f.series_uid ?? "", seriesOrder.size);
  return [...files].sort(
    (a, b) =>
      (seriesOrder.get(a.series_uid ?? "") ?? 0) - (seriesOrder.get(b.series_uid ?? "") ?? 0) ||
      (a.instance_number ?? 0) - (b.instance_number ?? 0) ||
      a.id - b.id,
  );
}

export function seriesSummary(files: DocumentFile[]): string | null {
  const dicom = files.filter((f) => f.is_dicom);
  if (dicom.length === 0) return null;
  const series = new Set(dicom.map((f) => f.series_uid ?? ""));
  return `${dicom.length} image${dicom.length > 1 ? "s" : ""}${series.size > 1 ? ` in ${series.size} series` : ""}`;
}

async function saveBlob(path: string, filename: string) {
  const blob = await api<Blob>(path, { responseType: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function DownloadButton({ urls, file, size = "sm" }: { urls: FileUrls; file: DocumentFile; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        variant="secondary"
        size={size}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await saveBlob(urls(file.id, "download"), file.original_filename);
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Downloading…" : "Download"}
      </Button>
      {error && <span className="mt-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}

type Shown = { fileId: number; kind: "image" | "pdf" | "none"; url?: string; error?: string };

/** Full-screen viewer for one record's files: images and PDFs inline, DICOM images by their
 * preview (with previous / next through the study), and every original downloadable. */
export function FileViewer({
  document: doc,
  startFileId,
  urls,
  onClose,
}: {
  document: MedicalDocument;
  startFileId?: number;
  urls: FileUrls;
  onClose: () => void;
}) {
  const files = useMemo(() => orderedFiles(doc.files), [doc.files]);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      files.findIndex((f) => f.id === startFileId),
    ),
  );
  const [shown, setShown] = useState<Shown | null>(null);
  const cache = useRef(new Map<number, Shown>());
  const file = files[index];

  // Fetch (once) what this file shows as; object URLs are released when the viewer closes.
  useEffect(() => {
    if (!file) return;
    const hit = cache.current.get(file.id);
    if (hit) {
      setShown(hit);
      return;
    }
    let cancelled = false;
    const isImage = file.content_type.startsWith("image/");
    const isPdf = file.content_type === "application/pdf";
    if (!isImage && !isPdf && !(file.is_dicom && file.has_preview)) {
      const none: Shown = { fileId: file.id, kind: "none" };
      cache.current.set(file.id, none);
      setShown(none);
      return;
    }
    setShown(null);
    api<Blob>(urls(file.id, file.is_dicom ? "preview" : "file"), { responseType: "blob" })
      .then((blob) => {
        const result: Shown = { fileId: file.id, kind: isPdf ? "pdf" : "image", url: URL.createObjectURL(blob) };
        cache.current.set(file.id, result);
        if (!cancelled) setShown(result);
      })
      .catch((e) => !cancelled && setShown({ fileId: file.id, kind: "none", error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [file, urls]);

  useEffect(() => {
    const store = cache.current;
    return () => store.forEach((s) => s.url && URL.revokeObjectURL(s.url));
  }, []);

  const go = useCallback((delta: number) => setIndex((i) => Math.min(files.length - 1, Math.max(0, i + delta))), [files.length]);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!file) return null;
  const current = shown?.fileId === file.id ? shown : null;
  const seriesFiles = files.filter((f) => (f.series_uid ?? "") === (file.series_uid ?? ""));
  const inSeries = seriesFiles.findIndex((f) => f.id === file.id) + 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-2 sm:p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${documentTitle(doc)} — file ${index + 1} of ${files.length}`}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{documentTitle(doc)}</p>
            <p className="truncate text-sm text-slate-600">
              {documentLabel(doc)} · {formatDate(doc.report_date)}
              {doc.provider_name ? ` · ${doc.provider_name}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DownloadButton urls={urls} file={file} />
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close viewer">
              Close
            </Button>
          </div>
        </div>

        <div className="flex min-h-[50vh] flex-1 items-center justify-center overflow-auto bg-slate-950/95">
          {!current && <p className="text-sm text-slate-300">Loading…</p>}
          {current?.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- a private blob URL, not an optimisable asset
            <img src={current.url} alt={file.original_filename} className="h-[min(70vh,48rem)] w-full object-contain" />
          )}
          {current?.kind === "pdf" && (
            <iframe src={current.url} title={file.original_filename} className="h-[70vh] w-full bg-white" />
          )}
          {current?.kind === "none" && (
            <div className="max-w-sm p-6 text-center text-sm text-slate-200">
              {current.error ? (
                <Alert tone="error">{current.error}</Alert>
              ) : file.is_dicom ? (
                <p>
                  This DICOM file has no image preview (it may be a report or an unusual format). Download it to open in a DICOM
                  viewer.
                </p>
              ) : (
                <p>This file can&apos;t be shown here. Download it to open it.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3 text-sm sm:px-5">
          <span className="min-w-0 flex-1 truncate text-slate-600">
            {file.original_filename} · {formatSize(file.size_bytes)}
            {file.is_dicom && seriesFiles.length > 1 && (
              <>
                {" "}
                · {file.series_description ? `${file.series_description}, ` : ""}image {inSeries} of {seriesFiles.length}
              </>
            )}
          </span>
          {files.length > 1 && (
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous file">
                ←
              </Button>
              <input
                type="range"
                min={0}
                max={files.length - 1}
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
                aria-label="Choose a file"
                className="min-w-0 flex-1 accent-brand-700 sm:w-48"
              />
              <span className="shrink-0 tabular-nums text-slate-600">
                {index + 1}/{files.length}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => go(1)}
                disabled={index === files.length - 1}
                aria-label="Next file"
              >
                →
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
