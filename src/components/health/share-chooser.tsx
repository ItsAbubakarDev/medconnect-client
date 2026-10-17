"use client";

import { useState } from "react";

import { refKey, shareableItems } from "@/lib/health";
import type { ShareableItem } from "@/lib/health";
import type { MedicalHistory } from "@/lib/types";

/**
 * What one doctor will see of the patient's history: every item not marked private, all
 * ticked; unticking leaves an item out for this appointment only. `excluded` holds the
 * unticked items' keys ("entry:12").
 */
export function ShareChooser({
  history,
  doctorName,
  excluded,
  onChange,
  startOpen = false,
  disabled = false,
}: {
  history: MedicalHistory;
  doctorName: string;
  excluded: Set<string>;
  onChange: (next: Set<string>) => void;
  startOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const { items, privateCount } = shareableItems(history);
  const shared = items.filter((i) => !excluded.has(refKey(i.ref))).length;
  const sections = new Map<string, ShareableItem[]>();
  for (const item of items) sections.set(item.section, [...(sections.get(item.section) ?? []), item]);

  const toggle = (keys: string[], include: boolean) => {
    const next = new Set(excluded);
    for (const k of keys) {
      if (include) next.delete(k);
      else next.add(k);
    }
    onChange(next);
  };

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {privateCount > 0
          ? `Everything in your health record is private, so nothing will be shared with ${doctorName}.`
          : `Your health record is empty. Anything you add before the visit will be shared with ${doctorName} automatically.`}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="text-sm text-ink">
          <span className="font-semibold">Medical history:</span> {shared} of {items.length} item{items.length > 1 ? "s" : ""}{" "}
          shared with {doctorName}
          {privateCount > 0 && <span className="text-slate-600"> · {privateCount} private, never shared</span>}
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded-md px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          {open ? "Hide" : "Choose what to share"}
        </button>
      </div>
      {open && (
        <div className="max-h-72 space-y-3 overflow-y-auto border-t border-slate-200 p-3">
          {[...sections.entries()].map(([section, list]) => {
            const keys = list.map((i) => refKey(i.ref));
            const allOn = keys.every((k) => !excluded.has(k));
            return (
              <fieldset key={section}>
                <legend className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {section}
                  {list.length > 1 && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(keys, !allOn)}
                      className="font-semibold normal-case tracking-normal text-brand-700 hover:underline"
                    >
                      {allOn ? "Untick all" : "Tick all"}
                    </button>
                  )}
                </legend>
                <ul className="mt-1 space-y-1">
                  {list.map((item) => {
                    const key = refKey(item.ref);
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={!excluded.has(key)}
                            disabled={disabled}
                            onChange={(e) => toggle([key], e.target.checked)}
                            className="mt-1 accent-brand-700"
                          />
                          <span className="min-w-0 text-sm">
                            <span className="block break-words text-ink">{item.title}</span>
                            {item.detail && <span className="block break-words text-slate-500">{item.detail}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
          <p className="text-xs text-slate-500">
            Unticking only affects this appointment. Anything you add before the visit is shared too, unless you keep it private.
          </p>
        </div>
      )}
    </div>
  );
}
