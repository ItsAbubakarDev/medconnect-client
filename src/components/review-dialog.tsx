"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { api, messageOf } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { OwnReview, PatientAppointment } from "@/lib/types";
import { useNow } from "@/lib/use-now";

import { ConfirmDialog } from "./confirm-dialog";
import { StarPicker, Stars } from "./rating";
import { Alert, Button, Field, Textarea } from "./ui";

const COMMENT_MAX = 1000;

/** How the review will be signed: first name + last initial, as the server does it. */
export function publicName(fullName: string | null, anonymous: boolean): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (anonymous || parts.length === 0) return "Anonymous patient";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Whether a new review can still be left (and an existing one edited) for this visit. */
export function reviewWindowOpen(a: PatientAppointment, now: number | null): boolean {
  return (
    a.status === "completed" && a.review_open_until !== null && now !== null && now <= new Date(a.review_open_until).getTime()
  );
}

/**
 * Leave, edit or delete the review of one completed visit. Within the review window the
 * patient can write or change it; after it they can still read it (and the doctor's reply)
 * and delete it.
 */
export function ReviewDialog({
  appointment,
  doctorName,
  patientName,
  onClose,
  onChanged,
}: {
  appointment: PatientAppointment;
  doctorName: string;
  patientName: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const existing = appointment.review;
  const now = useNow();
  const windowOpen = reviewWindowOpen(appointment, now);
  const editable = existing ? existing.can_edit : windowOpen;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [anonymous, setAnonymous] = useState(existing?.is_anonymous ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OwnReview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError("Choose a rating from 1 to 5 stars.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { rating, comment: comment.trim() || null, is_anonymous: anonymous };
      const review = await api<OwnReview>(`/appointments/${appointment.id}/review`, {
        method: existing ? "PUT" : "POST",
        body,
      });
      setSaved(review);
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await api(`/appointments/${appointment.id}/review`, { method: "DELETE" });
    setConfirmDelete(false);
    onChanged();
    onClose();
  }

  const when = formatDate(appointment.slot.date);
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
          className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h2 id="review-title" className="text-lg font-bold text-ink">
            {saved ? "Thank you for your review" : existing ? (editable ? "Edit your review" : "Your review") : "Rate your visit"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {doctorName} · visit on {when}
          </p>

          {saved ? (
            <div className="mt-5 space-y-4">
              <Alert tone="success">
                Your review is published on {doctorName}&apos;s profile as{" "}
                <span className="font-semibold">{saved.reviewer_name}</span>. You can edit it until{" "}
                {formatDate(saved.editable_until.slice(0, 10))}.
              </Alert>
              <Button onClick={onClose}>Done</Button>
            </div>
          ) : editable ? (
            <form onSubmit={submit} className="mt-5 space-y-5">
              <StarPicker value={rating} onChange={setRating} disabled={saving} />
              <Field label="Your comments (optional)" htmlFor="review-comment" hint={`${comment.length}/${COMMENT_MAX}`}>
                <Textarea
                  id="review-comment"
                  rows={4}
                  maxLength={COMMENT_MAX}
                  value={comment}
                  placeholder="How was the consultation? Was the doctor on time and easy to talk to?"
                  onChange={(e) => setComment(e.target.value)}
                />
              </Field>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Don&apos;t include personal medical details. Reviews are public.
              </p>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-brand-700"
                />
                <span>
                  <span className="block font-medium text-ink">Post anonymously</span>
                  <span className="block text-sm text-slate-600">
                    Shown as <span className="font-semibold">{publicName(patientName, anonymous)}</span> — your full name is never
                    shown.
                  </span>
                </span>
              </label>
              {error && <Alert tone="error">{error}</Alert>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {existing ? (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                    Delete review
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="secondary" onClick={onClose} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving || !rating}>
                    {saving ? "Saving…" : existing ? "Save changes" : "Post review"}
                  </Button>
                </div>
              </div>
            </form>
          ) : existing ? (
            <div className="mt-5 space-y-4">
              <div>
                <Stars value={existing.rating} size={20} />
                {existing.comment && <p className="mt-2 whitespace-pre-line break-words text-slate-700">{existing.comment}</p>}
                <p className="mt-2 text-sm text-slate-500">Shown as {existing.reviewer_name}</p>
              </div>
              {existing.reply && (
                <div className="rounded-lg border-l-4 border-brand-600 bg-brand-50 px-4 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">Reply from {doctorName}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{existing.reply}</p>
                </div>
              )}
              <p className="text-sm text-slate-600">The 30 days for editing this review have passed. You can still delete it.</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete review
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <p className="text-slate-700">Reviews can be left within 30 days of a completed visit, and this one has passed.</p>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {existing?.reply && editable && !saved && (
            <div className="mt-5 rounded-lg border-l-4 border-brand-600 bg-brand-50 px-4 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">Reply from {doctorName}</p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{existing.reply}</p>
            </div>
          )}
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete your review?"
          confirmLabel="Delete review"
          busyLabel="Deleting…"
          tone="danger"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        >
          <p>It&apos;s removed from {doctorName}&apos;s profile and rating straight away. This can&apos;t be undone.</p>
          {!windowOpen && <p>The review window has closed, so you won&apos;t be able to review this visit again.</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
