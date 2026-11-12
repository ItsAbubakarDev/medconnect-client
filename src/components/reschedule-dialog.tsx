"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, Button, Field, Textarea } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { addDays, clinicToday, formatDate, formatDayShort, formatTime } from "@/lib/format";
import type { Appointment, Slot } from "@/lib/types";

const DAYS_SHOWN = 14;

/**
 * Pick another of the same doctor's free times for an appointment. A request the doctor
 * hasn't accepted yet moves at once; a confirmed appointment becomes a request the doctor
 * accepts or declines (it stays at its current time until then). Confirmed before sending.
 */
export function RescheduleDialog({
  appointment,
  doctorName,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  doctorName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmed = appointment.status === "confirmed";

  useEffect(() => {
    let cancelled = false;
    const from = clinicToday();
    api<Slot[]>(`/doctors/${appointment.doctor_id}/available-slots?from=${from}&to=${addDays(from, DAYS_SHOWN - 1)}`, {
      auth: false,
    })
      .then((data) => !cancelled && setSlots(data))
      .catch((e) => !cancelled && setLoadError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [appointment.doctor_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !confirming && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  const byDate = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots ?? []) grouped.set(slot.date, [...(grouped.get(slot.date) ?? []), slot]);
    return grouped;
  }, [slots]);
  const dates = [...byDate.keys()];
  const activeDate = chosenDate && byDate.has(chosenDate) ? chosenDate : (dates[0] ?? null);
  const current = `${formatDate(appointment.slot.date)} at ${formatTime(appointment.slot.start_time)}`;

  async function send() {
    if (!chosen) return;
    await api(`/appointments/${appointment.id}/reschedule`, {
      method: "POST",
      body: { slot_id: chosen.id, note: note.trim() || null },
    });
    setConfirming(false);
    onDone();
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reschedule-title"
          className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h2 id="reschedule-title" className="text-lg font-bold text-ink">
            Change the time
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            With <span className="font-semibold text-ink">{doctorName}</span>, now on{" "}
            <span className="font-semibold text-ink">{current}</span>.{" "}
            {confirmed
              ? "The doctor is asked to accept the new time; until they do, your appointment stays where it is."
              : "Your request moves to the new time straight away (it still waits for the doctor to confirm)."}
          </p>

          {loadError && (
            <div className="mt-4">
              <Alert tone="error">{loadError}</Alert>
            </div>
          )}
          {slots === null && !loadError && <p className="mt-4 text-slate-500">Loading free times…</p>}
          {slots !== null && dates.length === 0 && (
            <p className="mt-4 text-slate-600">No other free times in the next {DAYS_SHOWN} days.</p>
          )}

          {activeDate && (
            <div className="mt-4 space-y-4">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {dates.map((date) => {
                  const { weekday, day } = formatDayShort(date);
                  const active = date === activeDate;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => {
                        setChosenDate(date);
                        setChosen(null);
                      }}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-center text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-ink hover:bg-slate-50"}`}
                    >
                      <span className="block font-semibold">{weekday}</span>
                      <span className="block">{day}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Free times">
                {(byDate.get(activeDate) ?? []).map((slot) => {
                  const active = slot.id === chosen?.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChosen(slot)}
                      className={`rounded-lg border px-2 py-2 text-sm font-medium ${active ? "border-brand-700 bg-brand-50 text-brand-800 ring-1 ring-brand-700" : "border-slate-300 text-ink hover:bg-slate-50"}`}
                    >
                      {formatTime(slot.start_time)}
                    </button>
                  );
                })}
              </div>
              <Field label="Note for the doctor" htmlFor="reschedule-note" hint="Optional — why you'd like to move it.">
                <Textarea id="reschedule-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              Keep current time
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!chosen}>
              {confirmed ? "Request this time" : "Move to this time"}
            </Button>
          </div>
        </div>
      </div>

      {confirming && chosen && (
        <ConfirmDialog
          title={confirmed ? "Ask to move this appointment?" : "Move your request to this time?"}
          confirmLabel={confirmed ? "Send request" : "Move request"}
          busyLabel="Sending…"
          cancelLabel="Go back"
          onConfirm={send}
          onClose={() => setConfirming(false)}
        >
          <p>
            <span className="font-semibold text-ink">{doctorName}</span>: from{" "}
            <span className="font-semibold text-ink">{current}</span> to{" "}
            <span className="font-semibold text-ink">
              {formatDate(chosen.date)} at {formatTime(chosen.start_time)}
            </span>
            .
          </p>
          <p>
            {confirmed
              ? "The doctor will be asked to accept the new time. Until they do, your appointment stays at its current time, and you can withdraw the request."
              : "The doctor will see your request at the new time instead."}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
