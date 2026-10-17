"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntryDialog } from "@/components/health/entry-dialog";
import { FileViewer, patientFileUrls } from "@/components/health/file-viewer";
import { ConsultationCard, DocumentGroups, EntryRow, QuickGlance, Timeline } from "@/components/health/history-views";
import { UploadDialog } from "@/components/health/upload-dialog";
import { RequireRole } from "@/components/require-role";
import {
  Alert,
  Button,
  Card,
  Container,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageLoading,
  Select,
  Textarea,
} from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { clinicToday } from "@/lib/format";
import { BLOOD_GROUPS, DOCUMENT_LABELS, KIND_LABELS, documentTitle } from "@/lib/health";
import type { TimelineItem } from "@/lib/health";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import type { BloodGroup, DocumentType, HealthEntry, HealthEntryKind, MedicalDocument, MedicalHistory } from "@/lib/types";

const KINDS: HealthEntryKind[] = ["allergy", "condition", "medication", "diagnosis", "surgery", "note"];
type Tab = "overview" | "timeline" | "documents";

function PrivacyButton({ isPrivate, onToggle }: { isPrivate: boolean; onToggle: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      aria-pressed={isPrivate}
      title={isPrivate ? "Private: never shared automatically" : "Shared with your doctors through appointments"}
      onClick={async () => {
        setBusy(true);
        try {
          await onToggle();
        } finally {
          setBusy(false);
        }
      }}
    >
      {isPrivate ? "🔒 Private" : "Make private"}
    </Button>
  );
}

