"use client";

import { addDays, formatDate, formatTime } from "@/lib/format";
import { FLEXIBILITY, QUICK_PICKS, STATUS_LABELS, TYPE_LABELS, windowLabel, windowOf } from "@/lib/follow-ups";
import type { ConsultationType, FollowUp, FollowUpFee, FollowUpFlexibility } from "@/lib/types";

import { Field, Input, Select } from "../ui";

export interface FollowUpDraft {
  on: boolean;
  target: string;
  flexibility: FollowUpFlexibility;
  type: ConsultationType;
  reason: string;
  fee: FollowUpFee;
  amount: string;
}

export function draftOf(existing: FollowUp | null, visitDate: string): FollowUpDraft {
  return existing
    ? {
        on: true,
        target: existing.target_date,
        flexibility: existing.flexibility,
        type: existing.consultation_type,
        reason: existing.reason,
        fee: existing.fee_type,
        amount: existing.fee_amount ?? "",
      }
    : {
        on: false,
        target: addDays(visitDate, 7),
        flexibility: "plus_minus_2_days",
        type: "online",
        reason: "",
        fee: "standard",
        amount: "",
      };
}

export function bodyOf(d: FollowUpDraft) {
  return {
    target_date: d.target,
    flexibility: d.flexibility,
    consultation_type: d.type,
    reason: d.reason.trim(),
    fee_type: d.fee,
    fee_amount: d.fee === "reduced" ? d.amount : null,
  };
}

/** What's missing before the recommendation can be saved, or null. */
export function draftProblem(d: FollowUpDraft): string | null {
  if (!d.on) return null;
  if (!d.target) return "Choose when the follow-up should be.";
  if (!d.reason.trim()) return "Add a short reason for the follow-up.";
  if (d.fee === "reduced" && !(Number(d.amount) >= 0 && d.amount.trim() !== "")) return "Enter the reduced fee.";
  return null;
}

/**
 * "Recommend follow-up" inside the consultation record: when (quick picks from the visit
 * date, or a date), how flexible, in-clinic or online, a reason for the patient and a fee
 * label. Once the patient has booked it, it's shown read-only.
 */
export function FollowUpFields({
  draft,
  onChange,
  existing,
  visitDate,
  onUntick,
  disabled,
}: {
  draft: FollowUpDraft;
  onChange: (d: FollowUpDraft) => void;
  existing: FollowUp | null;
  visitDate: string;
  /** Unticking a saved recommendation: the parent confirms and removes it. */
  onUntick: () => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<FollowUpDraft>) => onChange({ ...draft, ...patch });
  const locked = existing !== null && !existing.can_edit;

  if (locked && existing) {
    return (
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Recommended follow-up</legend>
        <p className="text-sm text-slate-700">
          {formatDate(existing.target_date)} ({windowLabel(existing)}) · {TYPE_LABELS[existing.consultation_type]} ·{" "}
          {existing.fee_label}
        </p>
        <p className="mt-1 text-sm text-slate-600">Reason: {existing.reason}</p>
        <p className="mt-2 text-sm font-medium text-brand-800">
          {STATUS_LABELS[existing.status]}
          {existing.booked && ` for ${formatDate(existing.booked.date)} at ${formatTime(existing.booked.start_time)}`}. Changes
          now go through that appointment.
        </p>
      </fieldset>
    );
  }

  const w = draft.target ? windowOf(draft.target, draft.flexibility) : null;
  return (
    <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-ink">Recommend follow-up</legend>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={draft.on}
          onChange={(e) => (e.target.checked ? set({ on: true }) : existing ? onUntick() : set({ on: false }))}
          className="mt-1 h-4 w-4 accent-brand-700"
        />
        <span>
          <span className="block font-medium text-ink">Recommend a follow-up appointment</span>
          <span className="block text-sm text-slate-600">
            The patient is notified and can book it in one tap. No time is held on your calendar.
          </span>
        </span>
      </label>

      {draft.on && (
        <>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">When</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PICKS.map((q) => {
                const date = addDays(visitDate, q.days);
                const active = draft.target === date;
                return (
                  <button
                    key={q.days}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set({ target: date })}
                    className={`rounded-full border px-3 py-1 text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-ink hover:bg-slate-50"}`}
                  >
                    After {q.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Or a specific date" htmlFor="fu-date">
                <Input
                  id="fu-date"
                  type="date"
                  required
                  min={addDays(visitDate, 1)}
                  value={draft.target}
                  onChange={(e) => set({ target: e.target.value })}
                />
              </Field>
              <Field
                label="Flexibility"
                htmlFor="fu-flex"
                hint={w ? `Window: ${windowLabel({ window_start: w.start, window_end: w.end })}` : undefined}
              >
                <Select
                  id="fu-flex"
                  value={draft.flexibility}
                  onChange={(e) => set({ flexibility: e.target.value as FollowUpFlexibility })}
                >
                  {FLEXIBILITY.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Consultation</legend>
            <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
              {(["clinic", "online"] as const).map((t) => (
                <label
                  key={t}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-700 ${draft.type === t ? "bg-brand-700 text-white" : "text-ink hover:bg-slate-50"}`}
                >
                  <input
                    type="radio"
                    name="fu-type"
                    value={t}
                    checked={draft.type === t}
                    onChange={() => set({ type: t })}
                    className="sr-only"
                  />
                  {TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Reason (shown to the patient)" htmlFor="fu-reason" required hint={`${draft.reason.length}/200`}>
            <Input
              id="fu-reason"
              required
              maxLength={200}
              value={draft.reason}
              placeholder="e.g. Review blood test results"
              onChange={(e) => set({ reason: e.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fee" htmlFor="fu-fee" hint="Shown to the patient. No payment is taken in the app.">
              <Select id="fu-fee" value={draft.fee} onChange={(e) => set({ fee: e.target.value as FollowUpFee })}>
                <option value="standard">Standard fee</option>
                <option value="free">Free follow-up</option>
                <option value="reduced">Reduced fee…</option>
              </Select>
            </Field>
            {draft.fee === "reduced" && (
              <Field label="Reduced fee (Rs.)" htmlFor="fu-amount" required>
                <Input
                  id="fu-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={draft.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                />
              </Field>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
