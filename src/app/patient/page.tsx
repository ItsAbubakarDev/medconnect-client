"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { CancellationInfo } from "@/components/cancellation-info";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Stars } from "@/components/rating";
import { ReviewDialog, reviewWindowOpen } from "@/components/review-dialog";
import { RequireRole } from "@/components/require-role";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Button, ButtonLink, Card, Container, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatDate, formatTime } from "@/lib/format";
import { timeAgo } from "@/lib/notifications";
import type { DoctorPublic, PatientAppointment } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const slotKey = (a: PatientAppointment) => `${a.slot.date}T${a.slot.start_time}`;

/** One line on what this appointment's doctor can see of the patient's history. */
function SharingLine({ appointment: a, doctorName }: { appointment: PatientAppointment; doctorName: string }) {
  const now = useNow();
  const s = a.sharing;
  if (!s || a.status === "cancelled") return null;
  const access = s.access;
  let text: string;
  if (s.status === "revoked") text = "You stopped sharing your medical history for this appointment.";
  else if (access.reason === "pending") text = `Your medical history will be shared with ${doctorName} once they accept.`;
  else if (access.reason === "expired") text = "The follow-up period has ended; your history is no longer shared.";
  else text = `Your medical history is shared with ${doctorName} until ${formatDate(access.ends_on)}${s.excluded_count ? ` (${s.excluded_count} item${s.excluded_count > 1 ? "s" : ""} left out)` : ""}.`;
  const viewed = s.doctor_views > 0 && s.last_viewed_at && now !== null ? ` Viewed ${s.doctor_views} time${s.doctor_views > 1 ? "s" : ""}, last ${timeAgo(s.last_viewed_at, now)}.` : "";
  return (
    <p className="mt-2 text-sm text-slate-600">
      {text}
      {viewed}{" "}
      <Link href={`/patient/appointments/${a.id}/sharing`} className="font-semibold text-brand-700 hover:underline">
        Manage sharing
      </Link>
    </p>
  );
}

/** For a completed visit: the patient's review, or the invitation to leave one. */
function ReviewLine({ appointment: a, onOpen }: { appointment: PatientAppointment; onOpen: () => void }) {
  const now = useNow();
  if (a.status !== "completed") return null;
  const open = reviewWindowOpen(a, now);
  if (a.review) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
        <span>Your review:</span>
        <Stars value={a.review.rating} size={14} />
        {a.review.reply && <span className="font-medium text-brand-800">· The doctor replied</span>}
      </div>
    );
  }
  if (!open || !a.review_open_until) return null;
  return (
    <p className="mt-2 text-sm text-slate-600">
      How was your visit? You can leave a review until {formatDate(a.review_open_until.slice(0, 10))}.{" "}
      <button type="button" onClick={onOpen} className="font-semibold text-brand-700 hover:underline">
        Rate your visit
      </button>
    </p>
  );
}

