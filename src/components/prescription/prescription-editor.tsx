"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, Button, Card } from "@/components/ui";
import { ApiError, api, messageOf } from "@/lib/api";
import { addDays, clinicToday, formatDate, formatTime } from "@/lib/format";
import type {
  DiagnosisOption,
  MedicineOption,
  Prescription,
  PrescriptionWorkspace,
  RxContent,
  RxFollowUp,
  RxMedicine,
  RxPresets,
  RxTemplate,
  RxVitals,
  TestCategory,
  TestOption,
} from "@/lib/types";

import { RxSummary } from "./issued-view";
import { MedicineRow } from "./medicine-row";
import { PdfViewer } from "./pdf-viewer";
import { CATEGORY_LABELS, EMPTY_CONTENT, allergyMatches, mergeInto, norm, unitForForm } from "./rx-format";
import { SearchBox } from "./search-box";

const SAVE_DELAY_MS = 900;
const FOLLOW_UP_LABELS: Record<number, string> = { 2: "+2 days", 5: "+5 days", 7: "+7 days", 15: "+15 days", 30: "+1 month" };

// ---- what's sent: only values the server accepts, so half-typed vitals never block a save

const inRange = (v: string | number | null | undefined, min: number, max: number) =>
  v !== null && v !== undefined && v !== "" && Number(v) >= min && Number(v) <= max;

function cleanVitals(v: RxVitals): RxVitals {
  return {
    bp: v.bp && /^\d{2,3}\/\d{2,3}$/.test(v.bp) ? v.bp : null,
    pulse: inRange(v.pulse, 20, 250) ? Math.round(Number(v.pulse)) : null,
    temperature_f: inRange(v.temperature_f, 90, 110) ? String(Math.round(Number(v.temperature_f) * 10) / 10) : null,
    spo2: inRange(v.spo2, 50, 100) ? Math.round(Number(v.spo2)) : null,
    weight_kg: inRange(v.weight_kg, 0.1, 400) ? String(Math.round(Number(v.weight_kg) * 10) / 10) : null,
    height_cm: inRange(v.height_cm, 30, 250) ? String(Math.round(Number(v.height_cm) * 10) / 10) : null,
  };
}

function cleanFollowUp(f: RxFollowUp | null): RxFollowUp | null {
  if (!f) return null;
  const reducedOk = f.fee_type !== "reduced" || inRange(f.fee_amount, 0, 99_999_999);
  return { ...f, fee_type: reducedOk ? f.fee_type : "standard", fee_amount: f.fee_type === "reduced" && reducedOk ? f.fee_amount : null };
}

function cleanContent(c: RxContent): RxContent {
  return {
    ...c,
    complaint: c.complaint?.trim() || null,
    advice: c.advice?.trim() || null,
    vitals: cleanVitals(c.vitals),
    tests: c.tests.map((t) => ({ ...t, notes: t.notes?.trim() || null })),
    follow_up: cleanFollowUp(c.follow_up),
  };
}

