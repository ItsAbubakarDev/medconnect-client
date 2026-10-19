"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { DoctorCard } from "@/components/doctor-card";
import { SearchBar } from "@/components/search-bar";
import { Alert, Button, ButtonLink, Container, Field, Input, PageLoading, Select } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { CITIES } from "@/lib/cities";
import { clinicToday } from "@/lib/format";
import { SPECIALTIES } from "@/lib/specialties";
import type { DoctorList } from "@/lib/types";

const PAGE_SIZE = 10;

// Every filter lives in the URL (refresh, back and shared links keep the results). `q` is
// the name search and `specialty` the chips; the rest are the filter panel.
const FILTER_KEYS = ["city", "area", "type", "available", "on", "sort"] as const;

const TYPES = [
  { value: "", label: "Any" },
  { value: "clinic", label: "In-clinic" },
  { value: "online", label: "Online" },
] as const;

const AVAILABILITY = [
  { value: "", label: "Any time" },
  { value: "today", label: "Available today" },
  { value: "tomorrow", label: "Available tomorrow" },
  { value: "week", label: "Available in the next 7 days" },
  { value: "date", label: "On a specific date…" },
] as const;

const SORTS = [
  { value: "", label: "Recommended" },
  { value: "earliest", label: "Earliest available" },
  { value: "fee_asc", label: "Fee: low to high" },
  { value: "fee_desc", label: "Fee: high to low" },
  { value: "experience", label: "Most experienced" },
  { value: "rating", label: "Highest rated" },
] as const;

/** Area text: applied on Enter or when the field loses focus (not on every keystroke). */
function AreaInput({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // The URL changed from elsewhere (back button, "Clear all"): follow it.
    setSeen(value);
    setDraft(value);
  }
  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit();
      }}
    >
      <Field label="Area" htmlFor="f-area" hint={disabled ? "Not used for online consultations" : "e.g. DHA, F-10, Gulberg"}>
        <Input
          id="f-area"
          maxLength={120}
          value={draft}
          disabled={disabled}
          placeholder="Any area"
          enterKeyHint="search"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      </Field>
    </form>
  );
}

function DoctorSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const specialty = params.get("specialty") ?? "";
  const city = params.get("city") ?? "";
  const area = params.get("area") ?? "";
  const type = params.get("type") ?? "";
  const available = params.get("available") ?? "";
  const on = params.get("on") ?? "";
  const sort = params.get("sort") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const requestKey = params.toString();
  const online = type === "online";

  const [result, setResult] = useState<{ key: string; data?: DoctorList; error?: string } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (q) query.set("name", q);
    if (specialty) query.set("specialty", specialty);
    if (type) query.set("type", type);
    if (!online && city) query.set("city", city);
    if (!online && area) query.set("area", area);
    if (available) query.set("available", available);
    if (available === "date" && on) query.set("on", on);
    if (sort) query.set("sort", sort);
    api<DoctorList>(`/doctors?${query}`, { auth: false })
      .then((data) => !cancelled && setResult({ key: requestKey, data }))
      .catch((e) => !cancelled && setResult({ key: requestKey, error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [q, specialty, city, area, type, online, available, on, sort, page, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const totalPages = current?.data ? Math.max(1, Math.ceil(current.data.total / PAGE_SIZE)) : 1;
  const specialtyLabel = SPECIALTIES.find((s) => s.query === specialty)?.label ?? specialty;
  const activeFilters = FILTER_KEYS.filter((k) => k !== "on" && k !== "sort" && params.get(k)).length + (specialty ? 1 : 0);

  /** The current URL with some params changed (empty = removed); always back to page 1. */
  const hrefWith = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    return `/doctors${next.size ? `?${next}` : ""}`;
  };
  const setFilter = (changes: Record<string, string>) => router.push(hrefWith(changes), { scroll: false });
  const clearAll = hrefWith({ specialty: "", ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])) });

  const pageHref = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    return `/doctors?${next}`;
  };

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">{specialty ? `${specialtyLabel}s` : "Find a doctor"}</h1>
      <div className="mt-6 max-w-2xl">
        <SearchBar
          key={q}
          initialQuery={q}
          keep={Object.fromEntries([...params.entries()].filter(([k]) => k !== "q" && k !== "page"))}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={hrefWith({ specialty: "" })}
          scroll={false}
          className={`rounded-full border px-3 py-1 text-sm ${!specialty ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
        >
          All specialties
        </Link>
        {SPECIALTIES.map((s) => {
          const active = s.query === specialty;
          return (
            <Link
              key={s.label}
              href={hrefWith({ specialty: s.query })}
              scroll={false}
              className={`rounded-full border px-3 py-1 text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 md:hidden">
        <Button
          variant="secondary"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls="search-filters"
        >
          {filtersOpen ? "Hide filters" : `Filters${activeFilters ? ` (${activeFilters})` : ""}`}
        </Button>
      </div>
      <section
        id="search-filters"
        aria-label="Filters"
        className={`${filtersOpen ? "grid" : "hidden"} mt-4 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 md:mt-6 md:grid lg:grid-cols-[1fr_1fr_auto_1fr_1fr]`}
      >
        <Field label="City" htmlFor="f-city" hint={online ? "Not used for online consultations" : undefined}>
          <Select id="f-city" value={city} disabled={online} onChange={(e) => setFilter({ city: e.target.value })}>
            <option value="">All cities</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <AreaInput value={area} disabled={online} onCommit={(v) => setFilter({ area: v })} />
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">Consultation</legend>
          <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
            {TYPES.map((t) => (
              <label
                key={t.value}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-700 ${type === t.value ? "bg-brand-700 text-white" : "text-ink hover:bg-slate-50"}`}
              >
                <input
                  type="radio"
                  name="consultation-type"
                  value={t.value}
                  checked={type === t.value}
                  onChange={() => setFilter({ type: t.value })}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <Field label="Availability" htmlFor="f-available">
            <Select
              id="f-available"
              value={available}
              onChange={(e) => setFilter({ available: e.target.value, on: e.target.value === "date" ? on || clinicToday() : "" })}
            >
              {AVAILABILITY.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          {available === "date" && (
            <div>
              <label htmlFor="f-on" className="sr-only">
                Date
              </label>
              <Input
                id="f-on"
                type="date"
                min={clinicToday()}
                value={on}
                onChange={(e) => e.target.value && setFilter({ on: e.target.value })}
              />
            </div>
          )}
        </div>
        <Field label="Sort by" htmlFor="f-sort">
          <Select id="f-sort" value={sort} onChange={(e) => setFilter({ sort: e.target.value })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <div className="mt-8">
        {!current && <p className="text-slate-500">Searching…</p>}
        {current?.error && <Alert tone="error">{current.error}</Alert>}
        {current?.data && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600" aria-live="polite">
                {current.data.total} doctor{current.data.total === 1 ? "" : "s"} found
                {online && " for online consultation"}
              </p>
              {activeFilters > 0 && (
                <Link href={clearAll} scroll={false} className="text-sm font-semibold text-brand-700 hover:underline">
                  Clear all filters
                </Link>
              )}
            </div>
            {current.data.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
                <p className="text-lg font-semibold text-ink">No doctors match these filters</p>
                <p className="mt-2 text-slate-600">
                  Try widening them: another day, all areas of the city, or an online consultation.
                </p>
                {activeFilters > 0 && (
                  <ButtonLink href={clearAll} scroll={false} variant="secondary" className="mt-4">
                    Clear all filters
                  </ButtonLink>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                {current.data.items.map((d) => (
                  <DoctorCard key={d.id} doctor={d} />
                ))}
              </div>
            )}
            {totalPages > 1 && (
              <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
                {page > 1 && (
                  <ButtonLink href={pageHref(page - 1)} variant="secondary" size="sm">
                    Previous
                  </ButtonLink>
                )}
                <span className="text-sm text-slate-600">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <ButtonLink href={pageHref(page + 1)} variant="secondary" size="sm">
                    Next
                  </ButtonLink>
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </Container>
  );
}

export default function DoctorsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DoctorSearch />
    </Suspense>
  );
}
