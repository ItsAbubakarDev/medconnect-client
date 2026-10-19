import type { ReactNode } from "react";

import type { PublicReview, RatingSummary } from "@/lib/types";
import { formatDate } from "@/lib/format";

const STAR_PATH = "M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8L10 1.6z";

function Star({ fill, size }: { fill: number; size: number }) {
  // fill: 0..1, the share of this star that's coloured (for averages like 4.6).
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 20 20" width={size} height={size} className="absolute inset-0 text-slate-300">
        <path d={STAR_PATH} fill="currentColor" />
      </svg>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${Math.round(fill * 100)}%` }}>
        <svg viewBox="0 0 20 20" width={size} height={size} className="text-amber-500">
          <path d={STAR_PATH} fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}

/** Five stars filled to `value` (e.g. 4.6), with a text equivalent for screen readers. */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} fill={Math.max(0, Math.min(1, value - (n - 1)))} size={size} />
      ))}
    </span>
  );
}

/** "★ 4.6 (23 reviews)" on cards, or a "New" pill when there are no reviews yet. */
export function RatingBadge({ average, count }: { average: number | null; count: number }) {
  if (average === null || count === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
        New
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Stars value={average} size={14} />
      <span className="font-semibold text-ink">{average.toFixed(1)}</span>
      <span className="text-slate-600">
        ({count} review{count === 1 ? "" : "s"})
      </span>
    </span>
  );
}

/** The average, the count and the 5-to-1 breakdown bars. */
export function RatingSummaryView({ summary }: { summary: RatingSummary }) {
  if (summary.count === 0 || summary.average === null) {
    return (
      <div className="flex items-center gap-3">
        <RatingBadge average={null} count={0} />
        <p className="text-sm text-slate-600">No reviews yet. Patients can review after a completed visit.</p>
      </div>
    );
  }
  const max = Math.max(...summary.breakdown.map((b) => b.count), 1);
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="shrink-0 text-center sm:w-36">
        <p className="text-4xl font-bold text-ink">{summary.average.toFixed(1)}</p>
        <Stars value={summary.average} size={18} />
        <p className="mt-1 text-sm text-slate-600">
          {summary.count} review{summary.count === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5" aria-label="Rating breakdown">
        {summary.breakdown.map((b) => (
          <li key={b.stars} className="flex items-center gap-2 text-sm">
            <span className="w-12 shrink-0 text-slate-700">{b.stars} star</span>
            <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-amber-500" style={{ width: `${(b.count / max) * 100}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-slate-600">{b.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 1–5 star picker: a radio group, so it works with the keyboard (arrow keys) too. */
export function StarPicker({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const labels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-ink">
        Your rating <span className="text-red-600">*</span>
      </legend>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="cursor-pointer rounded-md p-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-700"
          >
            <input
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
              aria-label={`${n} star${n > 1 ? "s" : ""}: ${labels[n]}`}
            />
            <Star fill={value >= n ? 1 : 0} size={32} />
          </label>
        ))}
        <span className="ml-2 text-sm text-slate-600" aria-live="polite">
          {value ? labels[value] : "Choose 1 to 5 stars"}
        </span>
      </div>
    </fieldset>
  );
}

export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
      <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
        <path d="M7.6 13.6L4 10l-1.4 1.4 5 5 10-10L16.2 5z" fill="currentColor" />
      </svg>
      Verified visit
    </span>
  );
}

/** One review: who, stars, visit date, comment and the doctor's reply. */
export function ReviewItem({ review, doctorName, actions }: { review: PublicReview; doctorName?: string; actions?: ReactNode }) {
  return (
    <article className="py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-ink">{review.reviewer_name}</span>
        <VerifiedBadge />
        <Stars value={review.rating} size={14} />
        <span className="text-sm text-slate-500">Visit on {formatDate(review.visit_date)}</span>
      </div>
      {review.comment && <p className="mt-2 whitespace-pre-line break-words text-slate-700">{review.comment}</p>}
      {review.reply && (
        <div className="mt-3 rounded-lg border-l-4 border-brand-600 bg-brand-50 px-4 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">Reply from {doctorName ?? "the doctor"}</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{review.reply}</p>
        </div>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
