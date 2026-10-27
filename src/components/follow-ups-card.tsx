"use client";

import Link from "next/link";
import { useState } from "react";

import { api } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { STATUS_LABELS, STATUS_TONES, TYPE_LABELS, windowLabel } from "@/lib/follow-ups";
import type { FollowUp } from "@/lib/types";

import { ConfirmDialog } from "./confirm-dialog";
import { Button, ButtonLink, Card } from "./ui";

export function FollowUpStatusBadge({ status }: { status: FollowUp["status"] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>
  );
}

/** One recommendation: who, when, why, how and what it costs. */
export function FollowUpSummary({ f }: { f: FollowUp }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm text-slate-700">
        <span className="font-semibold text-ink">Around {formatDate(f.target_date)}</span> ({windowLabel(f)})
      </p>
      <p className="break-words text-sm text-slate-700">{f.reason}</p>
      <p className="text-sm text-slate-600">
        {TYPE_LABELS[f.consultation_type]} · {f.fee_label}
      </p>
      {f.status === "booked" && f.booked && (
        <p className="text-sm font-medium text-brand-800">
          Booked for {formatDate(f.booked.date)} at {formatTime(f.booked.start_time)}
        </p>
      )}
      {f.can_book && f.bookable_from && (
        <p className="text-sm text-slate-600">Times for this window open on {formatDate(f.bookable_from)}.</p>
      )}
    </div>
  );
}

/** "Book follow-up" (and "Not now" for an open one), for the patient. */
export function FollowUpActions({ f, onDismiss }: { f: FollowUp; onDismiss?: () => void }) {
  if (!f.can_book) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
      <ButtonLink href={`/patient/follow-ups/${f.appointment_id}`} variant="accent">
        Book follow-up
      </ButtonLink>
      {f.status === "recommended" && onDismiss && (
        <Button variant="secondary" onClick={onDismiss}>
          Not now
        </Button>
      )}
    </div>
  );
}

/** The patient dashboard's follow-ups: open recommendations first, past ones folded away. */
export function FollowUpsCard({ followUps, onChanged }: { followUps: FollowUp[]; onChanged: () => void }) {
  const [dismissing, setDismissing] = useState<FollowUp | null>(null);
  const [showPast, setShowPast] = useState(false);
  const open = followUps.filter((f) => f.status === "recommended");
  const past = followUps.filter((f) => f.status !== "recommended");
  if (followUps.length === 0) return null;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Follow-ups</h2>
      {open.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">No follow-ups waiting to be booked.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200">
          {open.map((f) => (
            <li
              key={f.id}
              id={`follow-up-${f.appointment_id}`}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {f.doctor_name ?? "Your doctor"} recommends a follow-up
                  {f.doctor_specialty && <span className="font-normal text-slate-600"> · {f.doctor_specialty}</span>}
                </p>
                <FollowUpSummary f={f} />
              </div>
              <FollowUpActions f={f} onDismiss={() => setDismissing(f)} />
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
            className="text-sm font-semibold text-brand-700 hover:underline"
          >
            {showPast ? "Hide past follow-ups" : `Past follow-ups (${past.length})`}
          </button>
          {showPast && (
            <ul className="mt-2 divide-y divide-slate-200">
              {past.map((f) => (
                <li key={f.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                      {f.doctor_name ?? "Your doctor"} <FollowUpStatusBadge status={f.status} />
                    </p>
                    <FollowUpSummary f={f} />
                    {f.status === "expired" && (
                      <Link href={`/doctors/${f.doctor_id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                        Book {f.doctor_name ?? "the doctor"} as usual
                      </Link>
                    )}
                  </div>
                  <FollowUpActions f={f} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dismissing && (
        <ConfirmDialog
          title="Not now?"
          confirmLabel="Not now"
          busyLabel="Saving…"
          cancelLabel="Keep it here"
          onConfirm={async () => {
            await api(`/follow-ups/${dismissing.id}/dismiss`, { method: "POST" });
            setDismissing(null);
            onChanged();
          }}
          onClose={() => setDismissing(null)}
        >
          <p>
            The follow-up {dismissing.doctor_name ?? "your doctor"} recommended moves to your past follow-ups. You can still book
            it from there until {formatDate(dismissing.window_end)}, and you won&apos;t get a reminder.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
