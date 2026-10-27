"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ShareChooser } from "@/components/health/share-chooser";
import { RequireRole } from "@/components/require-role";
import { Alert, Button, ButtonLink, Card, Container, Field, PageLoading, Textarea } from "@/components/ui";
import { ApiError, api, messageOf } from "@/lib/api";
import { formatDate, formatDayShort, formatTime } from "@/lib/format";
import { STATUS_LABELS, TYPE_LABELS, windowLabel } from "@/lib/follow-ups";
import { refKey } from "@/lib/health";
import type { Appointment, FollowUpBooking, MedicalHistory, ShareItemType, Slot } from "@/lib/types";

const SHOWN = 9;

function slotLabel(s: Slot) {
  const { weekday, day } = formatDayShort(s.date);
  return `${weekday} ${day} · ${formatTime(s.start_time)}`;
}

function BookFollowUp({ visitId }: { visitId: number }) {
  const router = useRouter();
  const [state, setState] = useState<{ data?: FollowUpBooking; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<MedicalHistory | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string> | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<FollowUpBooking>(`/follow-ups/visit/${visitId}`)
      .then((data) => !cancelled && setState({ data }))
      .catch(
        (e) =>
          !cancelled &&
          setState({ error: e instanceof ApiError && e.status === 404 ? "This follow-up could not be found." : messageOf(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [visitId, version]);

  useEffect(() => {
    let cancelled = false;
    api<MedicalHistory>("/patients/me/history")
      .then((h) => !cancelled && setHistory(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return <PageLoading />;
  if (state.error || !state.data) {
    return (
      <Container className="max-w-3xl py-16">
        <Alert tone="error">{state.error}</Alert>
        <ButtonLink href="/patient" variant="secondary" className="mt-6">
          Back to My appointments
        </ButtonLink>
      </Container>
    );
  }

  const { follow_up: f, in_window, after_window } = state.data;
  const outside = in_window.length === 0;
  const times = outside ? after_window : in_window;
  // The nearest time is pre-selected: confirming is the one tap.
  const selected = times.find((s) => s.id === chosen) ?? times[0] ?? null;
  const reason = notes ?? state.data.reason_for_visit;
  const unticked = excluded ?? new Set(state.data.share_exclusions.map(refKey));
  const doctorName = f.doctor_name ?? "your doctor";
  const shown = showAll ? times : times.slice(0, SHOWN);
  const selectedInWindow = selected !== null && selected.date >= f.window_start && selected.date <= f.window_end;

  async function book() {
    if (!selected) return;
    const share_exclusions = [...unticked].map((key) => {
      const [type, id] = key.split(":");
      return { type: type as ShareItemType, id: Number(id) };
    });
    try {
      const appt = await api<Appointment>(`/follow-ups/${f.id}/book`, {
        method: "POST",
        body: { slot_id: selected.id, notes: reason.trim() || null, share_exclusions },
      });
      router.push(`/patient?booked=${appt.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // The time was just taken (or the follow-up booked in another tab): show what's free now.
        setConfirming(false);
        setChosen(null);
        setNotice(messageOf(err));
        setVersion((v) => v + 1);
        return;
      }
      throw err;
    }
  }

  return (
    <Container className="max-w-3xl py-10">
      <Link href="/patient" className="text-sm font-medium text-brand-700 hover:underline">
        ← My appointments
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-ink sm:text-3xl">Book your follow-up</h1>
      <p className="mt-1 text-slate-600">
        {doctorName}
        {f.doctor_specialty ? `, ${f.doctor_specialty}` : ""} · after your visit on {formatDate(f.visit_date)}
      </p>

      <Card className="mt-6">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Reason</dt>
            <dd className="mt-0.5 break-words font-semibold text-ink">{f.reason}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Recommended</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              Around {formatDate(f.target_date)}
              <span className="block text-sm font-normal text-slate-600">{windowLabel(f)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Consultation · fee</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {TYPE_LABELS[f.consultation_type]}
              <span className="block text-sm font-normal text-slate-600">{f.fee_label}</span>
            </dd>
          </div>
        </dl>
      </Card>

      <div className="mt-6 space-y-4">
        {notice && <Alert tone="warning">{notice} Here are the times that are free now.</Alert>}
        {!f.can_book ? (
          <Alert tone={f.status === "expired" ? "warning" : "info"}>
            {f.status === "booked" && f.booked ? (
              <>
                You&apos;ve booked this follow-up for {formatDate(f.booked.date)} at {formatTime(f.booked.start_time)}.{" "}
                <Link href={`/patient?appointment=${f.booked.id}`} className="font-semibold underline">
                  See the appointment
                </Link>
              </>
            ) : f.status === "completed" ? (
              "This follow-up has taken place."
            ) : (
              <>
                The recommended window has passed. You can still book {doctorName} as usual.{" "}
                <Link href={`/doctors/${f.doctor_id}`} className="font-semibold underline">
                  Book {doctorName}
                </Link>
              </>
            )}
          </Alert>
        ) : f.bookable_from ? (
          <Alert tone="info">
            {doctorName}&apos;s times for this window open on {formatDate(f.bookable_from)}. Come back then to book it —
            we&apos;ll remind you shortly before the window starts.
          </Alert>
        ) : times.length === 0 ? (
          <Alert tone="warning">
            There are no free times in the recommended window ({windowLabel(f)}) or soon after it.{" "}
            <Link href={`/doctors/${f.doctor_id}`} className="font-semibold underline">
              See all of {doctorName}&apos;s times
            </Link>
          </Alert>
        ) : (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setConfirming(true);
            }}
            className="space-y-6"
          >
            {outside && (
              <Alert tone="warning">
                {doctorName} has no free times in the recommended window ({windowLabel(f)}) — fully booked or away. These are the
                next available times. A follow-up outside the window needs the doctor to confirm it.
              </Alert>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">
                {outside ? "Next available times" : "Free times in the window, nearest the recommended date first"}
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {shown.map((s) => {
                  const active = selected?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChosen(s.id)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${active ? "border-brand-700 bg-brand-50 text-brand-800 ring-1 ring-brand-700" : "border-slate-300 text-ink hover:bg-slate-50"}`}
                    >
                      <span className="block font-semibold">{slotLabel(s)}</span>
                      {outside ? (
                        <span className="block text-xs text-amber-800">Outside recommended window</span>
                      ) : (
                        s.date === f.target_date && <span className="block text-xs text-emerald-800">Recommended day</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {times.length > SHOWN && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer times" : `Show all ${times.length} times`}
                </Button>
              )}
            </fieldset>

            <Field label="Reason for visit" htmlFor="fu-notes" hint="Shared with the doctor. You can change it.">
              <Textarea id="fu-notes" rows={2} maxLength={1000} value={reason} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {history ? (
              <ShareChooser history={history} doctorName={doctorName} excluded={unticked} onChange={setExcluded} />
            ) : (
              <p className="text-sm text-slate-500">Loading your health record…</p>
            )}

            <Button type="submit" variant="accent" size="lg" className="w-full sm:w-auto" disabled={!selected}>
              Book follow-up
            </Button>
          </form>
        )}
        {f.can_book && <p className="text-sm text-slate-500">Status: {STATUS_LABELS[f.status]}</p>}
      </div>

      {confirming && selected && (
        <ConfirmDialog
          title="Confirm your follow-up"
          confirmLabel="Confirm booking"
          busyLabel="Booking…"
          tone="accent"
          onConfirm={book}
          onClose={() => setConfirming(false)}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-3">
            <dt className="text-slate-500">Doctor</dt>
            <dd className="break-words font-semibold text-ink">{doctorName}</dd>
            <dt className="text-slate-500">When</dt>
            <dd className="font-semibold text-ink">
              {formatDate(selected.date)}, {formatTime(selected.start_time)} – {formatTime(selected.end_time)}
            </dd>
            <dt className="text-slate-500">Type</dt>
            <dd className="font-semibold text-ink">{TYPE_LABELS[f.consultation_type]}</dd>
            <dt className="text-slate-500">Fee</dt>
            <dd className="font-semibold text-ink">{f.fee_label}</dd>
            {reason.trim() && (
              <>
                <dt className="text-slate-500">Reason</dt>
                <dd className="break-words text-ink">{reason.trim()}</dd>
              </>
            )}
          </dl>
          <p>
            {selectedInWindow
              ? `It's inside the window ${doctorName} recommended, so it's confirmed straight away.`
              : `It's outside the recommended window, so ${doctorName} will confirm it. You'll be notified.`}{" "}
            Your history is shared as you chose above.
          </p>
        </ConfirmDialog>
      )}
    </Container>
  );
}

function ByVisit() {
  const { visitId } = useParams<{ visitId: string }>();
  return <BookFollowUp key={visitId} visitId={Number(visitId)} />;
}

export default function Page() {
  return (
    <RequireRole role="patient">
      <Suspense fallback={<PageLoading />}>
        <ByVisit />
      </Suspense>
    </RequireRole>
  );
}
