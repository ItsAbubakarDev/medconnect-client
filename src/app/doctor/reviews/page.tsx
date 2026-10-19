"use client";

import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { RatingSummaryView, ReviewItem } from "@/components/rating";
import { RequireRole } from "@/components/require-role";
import { Alert, Button, Card, Container, EmptyState, Field, PageHeader, PageLoading, Textarea } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { DoctorReview, DoctorReviewPage } from "@/lib/types";

const PAGE_SIZE = 10;
const REPLY_MAX = 1000;

/** Write or edit the one public reply to a review. */
function ReplyForm({
  review,
  onDone,
  onCancel,
}: {
  review: DoctorReview;
  onDone: (r: DoctorReview) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(review.reply ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onDone(await api<DoctorReview>(`/doctors/me/reviews/${review.id}/reply`, { method: "PUT", body: { reply: text.trim() } }));
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full space-y-3">
      <Field label="Your public reply" htmlFor={`reply-${review.id}`} hint={`${text.length}/${REPLY_MAX}`}>
        <Textarea
          id={`reply-${review.id}`}
          rows={3}
          required
          maxLength={REPLY_MAX}
          value={text}
          autoFocus
          placeholder="Thank the patient, or respond to their feedback. Don't include medical details."
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving || !text.trim()}>
          {saving ? "Posting…" : review.reply ? "Save reply" : "Post reply"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReviewsPage() {
  const { displayName } = useAuth();
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ key: string; data?: DoctorReviewPage; error?: string } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<DoctorReview | null>(null);
  const key = `${page}|${version}`;

  useEffect(() => {
    let cancelled = false;
    api<DoctorReviewPage>(`/doctors/me/reviews?page=${page}&page_size=${PAGE_SIZE}`)
      .then((data) => !cancelled && setState({ key, data }))
      .catch((e) => !cancelled && setState((prev) => (prev?.data ? prev : { key, error: messageOf(e) })));
    return () => {
      cancelled = true;
    };
  }, [page, version, key]);

  const data = state?.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const reload = () => setVersion((v) => v + 1);

  return (
    <Container className="max-w-4xl py-10">
      <PageHeader
        title="Reviews"
        subtitle="What patients said after their visits. You can post one public reply to each review; reviews themselves can't be edited or removed."
      />
      <div className="mt-6 space-y-6">
        {!state && <p className="text-slate-500">Loading reviews…</p>}
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {data && (
          <>
            <Card>
              <RatingSummaryView summary={data.summary} />
              {data.unreplied > 0 && (
                <p className="mt-4 text-sm font-medium text-amber-800">
                  {data.unreplied} review{data.unreplied === 1 ? "" : "s"} waiting for a reply.
                </p>
              )}
            </Card>
            {data.items.length === 0 ? (
              <EmptyState title="No reviews yet">
                Patients are invited to review their visit when you mark the appointment completed.
              </EmptyState>
            ) : (
              <Card>
                <div className="divide-y divide-slate-200">
                  {data.items.map((r) => (
                    <ReviewItem
                      key={r.id}
                      review={editing === r.id ? { ...r, reply: null } : r}
                      doctorName={displayName ?? "you"}
                      actions={
                        editing === r.id ? (
                          <ReplyForm
                            review={r}
                            onCancel={() => setEditing(null)}
                            onDone={() => {
                              setEditing(null);
                              reload();
                            }}
                          />
                        ) : r.reply ? (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => setEditing(r.id)}>
                              Edit reply
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => setDeleting(r)}>
                              Delete reply
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" onClick={() => setEditing(r.id)}>
                            Reply
                          </Button>
                        )
                      }
                    />
                  ))}
                </div>
              </Card>
            )}
            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-slate-600">
                  Page {page} of {totalPages}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete your reply?"
          confirmLabel="Delete reply"
          busyLabel="Deleting…"
          tone="danger"
          onConfirm={async () => {
            await api(`/doctors/me/reviews/${deleting.id}/reply`, { method: "DELETE" });
            setDeleting(null);
            reload();
          }}
          onClose={() => setDeleting(null)}
        >
          <p>Your reply is removed from your public profile. The patient&apos;s review stays.</p>
        </ConfirmDialog>
      )}
    </Container>
  );
}

export default function Page() {
  return (
    <RequireRole role="doctor">
      <Suspense fallback={<PageLoading />}>
        <ReviewsPage />
      </Suspense>
    </RequireRole>
  );
}
