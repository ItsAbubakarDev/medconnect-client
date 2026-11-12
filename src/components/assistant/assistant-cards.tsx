"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { formatDate, formatDayShort, formatFee, formatTime } from "@/lib/format";
import type { AssistantCard, AssistantDoctorCard, AssistantProposal } from "@/lib/types";
import { useNow } from "@/lib/use-now";

/** "Sat 14 Nov, 11:00 AM" from an ISO date and "HH:MM". */
function when(date: string, time: string): string {
  const { weekday, day } = formatDayShort(date);
  return `${weekday} ${day}, ${formatTime(time)}`;
}

export function EmergencyCard() {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
      <p className="font-semibold">If this might be an emergency, call 1122 now</p>
      <p className="mt-0.5">or go to the nearest emergency department. Don&apos;t wait for an appointment.</p>
    </div>
  );
}

function DoctorItem({ d, onOpen }: { d: AssistantDoctorCard; onOpen: () => void }) {
  const fee = formatFee(d.consultation_fee);
  const place = [d.area, d.city].filter(Boolean).join(", ");
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <Link href={`/doctors/${d.id}`} onClick={onOpen} className="font-semibold text-ink hover:text-brand-700">
        {d.full_name ?? "Doctor"}
      </Link>
      <p className="text-xs font-medium text-brand-700">{d.specialty}</p>
      <p className="mt-1 text-xs text-slate-600">
        {[fee, place || null, d.offers_online ? "Video consultation" : null].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-0.5 text-xs text-slate-600">
        {d.rating_average !== null ? `★ ${d.rating_average.toFixed(1)} (${d.review_count})` : "New, no reviews yet"}
        {d.next_available && ` · Next free: ${when(d.next_available.date, d.next_available.start_time)}`}
      </p>
    </li>
  );
}

export function DoctorsCard({ items, onOpen }: { items: AssistantDoctorCard[]; onOpen: () => void }) {
  return (
    <ul className="space-y-2" aria-label="Doctors found">
      {items.map((d) => (
        <DoctorItem key={d.id} d={d} onOpen={onOpen} />
      ))}
    </ul>
  );
}

export function TimesCard({
  card,
  disabled,
  onPick,
}: {
  card: Extract<AssistantCard, { type: "times" }>;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-600">Free times with {card.doctor_name ?? "the doctor"}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {card.items.map((t) => (
          <button
            key={t.slot_id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(`I'd like ${when(t.date, t.start_time)} with ${card.doctor_name ?? "this doctor"}.`)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-ink hover:border-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {when(t.date, t.start_time)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HistoryAccessCard({ allowed, onAllow }: { allowed: boolean; onAllow: () => void }) {
  if (allowed) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        The assistant can now read your health record. Ask your question again.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
      <p>To answer that, the assistant needs to read your health record (never the items you marked private).</p>
      <Button size="sm" className="mt-2" onClick={onAllow}>
        Allow access…
      </Button>
    </div>
  );
}

const DETAIL = (p: AssistantProposal, key: string) => {
  const v = p.details[key];
  return v === null || v === undefined ? "" : String(v);
};

function proposalText(p: AssistantProposal) {
  const doctor = DETAIL(p, "doctor_name") || "the doctor";
  if (p.kind === "book") {
    const fee = DETAIL(p, "fee_pkr");
    return {
      title: "Book this appointment?",
      lines: [
        `${doctor}${DETAIL(p, "specialty") ? ` · ${DETAIL(p, "specialty")}` : ""}`,
        `${formatDate(DETAIL(p, "date"))} at ${formatTime(DETAIL(p, "start_time"))}`,
        fee ? `Fee: ${formatFee(fee)}` : "",
        DETAIL(p, "reason_for_visit") ? `Reason: ${DETAIL(p, "reason_for_visit")}` : "",
        "The doctor accepts or declines the request. Your health record (except private items) is shared with them once they accept; you can change that from My appointments.",
      ],
      confirm: "Send booking request",
      tone: "accent" as const,
      done: `Request sent to ${doctor}. You'll be notified when they confirm.`,
    };
  }
  if (p.kind === "cancel") {
    return {
      title: "Cancel this appointment?",
      lines: [
        `${doctor} · ${formatDate(DETAIL(p, "date"))} at ${formatTime(DETAIL(p, "start_time"))}`,
        "The doctor is told. This can't be undone; to see them you'd need to book again.",
      ],
      confirm: "Yes, cancel appointment",
      tone: "danger" as const,
      done: "Appointment cancelled. The doctor has been told.",
    };
  }
  const approval = p.details.needs_doctor_approval === true;
  return {
    title: approval ? "Ask to move this appointment?" : "Move your request?",
    lines: [doctor, `From ${DETAIL(p, "from_when")}`, `To ${DETAIL(p, "to_when")}`, DETAIL(p, "how_it_works")],
    confirm: approval ? "Send request" : "Move request",
    tone: "primary" as const,
    done: approval
      ? `Request sent. Your appointment stays at its current time until ${doctor} accepts.`
      : "Moved. It still waits for the doctor to confirm.",
  };
}

/** A booking, cancellation or move the assistant prepared: nothing happens until the patient presses it. */
export function ProposalCard({
  proposal,
  onChange,
}: {
  proposal: AssistantProposal | undefined;
  onChange: (p: AssistantProposal) => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!proposal) return null;
  const text = proposalText(proposal);
  const expired = proposal.status === "pending" && now !== null && Date.parse(proposal.expires_at) <= now;

  async function act(action: "confirm" | "dismiss") {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      onChange(await api<AssistantProposal>(`/assistant/proposals/${proposal!.id}/${action}`, { method: "POST" }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border-2 border-brand-200 bg-white p-3 text-sm" data-testid="proposal-card">
      <p className="font-semibold text-ink">{text.title}</p>
      <ul className="mt-1 space-y-0.5 text-slate-700">
        {text.lines.filter(Boolean).map((line, i) => (
          <li key={i} className={i === text.lines.filter(Boolean).length - 1 ? "pt-1 text-xs text-slate-500" : ""}>
            {line}
          </li>
        ))}
      </ul>
      {proposal.status === "pending" && !expired && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant={text.tone} disabled={busy !== null} onClick={() => act("confirm")}>
            {busy === "confirm" ? "Working…" : text.confirm}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act("dismiss")}>
            Not now
          </Button>
        </div>
      )}
      {expired && (
        <p className="mt-2 text-xs text-slate-500">This expired. Ask the assistant again to check the time is still free.</p>
      )}
      {proposal.status === "done" && (
        <p className="mt-2 font-medium text-emerald-700" role="status">
          ✓ {text.done}{" "}
          <Link href="/patient" className="font-semibold text-brand-700 hover:underline">
            My appointments
          </Link>
        </p>
      )}
      {proposal.status === "failed" && (
        <p className="mt-2 text-red-700" role="status">
          Couldn&apos;t do this: {proposal.error}
        </p>
      )}
      {proposal.status === "dismissed" && <p className="mt-2 text-xs text-slate-500">Not done.</p>}
      {error && <p className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}
