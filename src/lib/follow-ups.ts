import { addDays, formatDate, formatDayShort } from "./format";
import type { ConsultationType, FollowUp, FollowUpFlexibility, FollowUpStatus } from "./types";

export const QUICK_PICKS = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
] as const;

export const FLEXIBILITY: { value: FollowUpFlexibility; label: string; before: number; after: number }[] = [
  { value: "exact", label: "Exact date", before: 0, after: 0 },
  { value: "plus_minus_2_days", label: "± 2 days", before: 2, after: 2 },
  { value: "plus_minus_1_week", label: "± 1 week", before: 7, after: 7 },
  { value: "within_2_weeks_after", label: "Within 2 weeks after", before: 0, after: 14 },
];

export const TYPE_LABELS: Record<ConsultationType, string> = { clinic: "In-clinic", online: "Online (video)" };

export const STATUS_LABELS: Record<FollowUpStatus, string> = {
  recommended: "Recommended",
  booked: "Booked",
  dismissed: "Not now",
  expired: "Expired",
  completed: "Completed",
};

export const STATUS_TONES: Record<FollowUpStatus, string> = {
  recommended: "bg-amber-50 text-amber-800",
  booked: "bg-brand-50 text-brand-800",
  dismissed: "bg-slate-100 text-slate-700",
  expired: "bg-slate-100 text-slate-500",
  completed: "bg-emerald-50 text-emerald-800",
};

/** The window a target date and flexibility give (same rule as the server). */
export function windowOf(target: string, flexibility: FollowUpFlexibility): { start: string; end: string } {
  const f = FLEXIBILITY.find((x) => x.value === flexibility) ?? FLEXIBILITY[0];
  return { start: addDays(target, -f.before), end: addDays(target, f.after) };
}

const short = (iso: string) => {
  const { weekday, day } = formatDayShort(iso);
  return `${weekday} ${day}`;
};

/** "on Tue 3 Nov" or "Sat 31 Oct – Wed 4 Nov". */
export function windowLabel(w: { window_start: string; window_end: string }): string {
  return w.window_start === w.window_end ? `on ${short(w.window_start)}` : `${short(w.window_start)} – ${short(w.window_end)}`;
}

export function aroundLabel(f: FollowUp): string {
  return `around ${formatDate(f.target_date)}`;
}