// ---- small pieces

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-5">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function QuickChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand-700 bg-brand-700 font-semibold text-white" : "border-slate-300 bg-white text-ink hover:border-brand-700 hover:bg-brand-50"}`}
    >
      {on ? "✓ " : "+ "}
      {children}
    </button>
  );
}

function Pill({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-1 text-sm text-ink">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-full px-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700"
      >
        ✕
      </button>
    </span>
  );
}

const fieldClass =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

function SaveState({ state, onReload }: { state: string; onReload: () => void }) {
  if (state === "conflict") {
    return (
      <span className="text-xs font-semibold text-amber-800">
        Changed in another window.{" "}
        <button type="button" onClick={onReload} className="underline">
          Reload
        </button>
      </span>
    );
  }
  const text: Record<string, string> = { saving: "Saving…", saved: "All changes saved", unsaved: "Saving soon…", error: "Not saved — retrying" };
  return (
    <span role="status" className={`text-xs ${state === "error" ? "font-semibold text-red-700" : "text-slate-500"}`}>
      {text[state] ?? ""}
    </span>
  );
}

// ---- the editor

type Viewing = { id: number; number: string; title: string };

/**
 * The visit's prescription for its doctor: start it, write it (quick options from their
 * specialty and their own most used items, search for anything else), preview the PDF, issue
 * it (locked for good), then view, correct or cancel it. Everything is saved as you go.
 * `legacyFallback` is shown instead for a visit whose consultation record predates this.
 */
export function PrescriptionEditor({ appointmentId, legacyFallback }: { appointmentId: number; legacyFallback?: ReactNode }) {
  const [ws, setWs] = useState<PrescriptionWorkspace | null>(null);
  const [presets, setPresets] = useState<RxPresets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState<RxContent>(EMPTY_CONTENT);
  const [saveState, setSaveState] = useState("saved");
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [dialog, setDialog] = useState<"issue" | "cancel" | "discard" | "template" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<RxTemplate[] | null>(null);
  const [testCategory, setTestCategory] = useState<TestCategory>("pathology");
  const [showVitals, setShowVitals] = useState(false);

  const draft = ws?.draft ?? null;
  const versionRef = useRef(0);
  const pending = useRef<RxContent | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<number | null>(null);

  const adopt = useCallback((next: PrescriptionWorkspace) => {
    setWs(next);
    draftIdRef.current = next.draft?.id ?? null;
    if (next.draft) {
      versionRef.current = next.draft.version;
      setContent(next.draft.content);
      setShowVitals(Object.values(next.draft.content.vitals ?? {}).some((v) => v !== null && v !== undefined));
    }
    pending.current = null;
    setSaveState("saved");
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [workspace, quick] = await Promise.all([
        api<PrescriptionWorkspace>(`/prescriptions/appointments/${appointmentId}`),
        api<RxPresets>("/prescriptions/presets"),
      ]);
      adopt(workspace);
      setPresets(quick);
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, [appointmentId, adopt]);

  useEffect(() => {
    // Loading data for the editor when it mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // ---- saving as you go

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    const next = pending.current;
    const id = draftIdRef.current;
    if (!next || id === null) return true;
    pending.current = null;
    setSaveState("saving");
    const run = api<Prescription>(`/prescriptions/${id}`, {
      method: "PUT",
      body: { version: versionRef.current, content: cleanContent(next) },
    })
      .then((saved) => {
        versionRef.current = saved.version;
        setSaveState(pending.current ? "unsaved" : "saved");
        return true;
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 409) {
          setSaveState("conflict");
          setNotice({ tone: "error", text: e.message });
          return false;
        }
        pending.current = pending.current ?? next; // try again with the next change (or on issue)
        setSaveState("error");
        if (e instanceof ApiError && e.status === 422) setNotice({ tone: "error", text: e.message });
        return false;
      });
    inFlight.current = run;
    const ok = await run;
    inFlight.current = null;
    return ok;
  }, []);

  const change = useCallback(
    (update: (c: RxContent) => RxContent) => {
      setContent((current) => {
        const next = update(current);
        pending.current = next;
        return next;
      });
      setSaveState("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Leaving with unsaved changes: save them now, and ask the browser to hold on if needed.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      if (pending.current) void flush();
    };
  }, [flush]);

  // ---- actions

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice({ tone: "error", text: messageOf(e) });
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => adopt(await api<PrescriptionWorkspace>(`/prescriptions/appointments/${appointmentId}`, { method: "POST" })));

  async function preview() {
    if (!draft) return;
    await flush();
    setViewing({ id: draft.id, number: draft.number, title: `Preview of ${draft.number} (draft)` });
  }

  function readyProblem(): string | null {
    if (ws?.issue_blocked) return ws.issue_blocked;
    if (content.diagnoses.length === 0) return "Add at least one diagnosis.";
    const missing = content.medicines.find((m) => !m.dose && !m.instructions);
    if (missing) return `Choose how to take ${missing.name} (a dose or instructions).`;
    if (content.follow_up?.fee_type === "reduced" && !inRange(content.follow_up.fee_amount, 0, 99_999_999)) {
      return "Enter the reduced follow-up fee.";
    }
    return null;
  }

  async function issueNow() {
    if (!draft) return;
    if (!(await flush())) throw new Error("Couldn't save the latest changes. Check them and try again.");
    const next = await api<PrescriptionWorkspace>(`/prescriptions/${draft.id}/issue`, {
      method: "POST",
      body: { version: versionRef.current },
    });
    adopt(next);
    setDialog(null);
    setNotice({ tone: "success", text: `Prescription ${next.issued?.number} issued. The patient can view and download it now.` });
  }

  async function applyTemplate(t: RxTemplate) {
    change((c) => {
      const merged = mergeInto(c, t.content);
      if (!merged.follow_up && t.content.follow_up_days && ws) merged.follow_up = followUpIn(t.content.follow_up_days);
      return merged;
    });
    setNotice({ tone: "info", text: `Added “${t.name}”. Check it, then preview and issue.` });
  }

  async function repeatLast() {
    if (!ws) return;
    await run(async () => {
      const last = await api<RxContent | null>(
        `/prescriptions/last?patient_id=${ws.patient.id}&exclude_appointment_id=${appointmentId}`,
      );
      if (!last) {
        setNotice({ tone: "info", text: "You haven't issued an earlier prescription for this patient." });
        return;
      }
      change((c) => mergeInto(c, last));
      setNotice({ tone: "info", text: "Added your last prescription for this patient. Check doses and durations." });
    });
  }

  async function saveTemplate() {
    const visit = ws?.appointment.date ?? clinicToday();
    const days = content.follow_up
      ? Math.round((Date.parse(content.follow_up.target_date) - Date.parse(visit)) / 86_400_000)
      : null;
    const clean = cleanContent(content);
    const saved = await api<RxTemplate>("/prescriptions/templates", {
      method: "POST",
      body: {
        name: templateName.trim(),
        content: {
          complaint: clean.complaint,
          diagnoses: clean.diagnoses,
          tests: clean.tests,
          medicines: clean.medicines,
          advice: clean.advice,
          follow_up_days: days && days > 0 ? days : null,
        },
      },
    });
    setTemplates(null);
    setDialog(null);
    setTemplateName("");
    setNotice({ tone: "success", text: `Saved as template “${saved.name}”.` });
  }

  function followUpIn(days: number): RxFollowUp {
    const base = ws?.appointment.date ?? clinicToday();
    const today = clinicToday();
    return {
      target_date: addDays(base > today ? base : today, days),
      flexibility: "plus_minus_2_days",
      consultation_type: ws?.doctor.offers_online === false ? "clinic" : "online",
      reason: null,
      fee_type: "standard",
      fee_amount: null,
    };
  }

  // ---- rendering

  if (loadError) {
    return (
      <Alert tone="error">
        {loadError}{" "}
        <button type="button" onClick={() => void load()} className="font-semibold underline">
          Try again
        </button>
      </Alert>
    );
  }
  if (!ws || !presets) return <p className="text-sm text-slate-500">Loading the prescription…</p>;
  if (ws.legacy_consultation && legacyFallback) return <>{legacyFallback}</>;

  const p = ws.patient;
  const allergies = p.allergies.map((a) => a.name);
  const patientLine = [p.age_years !== null ? `${p.age_years} years` : null, p.gender, p.weight_kg ? `${Number(p.weight_kg)} kg` : null, p.blood_group ? `Blood group ${p.blood_group}` : null]
    .filter(Boolean)
    .join(" · ");

  const header = (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold text-ink">{p.name ?? "Patient"}</p>
        <p className="text-sm text-slate-600">
          Visit {formatDate(ws.appointment.date)} at {formatTime(ws.appointment.start_time)}
        </p>
      </div>
      {patientLine && <p className="text-sm text-slate-700">{patientLine}</p>}
      {!p.history_shared && <p className="mt-1 text-xs text-slate-500">Age, weight and allergies show here while the patient shares their history with this visit.</p>}
      {allergies.length > 0 && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800">
          Allergies: {p.allergies.map((a) => a.name + (a.reaction ? ` (${a.reaction})` : "")).join(", ")}
        </p>
      )}
      {ws.appointment.reason_for_visit && <p className="mt-1 text-sm text-slate-600">Reason for visit: {ws.appointment.reason_for_visit}</p>}
    </div>
  );

  const history = ws.history.length > 0 && (
    <div className="mt-6">
      <h4 className="text-sm font-semibold text-ink">Earlier versions</h4>
      <ul className="mt-2 space-y-1 text-sm">
        {ws.history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{h.number}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${h.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
              {h.status === "cancelled" ? "Cancelled" : "Replaced"}
            </span>
            {h.cancel_reason && <span className="text-slate-500">“{h.cancel_reason}”</span>}
            <button type="button" onClick={() => setViewing({ id: h.id, number: h.number, title: `${h.number} (${h.status})` })} className="font-semibold text-brand-700 hover:underline">
              View PDF
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const dialogs = (
    <>
      {viewing && <PdfViewer prescriptionId={viewing.id} number={viewing.number} title={viewing.title} onClose={() => setViewing(null)} />}
      {dialog === "issue" && draft && (
        <ConfirmDialog
          title={`Issue prescription ${draft.number}?`}
          confirmLabel="Issue prescription"
          busyLabel="Issuing…"
          onConfirm={issueNow}
          onClose={() => setDialog(null)}
        >
          <p>
            Once issued it&apos;s <strong>locked</strong>: it can&apos;t be edited. {p.name ?? "The patient"} can view and download it straight
            away, and it&apos;s added to their medical history{content.follow_up ? " with the follow-up" : ""}.
          </p>
          <p className="mt-2 text-sm text-slate-600">To change it later you&apos;d issue a corrected version.</p>
        </ConfirmDialog>
      )}
      {dialog === "discard" && draft && (
        <ConfirmDialog
          title="Discard this draft?"
          confirmLabel="Discard draft"
          busyLabel="Discarding…"
          tone="danger"
          onConfirm={async () => {
            if (timer.current) clearTimeout(timer.current);
            pending.current = null;
            await api(`/prescriptions/${draft.id}`, { method: "DELETE" });
            setDialog(null);
            await load();
          }}
          onClose={() => setDialog(null)}
        >
          <p>Everything written in it is deleted. Nothing has been sent to the patient.</p>
        </ConfirmDialog>
      )}
      {dialog === "cancel" && ws.issued && (
        <ConfirmDialog
          title={`Cancel prescription ${ws.issued.number}?`}
          confirmLabel="Cancel prescription"
          busyLabel="Cancelling…"
          cancelLabel="Keep it"
          tone="danger"
          onConfirm={async () => {
            if (cancelReason.trim().length < 3) throw new Error("Tell the patient why it's cancelled.");
            adopt(await api<PrescriptionWorkspace>(`/prescriptions/${ws.issued!.id}/cancel`, { method: "POST", body: { reason: cancelReason.trim() } }));
            setDialog(null);
            setCancelReason("");
            setNotice({ tone: "info", text: "Prescription cancelled. The patient has been told." });
          }}
          onClose={() => setDialog(null)}
        >
          <p>It&apos;s removed from the patient&apos;s history and they&apos;re told it&apos;s no longer valid. To fix a mistake instead, use Correct.</p>
          <label htmlFor="rx-cancel-reason" className="mt-3 block text-sm font-medium text-ink">
            Reason (the patient sees it)
          </label>
          <textarea id="rx-cancel-reason" rows={2} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={`${fieldClass} mt-1`} />
        </ConfirmDialog>
      )}
      {dialog === "template" && (
        <ConfirmDialog
          title="Save as a template"
          confirmLabel="Save template"
          busyLabel="Saving…"
          onConfirm={async () => {
            if (!templateName.trim()) throw new Error("Give the template a name.");
            await saveTemplate();
          }}
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-slate-600">Diagnoses, medicines, tests and advice are saved (not the patient&apos;s vitals). Saving under an existing name replaces it.</p>
          <label htmlFor="rx-template-name" className="mt-3 block text-sm font-medium text-ink">
            Template name
          </label>
          <input id="rx-template-name" maxLength={80} value={templateName} placeholder="e.g. Viral URTI – adult" onChange={(e) => setTemplateName(e.target.value)} className={`${fieldClass} mt-1`} />
        </ConfirmDialog>
      )}
    </>
  );

  const alert = notice && (
    <Alert tone={notice.tone}>
      {notice.text}
      {ws.issue_blocked && notice.text === ws.issue_blocked && (
        <>
          {" "}
          <Link href="/doctor/profile" className="font-semibold underline">
            Open your profile
          </Link>
        </>
      )}
    </Alert>
  );

  // ---- no draft: start one, or show the issued prescription

  if (!draft) {
    return (
      <div className="space-y-4">
        {header}
        {alert}
        {ws.write_blocked && <Alert tone="info">{ws.write_blocked}</Alert>}
        {ws.issued ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-ink">
                  Prescription {ws.issued.number}{" "}
                  <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 align-middle text-xs font-semibold text-emerald-800">Issued</span>
                </p>
                <p className="text-sm text-slate-600">
                  {ws.issued.issued_at && `Issued ${new Date(ws.issued.issued_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
                  {ws.issued.replaces_number && ` · replaces ${ws.issued.replaces_number}`} · Locked
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setViewing({ id: ws.issued!.id, number: ws.issued!.number, title: `Prescription ${ws.issued!.number}` })}>View / download PDF</Button>
                {!ws.write_blocked && (
                  <>
                    <Button variant="secondary" disabled={busy} onClick={() => run(async () => adopt(await api<PrescriptionWorkspace>(`/prescriptions/${ws.issued!.id}/revise`, { method: "POST" })))}>
                      Correct
                    </Button>
                    <Button variant="danger" onClick={() => setDialog("cancel")}>
                      Cancel prescription
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4">
              <RxSummary content={ws.issued.content} />
            </div>
            {history}
          </Card>
        ) : (
          !ws.write_blocked && (
            <Card className="text-center">
              <p className="text-lg font-semibold text-ink">Write the prescription</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                Quick options for {presets.profile_label.toLowerCase()} are ready. It saves as you go; the patient sees it only once you issue it.
              </p>
              <Button size="lg" className="mt-4" disabled={busy} onClick={start}>
                {busy ? "Starting…" : "Start prescription"}
              </Button>
              {history}
            </Card>
          )
        )}
        {ws.write_blocked && !ws.issued && history}
        {dialogs}
      </div>
    );
  }

  // ---- the draft

  const readOnly = !!ws.write_blocked;
  const has = (list: { name: string }[], name: string) => list.some((x) => norm(x.name) === norm(name));
  const toggleIn = <T extends { name: string }>(list: T[], item: T) => (has(list, item.name) ? list.filter((x) => norm(x.name) !== norm(item.name)) : [...list, item]);
  const complaintParts = (content.complaint ?? "").split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  const adviceLines = (content.advice ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const followDays = content.follow_up
    ? Math.round((Date.parse(content.follow_up.target_date) - Date.parse(ws.appointment.date > clinicToday() ? ws.appointment.date : clinicToday())) / 86_400_000)
    : null;
  const problem = readyProblem();

  function addMedicine(m: RxMedicine) {
    change((c) => ({ ...c, medicines: [...c.medicines, m] }));
  }

  return (
    <div className="space-y-4">
      {header}
      {alert}
      {readOnly && <Alert tone="info">{ws.write_blocked}</Alert>}
      {draft.replaces_number && (
        <Alert tone="info">
          Correcting {draft.replaces_number}. It stays valid for the patient until you issue this version.
        </Alert>
      )}

      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-ink">
              Prescription {draft.number}{" "}
              <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-800">Draft</span>
            </p>
            <SaveState state={saveState} onReload={() => void load()} />
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <details className="relative" onToggle={(e) => (e.target as HTMLDetailsElement).open && templates === null && void api<RxTemplate[]>("/prescriptions/templates").then(setTemplates).catch(() => setTemplates([]))}>
                <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50">
                  Templates ▾
                </summary>
                <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  {templates === null ? (
                    <p className="px-2 py-1 text-sm text-slate-500">Loading…</p>
                  ) : templates.length === 0 ? (
                    <p className="px-2 py-1 text-sm text-slate-500">No templates yet. Write a prescription, then “Save as template”.</p>
                  ) : (
                    <ul>
                      {templates.map((t) => (
                        <li key={t.id} className="flex items-center gap-1">
                          <button type="button" onClick={() => void applyTemplate(t)} className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-brand-50">
                            {t.name}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete template ${t.name}`}
                            onClick={() =>
                              void api(`/prescriptions/templates/${t.id}`, { method: "DELETE" }).then(() => setTemplates((list) => list?.filter((x) => x.id !== t.id) ?? null))
                            }
                            className="rounded px-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-700"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" onClick={() => setDialog("template")} className="mt-1 w-full rounded border-t border-slate-100 px-2 py-1.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50">
                    + Save this prescription as a template
                  </button>
                </div>
              </details>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void repeatLast()}>
                Repeat last
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void preview()}>
                Preview PDF
              </Button>
            </div>
          )}
        </div>

        <fieldset disabled={readOnly} className="space-y-5">
          {/* 1. Complaint & diagnosis */}
          <Section title="1. Complaint & diagnosis" hint={`Quick options for ${presets.profile_label}; your most used come first.`}>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Chief complaint</p>
              <div className="flex flex-wrap gap-1.5">
                {presets.complaints.map((c) => (
                  <QuickChip
                    key={c}
                    on={complaintParts.some((x) => norm(x) === norm(c))}
                    onClick={() =>
                      change((cur) => {
                        const parts = (cur.complaint ?? "").split(/,\s*/).map((s) => s.trim()).filter(Boolean);
                        const next = parts.some((x) => norm(x) === norm(c)) ? parts.filter((x) => norm(x) !== norm(c)) : [...parts, c];
                        return { ...cur, complaint: next.join(", ") || null };
                      })
                    }
                  >
                    {c}
                  </QuickChip>
                ))}
              </div>
              <label htmlFor="rx-complaint" className="sr-only">
                Chief complaint
              </label>
              <textarea
                id="rx-complaint"
                rows={2}
                maxLength={2000}
                value={content.complaint ?? ""}
                onChange={(e) => change((c) => ({ ...c, complaint: e.target.value }))}
                placeholder="Symptoms, in the patient's words…"
                className={`${fieldClass} mt-2`}
              />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">
                Diagnosis <span className="text-red-600">*</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {presets.diagnoses.map((d) => (
                  <QuickChip key={d.name} on={has(content.diagnoses, d.name)} onClick={() => change((c) => ({ ...c, diagnoses: toggleIn(c.diagnoses, d) }))}>
                    {d.name}
                  </QuickChip>
                ))}
              </div>
              <div className="mt-2">
                <SearchBox<DiagnosisOption>
                  label="Search diagnoses"
                  placeholder="Search a diagnosis or ICD-10 code (e.g. typhoid, J06)…"
                  search={(q) => api<DiagnosisOption[]>(`/prescriptions/catalog/diagnoses?q=${encodeURIComponent(q)}`)}
                  renderItem={(d) => (
                    <span className="flex justify-between gap-2">
                      <span>
                        {d.name} {d.mine && <span className="ml-1 rounded bg-brand-50 px-1 text-xs text-brand-800">yours</span>}
                      </span>
                      {d.code && <span className="text-xs text-slate-500">{d.code}</span>}
                    </span>
                  )}
                  onPick={(d) => change((c) => (has(c.diagnoses, d.name) ? c : { ...c, diagnoses: [...c.diagnoses, { name: d.name, code: d.code }] }))}
                  onFreeText={(text) => change((c) => (has(c.diagnoses, text) ? c : { ...c, diagnoses: [...c.diagnoses, { name: text, code: null }] }))}
                />
              </div>
              {content.diagnoses.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {content.diagnoses.map((d) => (
                    <Pill key={d.name} label={d.name} onRemove={() => change((c) => ({ ...c, diagnoses: c.diagnoses.filter((x) => x.name !== d.name) }))}>
                      {d.name}
                      {d.code && <span className="text-xs text-slate-500">{d.code}</span>}
                    </Pill>
                  ))}
                </div>
              )}
            </div>

            <div>
              {!showVitals ? (
                <button type="button" onClick={() => setShowVitals(true)} className="text-sm font-semibold text-brand-700 hover:underline">
                  + Add vitals (optional)
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      ["bp", "BP (mmHg)", "120/80", "text"],
                      ["pulse", "Pulse (/min)", "78", "number"],
                      ["temperature_f", "Temp (°F)", "98.6", "number"],
                      ["spo2", "SpO2 (%)", "98", "number"],
                      ["weight_kg", "Weight (kg)", "70", "number"],
                      ["height_cm", "Height (cm)", "170", "number"],
                    ] as const
                  ).map(([key, label, ph, type]) => {
                    const raw = content.vitals[key];
                    const clean = cleanVitals(content.vitals)[key];
                    const invalid = raw !== null && raw !== undefined && raw !== "" && (clean === null || clean === undefined);
                    return (
                      <div key={key}>
                        <label htmlFor={`rx-v-${key}`} className="block text-xs font-medium text-slate-600">
                          {label}
                        </label>
                        <input
                          id={`rx-v-${key}`}
                          type={type}
                          inputMode={type === "number" ? "decimal" : "text"}
                          step="any"
                          placeholder={ph}
                          value={raw ?? ""}
                          onChange={(e) => change((c) => ({ ...c, vitals: { ...c.vitals, [key]: e.target.value || null } }))}
                          className={`${fieldClass} mt-0.5 ${invalid ? "border-amber-400" : ""}`}
                        />
                        {invalid && <p className="text-[11px] text-amber-700">Check this value</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Section>

          {/* 2. Tests */}
          <Section title="2. Lab tests & investigations" hint="Pathology, radiology and clinical investigations, each with an optional note.">
            <div className="flex flex-wrap gap-1.5">
              {presets.tests.map((t) => (
                <QuickChip key={t.name} on={has(content.tests, t.name)} onClick={() => change((c) => ({ ...c, tests: toggleIn(c.tests, { ...t, notes: null }) }))}>
                  {t.name}
                </QuickChip>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="rx-test-category" className="sr-only">
                Category for a test you type
              </label>
              <select id="rx-test-category" value={testCategory} onChange={(e) => setTestCategory(e.target.value as TestCategory)} className={`${fieldClass} sm:w-56`}>
                {(Object.keys(CATEGORY_LABELS) as TestCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <div className="flex-1">
                <SearchBox<TestOption>
                  label="Search tests"
                  placeholder="Search a test (e.g. CBC, ultrasound abdomen, ECG)…"
                  search={(q) => api<TestOption[]>(`/prescriptions/catalog/tests?q=${encodeURIComponent(q)}`)}
                  renderItem={(t) => (
                    <span className="flex justify-between gap-2">
                      <span>
                        {t.name} {t.mine && <span className="ml-1 rounded bg-brand-50 px-1 text-xs text-brand-800">yours</span>}
                      </span>
                      <span className="text-xs text-slate-500">{CATEGORY_LABELS[t.category]}</span>
                    </span>
                  )}
                  onPick={(t) => change((c) => (has(c.tests, t.name) ? c : { ...c, tests: [...c.tests, { name: t.name, category: t.category, notes: null }] }))}
                  onFreeText={(text) => change((c) => (has(c.tests, text) ? c : { ...c, tests: [...c.tests, { name: text, category: testCategory, notes: null }] }))}
                />
              </div>
            </div>
            {content.tests.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {content.tests.map((t, i) => (
                  <li key={t.name} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 sm:w-1/2">
                      <p className="truncate text-sm font-semibold text-ink">{t.name}</p>
                      <p className="text-xs text-slate-500">{CATEGORY_LABELS[t.category]}</p>
                    </div>
                    <label htmlFor={`rx-test-note-${i}`} className="sr-only">
                      Note for {t.name}
                    </label>
                    <input
                      id={`rx-test-note-${i}`}
                      placeholder="Note (e.g. fasting, both knees)"
                      maxLength={300}
                      value={t.notes ?? ""}
                      onChange={(e) => change((c) => ({ ...c, tests: c.tests.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)) }))}
                      className={`${fieldClass} flex-1 py-1.5`}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${t.name}`}
                      onClick={() => change((c) => ({ ...c, tests: c.tests.filter((_, j) => j !== i) }))}
                      className="self-end rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700 sm:self-auto"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 3. Medicines */}
          <Section title="3. Medicines" hint="Type a brand or a composition. Tap a dose, when and how long — or type your own.">
            <div className="flex flex-wrap gap-1.5">
              {presets.medicines.map((m) => {
                const on = content.medicines.some((x) => norm(x.name) === norm(m.name) && norm(x.strength) === norm(m.strength));
                return (
                  <QuickChip
                    key={`${m.name}-${m.strength}`}
                    on={on}
                    onClick={() =>
                      change((c) => ({
                        ...c,
                        medicines: on
                          ? c.medicines.filter((x) => !(norm(x.name) === norm(m.name) && norm(x.strength) === norm(m.strength)))
                          : [...c.medicines, m],
                      }))
                    }
                  >
                    {[m.name, m.strength].filter(Boolean).join(" ")}
                  </QuickChip>
                );
              })}
            </div>
            <SearchBox<MedicineOption>
              label="Search medicines"
              placeholder="Search a medicine — brand or composition (e.g. Augmentin, paracetamol 500)…"
              search={(q) => api<MedicineOption[]>(`/prescriptions/catalog/medicines?q=${encodeURIComponent(q)}`)}
              renderItem={(m) => (
                <span className="block">
                  <span className="font-semibold text-ink">{m.name}</span> <span className="text-slate-700">{[m.strength, m.form].filter(Boolean).join(" ")}</span>
                  {m.mine && <span className="ml-1 rounded bg-brand-50 px-1 text-xs text-brand-800">yours</span>}
                  {(m.generic && m.generic.toLowerCase() !== m.name.toLowerCase()) || m.manufacturer ? (
                    <span className="block truncate text-xs text-slate-500">{[m.generic !== m.name ? m.generic : null, m.manufacturer].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </span>
              )}
              onPick={(m) =>
                addMedicine(
                  m.last_used ?? {
                    name: m.name,
                    generic: m.generic,
                    strength: m.strength,
                    form: m.form,
                    unit: unitForForm(m.form),
                    dose: null,
                    timing: null,
                    duration_value: null,
                    duration_unit: null,
                    instructions: null,
                  },
                )
              }
              onFreeText={(text) => addMedicine({ name: text, dose: null, timing: null, unit: null })}
            />
            {content.medicines.length > 0 && (
              <ul className="space-y-2">
                {content.medicines.map((m, i) => (
                  <MedicineRow
                    key={i}
                    index={i}
                    medicine={m}
                    presets={presets}
                    allergies={allergies}
                    duplicate={content.medicines.some((x, j) => j < i && norm(x.name) === norm(m.name) && norm(x.strength) === norm(m.strength))}
                    onChange={(next) => change((c) => ({ ...c, medicines: c.medicines.map((x, j) => (j === i ? next : x)) }))}
                    onRemove={() => change((c) => ({ ...c, medicines: c.medicines.filter((_, j) => j !== i) }))}
                  />
                ))}
              </ul>
            )}
            {content.medicines.some((m) => allergyMatches(m, allergies).length > 0) && (
              <p className="text-xs text-red-700">Allergy warnings are reminders from the patient&apos;s history — please check them.</p>
            )}
          </Section>

          {/* 4. Advice & follow-up */}
          <Section title="4. Advice & follow-up">
            <div className="flex flex-wrap gap-1.5">
              {presets.advice.map((a) => (
                <QuickChip
                  key={a}
                  on={adviceLines.some((x) => norm(x) === norm(a))}
                  onClick={() =>
                    change((cur) => {
                      const lines = (cur.advice ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
                      const next = lines.some((x) => norm(x) === norm(a)) ? lines.filter((x) => norm(x) !== norm(a)) : [...lines, a];
                      return { ...cur, advice: next.join("\n") || null };
                    })
                  }
                >
                  {a}
                </QuickChip>
              ))}
            </div>
            <label htmlFor="rx-advice" className="sr-only">
              Advice
            </label>
            <textarea
              id="rx-advice"
              rows={3}
              maxLength={3000}
              value={content.advice ?? ""}
              onChange={(e) => change((c) => ({ ...c, advice: e.target.value }))}
              placeholder="One piece of advice per line…"
              className={fieldClass}
            />

            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Follow-up</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {presets.follow_up_days.map((d) => (
                  <QuickChip key={d} on={followDays === d} onClick={() => change((c) => ({ ...c, follow_up: { ...(c.follow_up ?? followUpIn(d)), target_date: followUpIn(d).target_date } }))}>
                    {FOLLOW_UP_LABELS[d] ?? `+${d} days`}
                  </QuickChip>
                ))}
                <QuickChip on={!content.follow_up} onClick={() => change((c) => ({ ...c, follow_up: null }))}>
                  No follow-up
                </QuickChip>
                <label htmlFor="rx-follow-date" className="sr-only">
                  Follow-up date
                </label>
                <input
                  id="rx-follow-date"
                  type="date"
                  min={addDays(clinicToday(), 1)}
                  value={content.follow_up?.target_date ?? ""}
                  onChange={(e) =>
                    change((c) => ({ ...c, follow_up: e.target.value ? { ...(c.follow_up ?? followUpIn(presets.default_follow_up_days)), target_date: e.target.value } : null }))
                  }
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              {content.follow_up && (
                <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="text-ink">
                    Around <strong>{formatDate(content.follow_up.target_date)}</strong> — the patient gets a one-tap booking for it.
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <select
                      aria-label="How exact"
                      value={content.follow_up.flexibility}
                      onChange={(e) => change((c) => ({ ...c, follow_up: c.follow_up && { ...c.follow_up, flexibility: e.target.value as RxFollowUp["flexibility"] } }))}
                      className={fieldClass}
                    >
                      <option value="exact">On that day</option>
                      <option value="plus_minus_2_days">Give or take 2 days</option>
                      <option value="plus_minus_1_week">Give or take a week</option>
                      <option value="within_2_weeks_after">Within 2 weeks after</option>
                    </select>
                    <select
                      aria-label="Consultation type"
                      value={content.follow_up.consultation_type}
                      onChange={(e) => change((c) => ({ ...c, follow_up: c.follow_up && { ...c.follow_up, consultation_type: e.target.value as RxFollowUp["consultation_type"] } }))}
                      className={fieldClass}
                    >
                      <option value="online">Online consultation</option>
                      <option value="clinic">Clinic visit</option>
                    </select>
                    <div className="flex gap-2">
                      <select
                        aria-label="Follow-up fee"
                        value={content.follow_up.fee_type}
                        onChange={(e) => change((c) => ({ ...c, follow_up: c.follow_up && { ...c.follow_up, fee_type: e.target.value as RxFollowUp["fee_type"] } }))}
                        className={fieldClass}
                      >
                        <option value="standard">Standard fee</option>
                        <option value="free">Free</option>
                        <option value="reduced">Reduced fee</option>
                      </select>
                      {content.follow_up.fee_type === "reduced" && (
                        <input
                          aria-label="Reduced fee (Rs.)"
                          type="number"
                          min={0}
                          placeholder="Rs."
                          value={content.follow_up.fee_amount ?? ""}
                          onChange={(e) => change((c) => ({ ...c, follow_up: c.follow_up && { ...c.follow_up, fee_amount: e.target.value || null } }))}
                          className={`${fieldClass} w-24`}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </fieldset>

        {!readOnly && (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="danger" size="sm" onClick={() => setDialog("discard")}>
              Discard draft
            </Button>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {problem && <p className="text-sm text-amber-800">{problem}</p>}
              <Button variant="secondary" onClick={() => void preview()}>
                Preview PDF
              </Button>
              <Button
                onClick={() => {
                  if (problem) {
                    setNotice({ tone: "error", text: problem });
                    return;
                  }
                  setDialog("issue");
                }}
              >
                Issue prescription
              </Button>
            </div>
          </div>
        )}
      </Card>
      {history}
      {dialogs}
    </div>
  );
}
