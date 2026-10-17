"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { api, messageOf } from "@/lib/api";
import { clinicToday } from "@/lib/format";
import { KIND_LABELS } from "@/lib/health";
import type { AllergySeverity, EntryStatus, HealthEntry, HealthEntryKind } from "@/lib/types";

import { Alert, Button, Field, Input, Textarea } from "../ui";

const WORDS: Record<HealthEntryKind, { title: string; placeholder: string; date: string; details: string }> = {
  allergy: {
    title: "Allergic to",
    placeholder: "e.g. Penicillin, peanuts, dust",
    date: "First noticed (optional)",
    details: "Notes",
  },
  condition: {
    title: "Condition",
    placeholder: "e.g. Type 2 diabetes, asthma",
    date: "Diagnosed on (optional)",
    details: "Notes",
  },
  medication: { title: "Medicine", placeholder: "e.g. Metformin", date: "Started on (optional)", details: "Notes" },
  diagnosis: { title: "Diagnosis", placeholder: "e.g. Typhoid fever", date: "When (optional)", details: "Notes" },
  surgery: { title: "Operation or procedure", placeholder: "e.g. Appendectomy", date: "When (optional)", details: "Notes" },
  note: { title: "Subject", placeholder: "e.g. Morning headaches", date: "Date (optional)", details: "Describe it" },
};

type Form = {
  title: string;
  details: string;
  entry_date: string;
  end_date: string;
  status: EntryStatus | "";
  severity: AllergySeverity | "";
  reaction: string;
  dosage: string;
  frequency: string;
  provider_name: string;
  is_private: boolean;
};

function initial(kind: HealthEntryKind, entry?: HealthEntry): Form {
  return {
    title: entry?.title ?? "",
    details: entry?.details ?? "",
    entry_date: entry?.entry_date ?? "",
    end_date: entry?.end_date ?? "",
    status: entry?.status ?? (kind === "medication" || kind === "condition" ? "active" : ""),
    severity: entry?.severity ?? "",
    reaction: entry?.reaction ?? "",
    dosage: entry?.dosage ?? "",
    frequency: entry?.frequency ?? "",
    provider_name: entry?.provider_name ?? "",
    is_private: entry?.is_private ?? false,
  };
}

