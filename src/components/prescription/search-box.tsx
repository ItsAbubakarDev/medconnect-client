"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Type-ahead for the prescription lists: suggestions as you type (debounced), ↑/↓ to move,
 * Enter to pick the highlighted one — or, with nothing highlighted, to add exactly what was
 * typed (`onFreeText`), so anything not in the lists can still be prescribed.
 */
export function SearchBox<T>({
  id,
  label,
  placeholder,
  search,
  renderItem,
  onPick,
  onFreeText,
  freeTextLabel = "Add",
  minChars = 2,
}: {
  id?: string;
  label: string;
  placeholder: string;
  search: (q: string) => Promise<T[]>;
  renderItem: (item: T) => ReactNode;
  onPick: (item: T) => void;
  onFreeText?: (text: string) => void;
  freeTextLabel?: string;
  minChars?: number;
}) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  useEffect(() => {
    const q = query.trim();
    if (q.length < minChars) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchRef
        .current(q)
        .then((found) => {
          if (cancelled) return;
          setItems(found);
          setActive(-1);
        })
        .catch(() => !cancelled && setItems([]))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, minChars]);

  function reset() {
    setQuery("");
    setItems([]);
    setActive(-1);
  }

  function pick(item: T) {
    onPick(item);
    reset();
  }

  function addTyped() {
    const text = query.trim();
    if (!text || !onFreeText) return;
    onFreeText(text);
    reset();
  }

  const showList = open && query.trim().length >= minChars;
  const shown = showList ? items : [];
  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (e.target.value.trim().length >= minChars) setLoading(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0 && items[active]) pick(items[active]);
              else addTyped();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        />
        {onFreeText && query.trim() && (
          <button
            type="button"
            onClick={addTyped}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            {freeTextLabel}
          </button>
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {shown.map((item, i) => (
            <li
              key={i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-brand-50" : ""}`}
            >
              {renderItem(item)}
            </li>
          ))}
          {!loading && shown.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {onFreeText ? (
                <>
                  Not in the list — press <kbd className="rounded border border-slate-300 px-1 text-xs">Enter</kbd> to add “
                  {query.trim()}”
                </>
              ) : (
                "No matches"
              )}
            </li>
          )}
          {loading && shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>}
        </ul>
      )}
    </div>
  );
}
