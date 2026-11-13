"use client";

import { formatDate } from "@/lib/format";
import type { RxContent, TestCategory } from "@/lib/types";

import { CATEGORY_LABELS, medicineTitle, sigLine } from "./rx-format";

/** A prescription's content, read-only (what was issued). */
export function RxSummary({ content }: { content: RxContent }) {
  const tests = (Object.keys(CATEGORY_LABELS) as TestCategory[])
    .map((c) => [c, content.tests.filter((t) => t.category === c)] as const)
    .filter(([, list]) => list.length > 0);
  return (
    <div className="space-y-4 text-sm">
      {content.complaint && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-800">Complaint</h4>
          <p className="mt-1 text-ink">{content.complaint}</p>
        </div>
      )}
      {content.diagnoses.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-800">Diagnosis</h4>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {content.diagnoses.map((d) => (
              <span key={d.name} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-ink">
                {d.name}
                {d.code && <span className="ml-1 text-xs text-slate-500">{d.code}</span>}
              </span>
            ))}
          </p>
        </div>
      )}
      {content.medicines.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-800">Medicines</h4>
          <ol className="mt-1 space-y-2">
            {content.medicines.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-400">{i + 1}.</span>
                <span>
                  <span className="font-semibold text-ink">{medicineTitle(m)}</span>
                  {m.generic && m.generic.toLowerCase() !== m.name.toLowerCase() && (
                    <span className="text-slate-500"> ({m.generic})</span>
                  )}
                  <span className="block text-slate-700">{sigLine(m)}</span>
                  {m.instructions && <span className="block text-xs text-slate-500">{m.instructions}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {tests.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-800">Tests</h4>
          <ul className="mt-1 space-y-1">
            {tests.map(([c, list]) => (
              <li key={c}>
                <span className="font-semibold text-slate-700">{CATEGORY_LABELS[c]}:</span>{" "}
                {list.map((t) => t.name + (t.notes ? ` (${t.notes})` : "")).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {content.advice && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-800">Advice</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">
            {content.advice
              .split("\n")
              .filter((l) => l.trim())
              .map((line, i) => (
                <li key={i}>{line}</li>
              ))}
          </ul>
        </div>
      )}
      {content.follow_up && (
        <p className="rounded-lg border-l-4 border-brand-700 bg-brand-50 px-3 py-2 text-ink">
          <span className="font-semibold">Follow-up:</span> {formatDate(content.follow_up.target_date)} ·{" "}
          {content.follow_up.consultation_type === "online" ? "online" : "clinic visit"}
        </p>
      )}
    </div>
  );
}