/** Add or edit one structured entry; the fields follow its kind. */
export function EntryDialog({
  kind,
  entry,
  onClose,
  onSaved,
}: {
  kind: HealthEntryKind;
  entry?: HealthEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(() => initial(kind, entry));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const words = WORDS[kind];
  const today = clinicToday();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const text = (v: string) => v.trim() || null;
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      details: text(form.details),
      entry_date: form.entry_date || null,
      provider_name: text(form.provider_name),
      is_private: form.is_private,
    };
    if (kind === "allergy") Object.assign(body, { severity: form.severity || null, reaction: text(form.reaction) });
    if (kind === "medication") Object.assign(body, { dosage: text(form.dosage), frequency: text(form.frequency) });
    if (kind === "medication" || kind === "condition") {
      const ended = form.status === "stopped" || form.status === "resolved";
      Object.assign(body, { status: form.status, end_date: ended ? form.end_date || null : null });
    }
    try {
      if (entry) await api(`/patients/me/health-entries/${entry.id}`, { method: "PATCH", body });
      else await api("/patients/me/health-entries", { method: "POST", body: { kind, ...body } });
      onSaved();
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  const ended = form.status === "stopped" || form.status === "resolved";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="entry-title" className="text-lg font-bold text-ink">
          {entry ? "Edit" : "Add"} {KIND_LABELS[kind].one.toLowerCase()}
        </h2>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label={words.title} htmlFor="e-title" required>
            <Input
              ref={first}
              id="e-title"
              required
              maxLength={200}
              value={form.title}
              placeholder={words.placeholder}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>

          {kind === "allergy" && (
            <>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">
                  How severe? <span className="text-red-600">*</span>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["mild", "moderate", "severe"] as const).map((s) => (
                    <label
                      key={s}
                      className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${form.severity === s ? (s === "severe" ? "border-red-600 bg-red-50 text-red-800" : "border-brand-700 bg-brand-50 text-brand-800") : "border-slate-300 text-ink"}`}
                    >
                      <input
                        type="radio"
                        name="severity"
                        value={s}
                        required
                        checked={form.severity === s}
                        onChange={() => set("severity", s)}
                        className="sr-only"
                      />
                      {s[0].toUpperCase() + s.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Reaction (optional)" htmlFor="e-reaction">
                <Input
                  id="e-reaction"
                  maxLength={255}
                  value={form.reaction}
                  placeholder="e.g. Hives, swelling, breathing difficulty"
                  onChange={(e) => set("reaction", e.target.value)}
                />
              </Field>
            </>
          )}

          {kind === "medication" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dosage (optional)" htmlFor="e-dosage">
                <Input
                  id="e-dosage"
                  maxLength={100}
                  value={form.dosage}
                  placeholder="e.g. 500 mg"
                  onChange={(e) => set("dosage", e.target.value)}
                />
              </Field>
              <Field label="How often (optional)" htmlFor="e-frequency">
                <Input
                  id="e-frequency"
                  maxLength={100}
                  value={form.frequency}
                  placeholder="e.g. Twice daily"
                  onChange={(e) => set("frequency", e.target.value)}
                />
              </Field>
            </div>
          )}

          {(kind === "medication" || kind === "condition") && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink">Status</legend>
              <div className="flex gap-2">
                {(kind === "medication" ? (["active", "stopped"] as const) : (["active", "resolved"] as const)).map((s) => (
                  <label
                    key={s}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${form.status === s ? "border-brand-700 bg-brand-50 text-brand-800" : "border-slate-300 text-ink"}`}
                  >
                    <input
                      type="radio"
                      name="status"
                      value={s}
                      checked={form.status === s}
                      onChange={() => set("status", s)}
                      className="accent-brand-700"
                    />
                    {s === "active"
                      ? kind === "medication"
                        ? "Taking it now"
                        : "Ongoing"
                      : s === "stopped"
                        ? "Stopped"
                        : "Resolved"}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={words.date} htmlFor="e-date">
              <Input
                id="e-date"
                type="date"
                max={today}
                value={form.entry_date}
                onChange={(e) => set("entry_date", e.target.value)}
              />
            </Field>
            {ended && (
              <Field label={form.status === "stopped" ? "Stopped on (optional)" : "Resolved on (optional)"} htmlFor="e-end">
                <Input
                  id="e-end"
                  type="date"
                  min={form.entry_date || undefined}
                  max={today}
                  value={form.end_date}
                  onChange={(e) => set("end_date", e.target.value)}
                />
              </Field>
            )}
          </div>

          <Field label="Doctor or hospital (optional)" htmlFor="e-provider">
            <Input
              id="e-provider"
              maxLength={255}
              value={form.provider_name}
              placeholder="e.g. Dr Ayesha Khan, Shifa International"
              onChange={(e) => set("provider_name", e.target.value)}
            />
          </Field>
          <Field label={`${words.details} (optional)`} htmlFor="e-details" hint={`${form.details.length}/5000`}>
            <Textarea
              id="e-details"
              rows={kind === "note" ? 5 : 3}
              maxLength={5000}
              value={form.details}
              onChange={(e) => set("details", e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox"
              checked={form.is_private}
              onChange={(e) => set("is_private", e.target.checked)}
              className="mt-1 accent-brand-700"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Keep private</span>
              <span className="block text-sm text-slate-600">Never shared with a doctor automatically.</span>
            </span>
          </label>

          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !form.title.trim() || (kind === "allergy" && !form.severity)}>
              {saving ? "Saving…" : entry ? "Save changes" : "Add"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
