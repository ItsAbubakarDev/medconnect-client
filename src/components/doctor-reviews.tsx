"use client";

import { useEffect, useState } from "react";

import { api, messageOf } from "@/lib/api";
import type { PublicReview, ReviewPage } from "@/lib/types";

import { RatingSummaryView, ReviewItem } from "./rating";
import { Alert, Button, Card } from "./ui";

const PAGE_SIZE = 5;

/** The public reviews section of a doctor's profile: summary, breakdown, newest first. */
export function DoctorReviews({ doctorId, doctorName }: { doctorId: number; doctorName: string }) {
  const [first, setFirst] = useState<{ id: number; data?: ReviewPage; error?: string } | null>(null);
  const [more, setMore] = useState<{ id: number; items: PublicReview[]; page: number }>({ id: doctorId, items: [], page: 1 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ReviewPage>(`/doctors/${doctorId}/reviews?page=1&page_size=${PAGE_SIZE}`, { auth: false })
      .then((data) => !cancelled && setFirst({ id: doctorId, data }))
      .catch((e) => !cancelled && setFirst({ id: doctorId, error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [doctorId]);

  const current = first?.id === doctorId ? first : null;
  const extra = more.id === doctorId ? more : { id: doctorId, items: [], page: 1 };
  const items = [...(current?.data?.items ?? []), ...extra.items];
  const total = current?.data?.total ?? 0;

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = extra.page + 1;
      const page = await api<ReviewPage>(`/doctors/${doctorId}/reviews?page=${next}&page_size=${PAGE_SIZE}`, { auth: false });
      setMore({ id: doctorId, items: [...extra.items, ...page.items], page: next });
    } catch (e) {
      setMoreError(messageOf(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Patient reviews</h2>
      <p className="mt-1 text-sm text-slate-600">Only patients who completed a visit with {doctorName} can leave a review.</p>
      <div className="mt-5">
        {!current && <p className="text-slate-500">Loading reviews…</p>}
        {current?.error && <Alert tone="error">{current.error}</Alert>}
        {current?.data && <RatingSummaryView summary={current.data.summary} />}
      </div>
      {items.length > 0 && (
        <div className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
          {items.map((r) => (
            <ReviewItem key={r.id} review={r} doctorName={doctorName} />
          ))}
        </div>
      )}
      {moreError && <Alert tone="error">{moreError}</Alert>}
      {items.length < total && (
        <Button variant="secondary" onClick={loadMore} disabled={loadingMore} className="mt-2">
          {loadingMore ? "Loading…" : `Show more reviews (${total - items.length} more)`}
        </Button>
      )}
    </Card>
  );
}