function AppointmentItem({
  appointment,
  doctor,
  highlighted,
  openReview,
  onChanged,
}: {
  appointment: PatientAppointment;
  doctor: DoctorPublic | null | undefined;
  /** Opened from a notification: outlined so it's easy to spot. */
  highlighted: boolean;
  /** Opened from a "leave a review" / "the doctor replied" notification. */
  openReview: boolean;
  onChanged: () => void;
}) {
  const { displayName } = useAuth();
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const [reviewing, setReviewing] = useState(openReview);
  const reviewable = appointment.status === "completed" && (appointment.review !== null || reviewWindowOpen(appointment, now));
  const canCancel = appointment.status === "pending" || appointment.status === "confirmed";
  const doctorName = doctor?.full_name ?? "your doctor";
  const when = `${formatDate(appointment.slot.date)} at ${formatTime(appointment.slot.start_time)}`;

  async function cancel() {
    await api(`/appointments/${appointment.id}/cancel`, { method: "PATCH" });
    setConfirming(false);
    onChanged();
  }

  return (
    <Card className={highlighted ? "ring-2 ring-brand-600" : ""}>
      <div id={`appointment-${appointment.id}`} className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/doctors/${appointment.doctor_id}`} className="truncate text-lg font-semibold text-ink hover:text-brand-700">
              {doctor === undefined ? "Loading doctor…" : (doctor?.full_name ?? "Doctor")}
            </Link>
            <StatusBadge status={appointment.status} />
          </div>
          {doctor?.specialty && <p className="text-sm font-medium text-brand-700">{doctor.specialty}</p>}
          <p className="mt-2 text-slate-700">
            {formatDate(appointment.slot.date)} · {formatTime(appointment.slot.start_time)} – {formatTime(appointment.slot.end_time)}
          </p>
          {appointment.notes && <p className="mt-1 break-words text-sm text-slate-600">Your note: {appointment.notes}</p>}
          {appointment.status === "pending" && (
            <p className="mt-1 text-sm text-amber-800">Waiting for the doctor to confirm.</p>
          )}
          <CancellationInfo appointment={appointment} viewer="patient" />
          <SharingLine appointment={appointment} doctorName={doctor?.full_name ?? "your doctor"} />
          <ReviewLine appointment={appointment} onOpen={() => setReviewing(true)} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {appointment.status === "confirmed" && <ButtonLink href={`/appointments/${appointment.id}/call`}>Join video call</ButtonLink>}
          {canCancel && (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Cancel appointment
            </Button>
          )}
          {reviewable && (
            <Button variant={appointment.review ? "secondary" : "accent"} onClick={() => setReviewing(true)}>
              {!appointment.review ? "Rate your visit" : appointment.review.can_edit ? "Edit your review" : "View your review"}
            </Button>
          )}
        </div>
      </div>

      {reviewing && reviewable && (
        <ReviewDialog
          appointment={appointment}
          doctorName={doctor?.full_name ?? "your doctor"}
          patientName={displayName}
          onClose={() => setReviewing(false)}
          onChanged={onChanged}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="Cancel this appointment?"
          confirmLabel="Yes, cancel appointment"
          busyLabel="Cancelling…"
          cancelLabel="Keep appointment"
          tone="danger"
          onConfirm={cancel}
          onClose={() => setConfirming(false)}
        >
          <p>
            Your appointment with <span className="font-semibold text-ink">{doctorName}</span> on{" "}
            <span className="font-semibold text-ink">{when}</span> will be cancelled and the doctor will be told.
          </p>
          <p>This can&apos;t be undone — to see them, you&apos;d need to book again (the time may be taken by then).</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function PatientDashboard() {
  const { displayName, profileLoaded } = useAuth();
  const searchParams = useSearchParams();
  const bookedId = searchParams.get("booked");
  // ?appointment=ID: opened from a notification — show that appointment's tab and point at it.
  const focusId = Number(searchParams.get("appointment")) || null;
  const reviewFocus = searchParams.get("review") === "1";
  const [focused, setFocused] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [appointments, setAppointments] = useState<{ version: number; data?: PatientAppointment[]; error?: string } | null>(null);
  const [doctors, setDoctors] = useState<Record<number, DoctorPublic | null>>({});
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  // Refetch every 10s (and on returning to the tab), so a doctor accepting, cancelling or
  // completing shows up without a reload.
  const liveTick = useLiveRefresh(10_000);

  useEffect(() => {
    let cancelled = false;
    api<PatientAppointment[]>("/appointments/me")
      .then((data) => !cancelled && setAppointments({ version, data }))
      // A failed background refresh keeps the list already on screen.
      .catch((e) => !cancelled && setAppointments((prev) => (prev?.data ? prev : { version, error: messageOf(e) })));
    return () => {
      cancelled = true;
    };
  }, [version, liveTick]);

  const list = appointments?.data;

  // The patient's appointment list only carries doctor_id; look each doctor up once.
  useEffect(() => {
    if (!list) return;
    const missing = [...new Set(list.map((a) => a.doctor_id))].filter((id) => !(id in doctors));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        api<DoctorPublic>(`/doctors/${id}`, { auth: false })
          .then((d) => [id, d] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((entries) => !cancelled && setDoctors((prev) => ({ ...prev, ...Object.fromEntries(entries) })));
    return () => {
      cancelled = true;
    };
  }, [list, doctors]);

  const { upcoming, history } = useMemo(() => {
    const all = list ?? [];
    return {
      upcoming: all
        .filter((a) => a.status === "pending" || a.status === "confirmed")
        .sort((a, b) => slotKey(a).localeCompare(slotKey(b))),
      history: all
        .filter((a) => a.status === "completed" || a.status === "cancelled")
        .sort((a, b) => slotKey(b).localeCompare(slotKey(a))),
    };
  }, [list]);

  if (focusId !== null && focusId !== focused && list) {
    const target = list.find((a) => a.id === focusId);
    if (target) {
      setFocused(focusId);
      setTab(target.status === "pending" || target.status === "confirmed" ? "upcoming" : "history");
    }
  }
  useEffect(() => {
    if (focused !== null) document.getElementById(`appointment-${focused}`)?.scrollIntoView({ block: "center" });
  }, [focused, tab]);

  const shown = tab === "upcoming" ? upcoming : history;

  return (
    <Container className="py-10">
      <PageHeader
        title="My appointments"
        subtitle={displayName ? `Signed in as ${displayName}` : undefined}
        actions={
          <>
            <ButtonLink href="/patient/history" variant="secondary">
              My health record
            </ButtonLink>
            <ButtonLink href="/doctors" variant="accent">
              Book a new appointment
            </ButtonLink>
          </>
        }
      />

      <div className="mt-6 space-y-4">
        {bookedId && (
          <Alert tone="success">Appointment booked. The doctor will confirm it shortly — you&apos;ll see the status change here.</Alert>
        )}
        {profileLoaded && !displayName && (
          <Alert tone="warning">
            Add your full name to your profile — it&apos;s required to book appointments.{" "}
            <Link href="/patient/profile" className="font-semibold underline">
              Complete profile
            </Link>
          </Alert>
        )}
      </div>

      <div className="mt-6 flex gap-2 border-b border-slate-200" role="tablist">
        {(["upcoming", "history"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-ink"}`}
          >
            {t === "upcoming" ? `Upcoming (${upcoming.length})` : `History (${history.length})`}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4">
        {!appointments && <p className="text-slate-500">Loading appointments…</p>}
        {appointments?.error && <Alert tone="error">{appointments.error}</Alert>}
        {list && shown.length === 0 && (
          <EmptyState title={tab === "upcoming" ? "No upcoming appointments" : "No past appointments yet"}>
            {tab === "upcoming" && (
              <Link href="/doctors" className="font-semibold text-brand-700 hover:underline">
                Find a doctor and book a consultation
              </Link>
            )}
          </EmptyState>
        )}
        {shown.map((a) => (
          <AppointmentItem
            key={a.id}
            appointment={a}
            doctor={doctors[a.doctor_id]}
            highlighted={a.id === focusId}
            openReview={reviewFocus && a.id === focusId}
            onChanged={() => setVersion((v) => v + 1)}
          />
        ))}
      </div>
    </Container>
  );
}

export default function PatientPage() {
  return (
    <RequireRole role="patient">
      <Suspense fallback={<PageLoading />}>
        <PatientDashboard />
      </Suspense>
    </RequireRole>
  );
}
