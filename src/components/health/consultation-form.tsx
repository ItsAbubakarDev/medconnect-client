"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { api, messageOf } from "@/lib/api";
import type { Consultation, OwnConsultation } from "@/lib/types";

import { Alert, Button, Card, Field, Input, Textarea } from "../ui";

type Med = { key: number; id: number | null; name: string; dosage: string; frequency: string; instructions: string };

let nextKey = 1;
const blankMed = (): Med => ({ key: nextKey++, id: null, name: "", dosage: "", frequency: "", instructions: "" });
const medsOf = (c: Consultation | null): Med[] =>
  (c?.medications ?? []).map((m) => ({
    key: nextKey++,
    id: m.id,
    name: m.title,
    dosage: m.dosage ?? "",
    frequency: m.frequency ?? "",
    instructions: m.details ?? "",
  }));

/** The doctor's consultation record for one appointment: written once the visit has
 * started, editable until the follow-up window ends. Lands in the patient's history. */
export function ConsultationForm({
  appointmentId,
  existing,
  onSaved,
}: {
  appointmentId: number;
  existing: Consultation | null;
  onSaved: (c: Consultation) => void;
}) {
  const [diagnosis, setDiagnosis] = useState(existing?.diagnosis ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [followUp, setFollowUp] = useState(existing?.follow_up ?? "");
  const [meds, setMeds] = useState<Med[]>(() => medsOf(existing));
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const setMed = (key: number, patch: Partial<Med>) =>
    setMeds((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const text = (v: string) => v.trim() || null;
    const body = {
      diagnosis: diagnosis.trim(),
      notes: text(notes),
      follow_up: text(followUp),
      medications: meds
        .filter((m) => m.name.trim())
        .map((m) => ({
          id: m.id,
          name: m.name.trim(),
          dosage: text(m.dosage),
          frequency: text(m.frequency),
          instructions: text(m.instructions),
        })),
    };
    try {
      let result = await api<OwnConsultation>(`/doctors/me/appointments/${appointmentId}/consultation`, {
        method: existing ? "PUT" : "POST",
        body,
      });
      if (file) {
        const form = new FormData();
        form.append("file", file, file.name);
        result = await api<OwnConsultation>(`/doctors/me/appointments/${appointmentId}/consultation/prescription`, {
          method: "POST",
          body: form,
        });
        setFile(null);
      }
      setMessage({
        tone: "success",
        text: existing ? "Saved. The patient's history is updated." : "Saved to the patient's history. They've been notified.",
      });
      // The saved medicines now have ids: later saves edit them rather than re-adding them.
      setMeds(medsOf(result.consultation));
      if (result.consultation) onSaved(result.consultation);
    } catch (err) {
      setMessage({ tone: "error", text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  async function removeFile(fileId: number) {
    try {
      const result = await api<OwnConsultation>(
        `/doctors/me/appointments/${appointmentId}/consultation/prescription/files/${fileId}`,
        { method: "DELETE" },
      );
      if (result.consultation) onSaved(result.consultation);
    } catch (err) {
      setMessage({ tone: "error", text: messageOf(err) });
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">{existing ? "Consultation record" : "Write the consultation record"}</h2>
      <p className="mt-1 text-sm text-slate-600">
        It goes into the patient&apos;s medical history with your name and the visit date. Prescribed medicines appear in their
        current medications.
      </p>
      <form onSubmit={save} className="mt-5 space-y-4">
        <Field label="Diagnosis" htmlFor="c-diagnosis" required>
          <Textarea
            id="c-diagnosis"
            rows={2}
            required
            maxLength={5000}
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
          />
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">Prescribed medicines</legend>
          {meds.length === 0 && <p className="text-sm text-slate-500">None.</p>}
          {meds.map((m, i) => (
            <div
              key={m.key}
              className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
            >
              <Field label={`Medicine ${i + 1}`} htmlFor={`m-name-${m.key}`}>
                <Input
                  id={`m-name-${m.key}`}
                  maxLength={200}
                  value={m.name}
                  placeholder="e.g. Amoxicillin"
                  onChange={(e) => setMed(m.key, { name: e.target.value })}
                />
              </Field>
              <Field label="Dosage" htmlFor={`m-dose-${m.key}`}>
                <Input
                  id={`m-dose-${m.key}`}
                  maxLength={100}
                  value={m.dosage}
                  placeholder="500 mg"
                  onChange={(e) => setMed(m.key, { dosage: e.target.value })}
                />
              </Field>
              <Field label="How often" htmlFor={`m-freq-${m.key}`}>
                <Input
                  id={`m-freq-${m.key}`}
                  maxLength={100}
                  value={m.frequency}
                  placeholder="3 times a day"
                  onChange={(e) => setMed(m.key, { frequency: e.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                onClick={() => setMeds((list) => list.filter((x) => x.key !== m.key))}
                aria-label={`Remove medicine ${i + 1}`}
              >
                Remove
              </Button>
              <div className="sm:col-span-4">
                <Field label="Instructions (optional)" htmlFor={`m-ins-${m.key}`}>
                  <Input
                    id={`m-ins-${m.key}`}
                    maxLength={1000}
                    value={m.instructions}
                    placeholder="e.g. After meals, for 7 days"
                    onChange={(e) => setMed(m.key, { instructions: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          ))}
          {meds.length < 30 && (
            <Button variant="secondary" size="sm" onClick={() => setMeds((list) => [...list, blankMed()])}>
              + Add medicine
            </Button>
          )}
        </fieldset>

        <Field label="Notes (optional)" htmlFor="c-notes">
          <Textarea id="c-notes" rows={3} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Follow-up advice (optional)" htmlFor="c-follow">
          <Textarea
            id="c-follow"
            rows={2}
            maxLength={5000}
            value={followUp}
            placeholder="e.g. Review in 2 weeks with a repeat blood test"
            onChange={(e) => setFollowUp(e.target.value)}
          />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Prescription file (optional)</p>
          {existing?.prescription && (
            <ul className="space-y-1">
              {existing.prescription.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                  <span className="truncate">{f.original_filename}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeFile(f.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50">
            {file ? file.name : existing?.prescription ? "Attach another file" : "Attach a prescription (PDF or photo)"}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Button type="submit" disabled={saving || !diagnosis.trim()}>
          {saving ? "Saving…" : existing ? "Save changes" : "Save to patient's history"}
        </Button>
      </form>
    </Card>
  );
}
