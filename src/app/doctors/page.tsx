"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { DoctorCard } from "@/components/doctor-card";
import { SearchBar } from "@/components/search-bar";
import { Alert, ButtonLink, Container, EmptyState, PageLoading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { SPECIALTIES } from "@/lib/specialties";
import type { DoctorList } from "@/lib/types";

const PAGE_SIZE = 10;

function DoctorSearch() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const specialty = params.get("specialty") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const requestKey = `${q}|${specialty}|${page}`;

  const [result, setResult] = useState<{ key: string; data?: DoctorList; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (q) query.set("name", q);
    if (specialty) query.set("specialty", specialty);
    api<DoctorList>(`/doctors?${query}`, { auth: false })
      .then((data) => !cancelled && setResult({ key: requestKey, data }))
      .catch((e) => !cancelled && setResult({ key: requestKey, error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [q, specialty, page, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const totalPages = current?.data ? Math.max(1, Math.ceil(current.data.total / PAGE_SIZE)) : 1;
  const specialtyLabel = SPECIALTIES.find((s) => s.query === specialty)?.label ?? specialty;

  const pageHref = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    return `/doctors?${next}`;
  };

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-bold text-ink sm:text-3xl">{specialty ? `${specialtyLabel}s` : "Find a doctor"}</h1>
      <div className="mt-6 max-w-2xl">
        <SearchBar key={q} initialQuery={q} specialty={specialty || undefined} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={q ? `/doctors?q=${encodeURIComponent(q)}` : "/doctors"}
          className={`rounded-full border px-3 py-1 text-sm ${!specialty ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
        >
          All specialties
        </Link>
        {SPECIALTIES.map((s) => {
          const next = new URLSearchParams({ specialty: s.query });
          if (q) next.set("q", q);
          const active = s.query === specialty;
          return (
            <Link
              key={s.label}
              href={`/doctors?${next}`}
              className={`rounded-full border px-3 py-1 text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-8">
        {!current && <p className="text-slate-500">Searching…</p>}
        {current?.error && <Alert tone="error">{current.error}</Alert>}
        {current?.data && (
          <>
            <p className="mb-4 text-sm text-slate-600">
              {current.data.total} doctor{current.data.total === 1 ? "" : "s"} found
            </p>
            {current.data.items.length === 0 ? (
              <EmptyState title="No doctors match your search">Try a different name or specialty.</EmptyState>
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
