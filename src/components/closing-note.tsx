"use client";

import { clinicNow, formatDate, formatTime } from "@/lib/format";
import type { Appointment } from "@/lib/types";
import { useNow } from "@/lib/use-now";

/** A server timestamp as clinic date and time: "Tue, 20 Oct 2026 at 9:30 AM". */
function clinicWhen(iso: string): string {
  const { date, time } = clinicNow(new Date(iso).getTime());
  return `${formatDate(date)} at ${formatTime(time)}`;
}

function ended(a: Appointment, nowMs: number): boolean {
  const { date, time } = clinicNow(nowMs);
  return a.slot.date < date || (a.slot.date === date && a.slot.end_time <= time);
}

/**
 * How an appointment closes by itself (the server's expiry sweep): a request the doctor
 * hasn't accepted expires when it starts; a confirmed one stays open (joinable, and the
 * doctor can mark it completed) until a day after it ends, then closes as completed if
 * the doctor wrote the consultation record, or as expired.
 */
export function ClosingNote({ appointment: a, viewer }: { appointment: Appointment; viewer: "patient" | "doctor" }) {
  const now = useNow();
  const doctor = viewer === "doctor";
  let text: string | null = null;
  if (a.status === "expired") {
    text =
      a.expired_from === "pending"
        ? doctor
          ? "This request expired because it wasn't accepted before it started."
          : "This request expired because the doctor didn't confirm it before it started. You can book another time."
        : a.expired_from === "confirmed"
          ? doctor
            ? "This appointment expired: it wasn't marked as completed and has no consultation record."
            : "This appointment expired because it wasn't marked as completed. You can book another time."
          : "This appointment has expired.";
  } else if (a.status === "completed" && a.completed_automatically) {
    text = doctor
      ? "Marked completed automatically, because you wrote its consultation record."
      : "Marked completed automatically after the doctor wrote your consultation record.";
  } else if (a.status === "confirmed" && a.closes_at && now !== null && ended(a, now)) {
    const closes = clinicWhen(a.closes_at);
    text = doctor
      ? `The appointment time has passed. Mark it completed — otherwise it closes on ${closes}: as completed if you've written the consultation record, as expired if not.`
      : `The appointment time has passed. The video call stays open until the doctor marks it completed, or until ${closes} at the latest.`;
  } else if (a.status === "pending" && a.closes_at) {
    text = doctor
      ? `Accept it before it starts (${clinicWhen(a.closes_at)}), or the request expires.`
      : "If the doctor hasn't confirmed it by the start time, the request expires.";
  }
  if (!text) return null;
  return (
    <p className={`mt-1 text-sm ${a.status === "confirmed" || a.status === "pending" ? "text-amber-800" : "text-slate-600"}`}>
      {text}
    </p>
  );
}
