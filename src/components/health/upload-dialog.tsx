"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, api, messageOf } from "@/lib/api";
import { clinicToday } from "@/lib/format";
import { DOCUMENT_LABELS, documentTitle } from "@/lib/health";
import type { DocumentType, MedicalDocument } from "@/lib/types";

import { Alert, Button, Field, Input, Select, Textarea } from "../ui";

// Files a CD export carries besides the images; never worth uploading.
const SKIP = /^(DICOMDIR|\..*|thumbs\.db|desktop\.ini|autorun\.inf|.*\.(exe|dll|inf|ini|htm|html|txt|xml|js|css|jar))$/i;

type Progress = { done: number; total: number; failed: { name: string; error: string }[] };

/** Upload a new record (or, with `addTo`, more files to an existing one). Several files can
 * be picked at once, or a whole folder — e.g. a hospital CD with a CT study's images. They
 * go up one at a time: the first creates the record, the rest join it. */
export function UploadDialog({ addTo, onClose, onDone }: { addTo?: MedicalDocument; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<DocumentType>("lab_report");
  // Scans usually carry their own date (DICOM): blank means "take it from the files".
  const [reportDate, setReportDate] = useState(clinicToday());
  const [dateTouched, setDateTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress.done < progress.total;
  const finished = progress !== null && progress.done === progress.total;
  const imaging = type === "xray" || type === "scan";
  const folderInput = useRef<HTMLInputElement>(null);

  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busyRef.current && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    // webkitdirectory isn't in React's typings; set it directly.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  function pick(list: FileList | null) {
    const picked = [...(list ?? [])].filter((f) => !SKIP.test(f.name) && f.size > 0);
    setFiles((prev) => [...prev, ...picked]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setError(null);
    const state: Progress = { done: 0, total: files.length, failed: [] };
    setProgress({ ...state });
    let documentId = addTo?.id ?? null;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file, file.name);
      try {
        if (documentId === null) {
          form.append("document_type", type);
          if (reportDate) form.append("report_date", reportDate);
          if (title.trim()) form.append("title", title.trim());
          if (provider.trim()) form.append("provider_name", provider.trim());
          if (description.trim()) form.append("description", description.trim());
          form.append("is_private", String(isPrivate));
          const created = await api<MedicalDocument>("/patients/me/documents", { method: "POST", body: form });
          documentId = created.id;
        } else {
          await api<MedicalDocument>(`/patients/me/documents/${documentId}/files`, { method: "POST", body: form });
        }
      } catch (err) {
        state.failed.push({ name: file.name, error: messageOf(err) });
        if (err instanceof ApiError && err.status === 0) {
          setError(messageOf(err));
          break; // offline: no point trying the rest
        }
      }
      state.done += 1;
      setProgress({ ...state, failed: [...state.failed] });
    }
    if (state.failed.length === 0) onDone();
  }

  const totalMb = files.reduce((n, f) => n + f.size, 0) / (1024 * 1024);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="upload-title" className="text-lg font-bold text-ink">
          {addTo ? `Add files to “${documentTitle(addTo)}”` : "Upload a medical document"}
        </h2>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {!addTo && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type" htmlFor="u-type" required>
                  <Select
                    id="u-type"
                    value={type}
                    onChange={(e) => {
                      const next = e.target.value as DocumentType;
                      setType(next);
                      if (!dateTouched) setReportDate(next === "xray" || next === "scan" ? "" : clinicToday());
                    }}
                    disabled={busy}
                  >
                    {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((t) => (
                      <option key={t} value={t}>
                        {DOCUMENT_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={imaging ? "Date of the scan" : "Date of the report"}
                  htmlFor="u-date"
                  required={!imaging}
                  hint={imaging ? "Leave blank to use the date inside the scan files (DICOM)" : undefined}
                >
                  <Input
                    id="u-date"
                    type="date"
                    required={!imaging}
                    max={clinicToday()}
                    value={reportDate}
                    onChange={(e) => {
                      setDateTouched(true);
                      setReportDate(e.target.value);
                    }}
                    disabled={busy}
                  />
                </Field>
              </div>
              <Field
                label="Title (optional)"
                htmlFor="u-title"
                hint={imaging ? "Left blank, it's taken from the scan (e.g. “CT scan · Chest”)" : undefined}
              >
                <Input
                  id="u-title"
                  maxLength={200}
                  value={title}
                  placeholder="e.g. Complete blood count"
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <Field label="Doctor or hospital (optional)" htmlFor="u-provider">
                <Input
                  id="u-provider"
                  maxLength={255}
                  value={provider}
                  placeholder="e.g. Chughtai Lab"
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <Field label="Description (optional)" htmlFor="u-desc">
                <Textarea
                  id="u-desc"
                  rows={2}
                  maxLength={5000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setPrivate(e.target.checked)}
                  disabled={busy}
                  className="mt-1 accent-brand-700"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">Keep private</span>
                  <span className="block text-sm text-slate-600">Never shared with a doctor automatically.</span>
                </span>
              </label>
            </>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">
              Files <span className="text-red-600">*</span>
            </p>
            <p className="text-xs text-slate-500">
              PDF, JPEG, PNG or WebP up to 10 MB each, or DICOM images from X-ray / CT / MRI machines up to 100 MB each.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50">
                Choose files
                <input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files)} />
              </label>
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50">
                Choose a folder (e.g. a scan CD)
                <input
                  ref={folderInput}
                  type="file"
                  multiple
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => pick(e.target.files)}
                />
              </label>
              {files.length > 0 && !busy && (
                <Button variant="ghost" size="sm" onClick={() => setFiles([])}>
                  Clear
                </Button>
              )}
            </div>
            {files.length > 0 && (
              <p className="text-sm text-slate-700">
                {files.length === 1 ? files[0].name : `${files.length} files`} · {totalMb.toFixed(1)} MB
              </p>
            )}
          </div>

          {progress && (
            <div role="status" className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand-700" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="text-sm text-slate-600">
                {busy
                  ? `Uploading ${progress.done + 1} of ${progress.total}…`
                  : `Uploaded ${progress.total - progress.failed.length} of ${progress.total}.`}
              </p>
            </div>
          )}
          {finished && progress.failed.length > 0 && (
            <Alert tone="warning">
              {progress.failed.length} file{progress.failed.length > 1 ? "s" : ""} couldn&apos;t be added:
              <ul className="mt-1 list-disc pl-5">
                {progress.failed.slice(0, 5).map((f, i) => (
                  <li key={i} className="break-words">
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
              {progress.failed.length > 5 && <p className="mt-1">…and {progress.failed.length - 5} more.</p>}
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {finished ? (
              <Button onClick={onDone}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || files.length === 0}>
                  {busy ? "Uploading…" : `Upload${files.length > 1 ? ` ${files.length} files` : ""}`}
                </Button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