function ProfileCard({ history, onSaved }: { history: MedicalHistory; onSaved: () => void }) {
  const p = history.profile;
  const [form, setForm] = useState({
    blood_group: (p?.blood_group ?? "") as BloodGroup | "",
    height_cm: p?.height_cm ? String(Number(p.height_cm)) : "",
    weight_kg: p?.weight_kg ? String(Number(p.weight_kg)) : "",
    is_private: p?.is_private ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api("/patients/me/medical-profile", {
        method: "PUT",
        body: {
          blood_group: form.blood_group || null,
          height_cm: form.height_cm ? Number(form.height_cm).toFixed(1) : null,
          weight_kg: form.weight_kg ? Number(form.weight_kg).toFixed(1) : null,
          is_private: form.is_private,
        },
      });
      setMessage({ tone: "success", text: "Saved." });
      onSaved();
    } catch (err) {
      setMessage({ tone: "error", text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Basic medical profile</h2>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
        <Field label="Blood group" htmlFor="p-blood">
          <Select
            id="p-blood"
            value={form.blood_group}
            onChange={(e) => setForm((f) => ({ ...f, blood_group: e.target.value as BloodGroup | "" }))}
          >
            <option value="">Not known</option>
            {BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Height (cm)" htmlFor="p-height">
          <Input
            id="p-height"
            type="number"
            inputMode="decimal"
            min={30}
            max={260}
            step={0.1}
            value={form.height_cm}
            onChange={(e) => setForm((f) => ({ ...f, height_cm: e.target.value }))}
          />
        </Field>
        <Field label="Weight (kg)" htmlFor="p-weight">
          <Input
            id="p-weight"
            type="number"
            inputMode="decimal"
            min={1}
            max={500}
            step={0.1}
            value={form.weight_kg}
            onChange={(e) => setForm((f) => ({ ...f, weight_kg: e.target.value }))}
          />
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-4">
          <input
            type="checkbox"
            checked={form.is_private}
            onChange={(e) => setForm((f) => ({ ...f, is_private: e.target.checked }))}
            className="accent-brand-700"
          />
          Keep these private (not shared with doctors automatically)
        </label>
      </form>
      {message && (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
    </Card>
  );
}

function DocumentEditDialog({
  document: d,
  onClose,
  onSaved,
}: {
  document: MedicalDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    document_type: d.document_type,
    report_date: d.report_date,
    title: d.title ?? "",
    provider_name: d.provider_name ?? "",
    description: d.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/me/documents/${d.id}`, { method: "PATCH", body: { ...form } });
      onSaved();
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-edit-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="doc-edit-title" className="text-lg font-bold text-ink">
          Edit document details
        </h2>
        <form onSubmit={save} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="d-type">
              <Select
                id="d-type"
                value={form.document_type}
                onChange={(e) => setForm((f) => ({ ...f, document_type: e.target.value as DocumentType }))}
              >
                {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date of the report" htmlFor="d-date">
              <Input
                id="d-date"
                type="date"
                required
                max={clinicToday()}
                value={form.report_date}
                onChange={(e) => setForm((f) => ({ ...f, report_date: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Title" htmlFor="d-title">
            <Input
              id="d-title"
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>
          <Field label="Doctor or hospital" htmlFor="d-provider">
            <Input
              id="d-provider"
              maxLength={255}
              value={form.provider_name}
              onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
            />
          </Field>
          <Field label="Description" htmlFor="d-desc">
            <Textarea
              id="d-desc"
              rows={3}
              maxLength={5000}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Dialog =
  | { type: "entry"; kind: HealthEntryKind; entry?: HealthEntry }
  | { type: "upload"; addTo?: MedicalDocument }
  | { type: "edit-document"; document: MedicalDocument }
  | { type: "delete-entry"; entry: HealthEntry }
  | { type: "delete-document"; document: MedicalDocument }
  | { type: "view"; document: MedicalDocument; fileId?: number };

function HealthRecord() {
  const params = useSearchParams();
  const requested = params.get("tab");
  const [tab, setTab] = useState<Tab>(requested === "timeline" || requested === "documents" ? requested : "overview");
  const [history, setHistory] = useState<{ data?: MedicalHistory; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // A doctor adding a consultation record (a notification) shows up without a reload.
  const liveTick = useLiveRefresh(60_000);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<MedicalHistory>("/patients/me/history")
      .then((data) => !cancelled && setHistory({ data }))
      .catch((e) => !cancelled && setHistory((prev) => (prev?.data ? prev : { error: messageOf(e) })));
    return () => {
      cancelled = true;
    };
  }, [version, liveTick]);

  const data = history?.data;
  const close = () => setDialog(null);
  const doneAndReload = () => {
    setDialog(null);
    reload();
  };

  async function setPrivate(path: string, isPrivate: boolean, method: "PATCH" = "PATCH") {
    await api(path, { method, body: { is_private: isPrivate } });
    reload();
  }

  function entryActions(e: HealthEntry): ReactNode {
    const doctors = e.source === "consultation";
    return (
      <>
        <PrivacyButton
          isPrivate={e.is_private}
          onToggle={() => setPrivate(`/patients/me/health-entries/${e.id}`, !e.is_private)}
        />
        {!doctors && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setDialog({ type: "entry", kind: e.kind, entry: e })}>
              Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDialog({ type: "delete-entry", entry: e })}>
              Delete
            </Button>
          </>
        )}
        {doctors && e.kind === "medication" && e.status === "active" && (
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await api(`/patients/me/health-entries/${e.id}`, {
                method: "PATCH",
                body: { status: "stopped", end_date: clinicToday() },
              });
              reload();
            }}
          >
            I&apos;ve stopped it
          </Button>
        )}
      </>
    );
  }

  function documentActions(d: MedicalDocument): ReactNode {
    return (
      <>
        <PrivacyButton isPrivate={d.is_private} onToggle={() => setPrivate(`/patients/me/documents/${d.id}`, !d.is_private)} />
        {d.source === "patient" && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setDialog({ type: "upload", addTo: d })}>
              Add files
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDialog({ type: "edit-document", document: d })}>
              Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDialog({ type: "delete-document", document: d })}>
              Delete
            </Button>
          </>
        )}
      </>
    );
  }

  function timelineActions(item: TimelineItem): ReactNode {
    if (item.entry)
      return (
        <PrivacyButton
          isPrivate={item.isPrivate}
          onToggle={() => setPrivate(`/patients/me/health-entries/${item.entry!.id}`, !item.isPrivate)}
        />
      );
    if (item.document)
      return (
        <PrivacyButton
          isPrivate={item.isPrivate}
          onToggle={() => setPrivate(`/patients/me/documents/${item.document!.id}`, !item.isPrivate)}
        />
      );
    if (item.consultation)
      return (
        <PrivacyButton
          isPrivate={item.isPrivate}
          onToggle={() => setPrivate(`/patients/me/consultations/${item.consultation!.id}`, !item.isPrivate)}
        />
      );
    return null;
  }

  const counts = data && {
    timeline:
      data.entries.filter((e) => e.consultation_id === null).length +
      data.documents.filter((d) => d.consultation_id === null).length +
      data.consultations.length,
    documents: data.documents.length,
  };

  return (
    <Container className="py-10">
      <PageHeader
        title="My health record"
        subtitle="Only you can change it. When you book, it's shared with that doctor — except anything you keep private."
        actions={
          <Button onClick={() => setDialog({ type: "upload" })} disabled={!data}>
            Upload document
          </Button>
        }
      />

      <div className="mt-6 flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist">
        {(["overview", "timeline", "documents"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-ink"}`}
          >
            {t === "overview"
              ? "Overview"
              : t === "timeline"
                ? `Timeline${counts ? ` (${counts.timeline})` : ""}`
                : `Documents${counts ? ` (${counts.documents})` : ""}`}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {!history && <p className="text-slate-500">Loading your health record…</p>}
        {history?.error && <Alert tone="error">{history.error}</Alert>}

        {data && tab === "overview" && (
          <div className="space-y-6">
            <QuickGlance history={data} />
            <ProfileCard history={data} onSaved={reload} />
            {KINDS.map((kind) => {
              const list = data.entries.filter((e) => e.kind === kind);
              return (
                <Card key={kind}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-ink">{KIND_LABELS[kind].many}</h2>
                    <Button variant="secondary" size="sm" onClick={() => setDialog({ type: "entry", kind })}>
                      + Add {KIND_LABELS[kind].one.toLowerCase()}
                    </Button>
                  </div>
                  {list.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">Nothing added yet.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-100">
                      {list.map((e) => (
                        <EntryRow key={e.id} entry={e} actions={entryActions(e)} />
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
            <section>
              <h2 className="mb-3 text-lg font-semibold text-ink">Consultation records</h2>
              {data.consultations.length === 0 ? (
                <EmptyState title="No consultation records yet">
                  After a consultation, your doctor&apos;s record appears here.
                </EmptyState>
              ) : (
                <div className="grid gap-3">
                  {data.consultations.map((c) => (
                    <ConsultationCard
                      key={c.id}
                      consultation={c}
                      onOpenDocument={(d, fileId) => setDialog({ type: "view", document: d, fileId })}
                      actions={
                        <PrivacyButton
                          isPrivate={c.is_private}
                          onToggle={() => setPrivate(`/patients/me/consultations/${c.id}`, !c.is_private)}
                        />
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {data && tab === "timeline" && (
          <Timeline
            history={data}
            onOpenDocument={(d) => setDialog({ type: "view", document: d })}
            actionsFor={timelineActions}
          />
        )}

        {data && tab === "documents" && (
          <DocumentGroups
            documents={data.documents}
            onOpen={(d, fileId) => setDialog({ type: "view", document: d, fileId })}
            actionsFor={documentActions}
            empty={
              <EmptyState title="No documents yet">
                Upload lab reports, prescriptions, X-rays and scans — including DICOM images from a hospital CD.
              </EmptyState>
            }
          />
        )}
      </div>

      {dialog?.type === "entry" && (
        <EntryDialog kind={dialog.kind} entry={dialog.entry} onClose={close} onSaved={doneAndReload} />
      )}
      {dialog?.type === "upload" && <UploadDialog addTo={dialog.addTo} onClose={close} onDone={doneAndReload} />}
      {dialog?.type === "edit-document" && (
        <DocumentEditDialog document={dialog.document} onClose={close} onSaved={doneAndReload} />
      )}
      {dialog?.type === "view" && (
        <FileViewer
          document={dialog.document}
          startFileId={dialog.fileId}
          urls={patientFileUrls(dialog.document.id)}
          onClose={close}
        />
      )}
      {dialog?.type === "delete-entry" && (
        <ConfirmDialog
          title={`Delete “${dialog.entry.title}”?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          tone="danger"
          onConfirm={async () => {
            await api(`/patients/me/health-entries/${dialog.entry.id}`, { method: "DELETE" });
            doneAndReload();
          }}
          onClose={close}
        >
          <p>
            It&apos;s removed from your health record, and doctors you share with won&apos;t see it any more. This can&apos;t be
            undone.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.type === "delete-document" && (
        <ConfirmDialog
          title={`Delete “${documentTitle(dialog.document)}”?`}
          confirmLabel="Delete document"
          busyLabel="Deleting…"
          tone="danger"
          onConfirm={async () => {
            await api(`/patients/me/documents/${dialog.document.id}`, { method: "DELETE" });
            doneAndReload();
          }}
          onClose={close}
        >
          <p>
            Its {dialog.document.files.length} file{dialog.document.files.length > 1 ? "s are" : " is"} deleted for good, and
            doctors you share with won&apos;t see it any more. This can&apos;t be undone.
          </p>
        </ConfirmDialog>
      )}
    </Container>
  );
}

export default function HealthRecordPage() {
  return (
    <RequireRole role="patient">
      <Suspense fallback={<PageLoading />}>
        <HealthRecord />
      </Suspense>
    </RequireRole>
  );
}
