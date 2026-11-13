"use client";

import type { DurationUnit, RxMedicine, RxPresets } from "@/lib/types";

import { TIMING_LABELS, allergyMatches, doseWords, medicineTitle } from "./rx-format";

const QUICK_DOSES = ["1+0+1", "1+1+1", "1+0+0", "0+0+1", "SOS"];
const QUICK_TIMINGS = ["before_meal", "after_meal", "with_meal", "empty_stomach", "bedtime"];

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: string; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-ink hover:border-brand-700"}`}
    >
      {children}
    </button>
  );
}

const small =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-ink focus-visible:outline-2 focus-visible:outline-brand-700";

/** One medicine line: tap a dose, a timing and a duration (or type your own). */
export function MedicineRow({
  index,
  medicine: m,
  presets,
  allergies,
  duplicate,
  onChange,
  onRemove,
}: {
  index: number;
  medicine: RxMedicine;
  presets: RxPresets;
  allergies: string[];
  duplicate: boolean;
  onChange: (m: RxMedicine) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<RxMedicine>) => onChange({ ...m, ...patch });
  const allergic = allergyMatches(m, allergies);
  const otherDoses = presets.dose_codes.filter((d) => !QUICK_DOSES.includes(d));
  const customDose = !!m.dose && !presets.dose_codes.includes(m.dose);
  const customTiming = !!m.timing && !(m.timing in TIMING_LABELS);
  const id = `med-${index}`;

  return (
    <li className={`rounded-xl border bg-white p-3 ${allergic.length ? "border-red-300" : "border-slate-200"}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{medicineTitle(m)}</p>
          {m.generic && m.generic.toLowerCase() !== m.name.toLowerCase() && (
            <p className="truncate text-xs text-slate-500">{m.generic}</p>
          )}
          {allergic.length > 0 && (
            <p role="alert" className="mt-1 text-xs font-semibold text-red-700">
              ⚠ The patient is allergic to {allergic.join(", ")}. Check before prescribing.
            </p>
          )}
          {duplicate && <p className="mt-1 text-xs font-semibold text-amber-700">This medicine is already on the prescription.</p>}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${m.name}`}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:pl-9 lg:grid-cols-2">
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-slate-600">Dose (morning + afternoon + night)</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_DOSES.map((d) => (
              <Chip key={d} on={m.dose === d} onClick={() => set({ dose: m.dose === d ? null : d })}>
                {d}
              </Chip>
            ))}
            <select
              aria-label="More doses"
              value={otherDoses.includes(m.dose ?? "") ? (m.dose ?? "") : ""}
              onChange={(e) => e.target.value && set({ dose: e.target.value })}
              className={small}
            >
              <option value="">More…</option>
              {otherDoses.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              aria-label="Your own dose"
              placeholder="Own dose"
              value={customDose ? (m.dose ?? "") : ""}
              onChange={(e) => set({ dose: e.target.value || null })}
              maxLength={40}
              className={`${small} w-28`}
            />
            <select
              aria-label="Unit"
              value={m.unit ?? ""}
              onChange={(e) => set({ unit: e.target.value || null })}
              className={small}
            >
              <option value="">unit</option>
              {presets.units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          {m.dose && <p className="mt-1 text-xs text-slate-500">{doseWords(m.dose, m.unit)}</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-slate-600">When</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_TIMINGS.map((t) => (
              <Chip key={t} on={m.timing === t} onClick={() => set({ timing: m.timing === t ? null : t })}>
                {TIMING_LABELS[t]}
              </Chip>
            ))}
            <input
              aria-label="Your own timing"
              placeholder="Own timing"
              value={customTiming ? (m.timing ?? "") : ""}
              onChange={(e) => set({ timing: e.target.value || null })}
              maxLength={60}
              className={`${small} w-28`}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-slate-600">For how long</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.durations.map((days) => (
              <Chip
                key={days}
                on={m.duration_unit === "days" && m.duration_value === days}
                onClick={() => set({ duration_value: days, duration_unit: "days" })}
              >
                {days === 30 ? "1 month" : `${days} days`}
              </Chip>
            ))}
            <Chip on={m.duration_unit === "continue"} onClick={() => set({ duration_value: null, duration_unit: "continue" })}>
              Continue
            </Chip>
            <input
              aria-label="Duration"
              type="number"
              min={1}
              max={365}
              placeholder="#"
              value={m.duration_unit !== "continue" ? (m.duration_value ?? "") : ""}
              onChange={(e) => {
                const value = e.target.value ? Math.max(1, Math.min(365, Number(e.target.value))) : null;
                set({ duration_value: value, duration_unit: value ? (m.duration_unit === "continue" || !m.duration_unit ? "days" : m.duration_unit) : null });
              }}
              className={`${small} w-16`}
            />
            <select
              aria-label="Duration unit"
              value={m.duration_unit && m.duration_unit !== "continue" ? m.duration_unit : "days"}
              onChange={(e) => set({ duration_unit: e.target.value as DurationUnit })}
              className={small}
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
            </select>
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-notes`} className="mb-1 block text-xs font-semibold text-slate-600">
            Instructions
          </label>
          <input
            id={`${id}-notes`}
            placeholder="e.g. Shake well before use"
            value={m.instructions ?? ""}
            onChange={(e) => set({ instructions: e.target.value || null })}
            maxLength={300}
            className={`${small} w-full py-1.5`}
          />
        </div>
      </div>
    </li>
  );
}
