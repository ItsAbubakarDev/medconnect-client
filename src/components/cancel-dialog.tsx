"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { api, messageOf } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import type { CancellationReason, DoctorAppointment } from "@/lib/types";

import { ARM_DELAY_MS } from "./confirm-dialog";
import { Alert, Button, Field, Textarea } from "./ui";

const reasons: { value: CancellationReason; title: string; text: string }[] = [
  {
    value: "busy",
    title: "I'm unavailable at this time",
    text: "The time is withdrawn from your schedule, so no one else can book it. You can reopen it later.",
  },
  {
    value: "other",
    title: "Other reason",
    text: "The time reopens for other patients to book. Add a note so the patient knows why.",
  },
];

/** Doctor-side cancellation: the backend requires a reason, and a note when it's "other". */
export function CancelDialog({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: DoctorAppointment;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState<CancellationReason>("busy");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstOption = useRef<HTMLInputElement>(null);
  const openedAt = useRef(0);
  // The parent re-renders on a clock tick with a fresh onClose each time; keeping it in a
  // ref lets the focus/Escape setup below run once, instead of stealing focus mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    openedAt.current = Date.now();
    firstOption.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const noteRequired = reason === "other";

  async function submit(e: FormEvent) {
    e.preventDefault();
    // A double-tap on the "Cancel" button that opened this mustn't also submit it.
    if (Date.now() - openedAt.current < ARM_DELAY_MS) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/appointments/${appointment.id}/cancel`, {
        method: "PATCH",
        body: { reason, note: note.trim() || null },
      });
      onCancelled();
    } catch (err) {
      setError(messageOf(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={() => Date.now() - openedAt.current >= ARM_DELAY_MS && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
        className="w-full max-w-lg rounded-2xl bg-white p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="cancel-title" className="text-lg font-bold text-ink">
          Cancel appointment
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {appointment.patient.full_name ?? `Patient #${appointment.patient_id}`} · {formatDate(appointment.slot.date)} at{" "}
          {formatTime(appointment.slot.start_time)}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">Why are you cancelling?</legend>
            {reasons.map((r, i) => (
              <label
                key={r.value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${reason === r.value ? "border-brand-700 bg-brand-50" : "border-slate-300"}`}
              >
                <input
                  ref={i === 0 ? firstOption : undefined}
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="mt-1 accent-brand-700"
                />
                <span>
                  <span className="block font-semibold text-ink">{r.title}</span>
                  <span className="block text-sm text-slate-600">{r.text}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field
            label={noteRequired ? "Note for the patient" : "Note for the patient (optional)"}
            htmlFor="cancel-note"
            required={noteRequired}
            hint={`${note.length}/500 · Shown to the patient on their appointments page.`}
          >
            <Textarea
              id="cancel-note"
              rows={3}
              maxLength={500}
              required={noteRequired}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteRequired ? "e.g. I have to reschedule — please book another time this week." : ""}
            />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Keep appointment
            </Button>
            <Button type="submit" variant="danger" disabled={submitting || (noteRequired && !note.trim())}>
              {submitting ? "Cancelling…" : "Cancel appointment"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
