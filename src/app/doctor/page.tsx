"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { CancelDialog } from "@/components/cancel-dialog";
import { CancellationInfo } from "@/components/cancellation-info";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RequireRole } from "@/components/require-role";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Button, ButtonLink, Card, Container, EmptyState, Field, Input, PageHeader, PageLoading, Select } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { clinicNow, formatDate, formatTime, hasStarted } from "@/lib/format";
import type { AppointmentStatus, DoctorAppointment, DoctorProfile, DoctorReviewPage } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const STATUS_FILTERS: { value: "" | AppointmentStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Awaiting confirmation" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function AppointmentRow({
  appointment,
  now,
  highlighted,
  onChanged,
  onCancel,
}: {
  appointment: DoctorAppointment;
  now: number | null;
  /** Opened from a notification: outlined so it's easy to spot. */
  highlighted: boolean;
  onChanged: () => void;
  onCancel: (a: DoctorAppointment) => void;
}) {
  // Accept and complete can't be taken back (and tell the patient), and reopening a time lets
  // patients book it, so they're confirmed first.
  const [confirming, setConfirming] = useState<"accept" | "complete" | "reopen" | null>(null);
  const { status, slot } = appointment;
  const started = now !== null && hasStarted(slot, now);
  const patientName = appointment.patient.full_name ?? `Patient #${appointment.patient_id}`;
  const when = `${formatDate(slot.date)} at ${formatTime(slot.start_time)}`;

  async function confirmAction() {
    await api(`/appointments/${appointment.id}/${confirming}`, { method: "PATCH" });
    setConfirming(null);
    onChanged();
  }

  async function reopen() {
    await api(`/doctors/me/slots/${slot.id}/reopen`, { method: "PATCH" });
    setConfirming(null);
    onChanged();
  }

  return (
    <Card className={highlighted ? "ring-2 ring-brand-600" : ""}>
      <div id={`appointment-${appointment.id}`} className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-lg font-semibold text-ink">
              {appointment.patient.full_name ?? `Patient #${appointment.patient_id}`}
            </p>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-slate-700">
            {formatDate(slot.date)} · {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
          </p>
          {appointment.notes && (
            <p className="mt-1 break-words text-sm text-slate-600">
              <span className="font-medium">Reason for visit:</span> {appointment.notes}
            </p>
          )}
          <CancellationInfo appointment={appointment} viewer="doctor" />
          {appointment.history_access?.reason === "pending" && (
            <p className="mt-2 text-sm text-slate-600">The patient&apos;s medical history opens once you accept.</p>
          )}
          {appointment.history_access?.reason === "revoked" && status !== "cancelled" && (
            <p className="mt-2 text-sm text-slate-600">The patient isn&apos;t sharing their medical history for this appointment.</p>
          )}
          {status === "cancelled" && slot.is_blocked && (
            <p className="mt-2 text-sm text-slate-600">This time is withdrawn from your schedule.</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {(appointment.history_access?.open || appointment.has_consultation) && (
            <ButtonLink href={`/doctor/appointments/${appointment.id}`} variant="secondary">
              {appointment.history_access?.open ? "Patient history" : "Your consultation record"}
            </ButtonLink>
          )}
          {status === "pending" && <Button onClick={() => setConfirming("accept")}>Accept</Button>}
          {status === "confirmed" && (
            <>
              <ButtonLink href={`/appointments/${appointment.id}/call`}>Join video call</ButtonLink>
              <Button
                variant="secondary"
                onClick={() => setConfirming("complete")}
                disabled={!started}
                title={started ? undefined : "Available once the appointment's start time has passed"}
              >
                Mark completed
              </Button>
            </>
          )}
          {(status === "pending" || status === "confirmed") && (
            <Button variant="danger" onClick={() => onCancel(appointment)}>
              Cancel
            </Button>
          )}
          {status === "cancelled" && slot.is_blocked && (
            <Button variant="secondary" onClick={() => setConfirming("reopen")} disabled={started}>
              Reopen this time
            </Button>
          )}
        </div>
      </div>

      {confirming === "accept" && (
        <ConfirmDialog
          title="Accept this appointment?"
          confirmLabel="Accept appointment"
          busyLabel="Accepting…"
          onConfirm={confirmAction}
          onClose={() => setConfirming(null)}
        >
          <p>
            <span className="font-semibold text-ink">{patientName}</span> · <span className="font-semibold text-ink">{when}</span>
          </p>
          <p>The patient will be notified that it&apos;s confirmed, and you&apos;ll both be able to join the video call.</p>
        </ConfirmDialog>
      )}
      {confirming === "complete" && (
        <ConfirmDialog
          title="Mark this consultation as completed?"
          confirmLabel="Mark completed"
          busyLabel="Saving…"
          onConfirm={confirmAction}
          onClose={() => setConfirming(null)}
        >
          <p>
            <span className="font-semibold text-ink">{patientName}</span> · <span className="font-semibold text-ink">{when}</span>
          </p>
          <p>It moves to completed and the patient is notified. This can&apos;t be undone.</p>
        </ConfirmDialog>
      )}
      {confirming === "reopen" && (
        <ConfirmDialog
          title="Reopen this time for booking?"
          confirmLabel="Reopen this time"
          busyLabel="Reopening…"
          onConfirm={reopen}
          onClose={() => setConfirming(null)}
        >
          <p>
            <span className="font-semibold text-ink">{when}</span>
          </p>
          <p>Any patient can book it straight away. The cancelled appointment stays cancelled.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function DoctorDashboard() {
  const { displayName, profileLoaded } = useAuth();
  const now = useNow();
  const today = now !== null ? clinicNow(now).date : null;

  const [statusFilter, setStatusFilter] = useState<"" | AppointmentStatus>("");
  const [dateFilter, setDateFilter] = useState("");
  const [version, setVersion] = useState(0);
  const [cancelling, setCancelling] = useState<DoctorAppointment | null>(null);
  // Refetch every 10s (and on returning to the tab), so new bookings and patient
  // cancellations show up without a reload.
  const liveTick = useLiveRefresh(10_000);

  // ?appointment=ID&date=YYYY-MM-DD: opened from a notification — show that day (past days
  // aren't in the default list) and point at the appointment. Applied once per link, so
  // changing the filters afterwards isn't overridden.
  const searchParams = useSearchParams();
  const focusId = Number(searchParams.get("appointment")) || null;
  const focusDate = searchParams.get("date");
  const focusKey = focusId !== null ? `${focusId}|${focusDate ?? ""}` : null;
  const [appliedFocus, setAppliedFocus] = useState<string | null>(null);
  if (focusKey !== null && focusKey !== appliedFocus) {
    setAppliedFocus(focusKey);
    setStatusFilter("");
    setDateFilter(focusDate && /^\d{4}-\d{2}-\d{2}$/.test(focusDate) ? focusDate : "");
  }

  const listKey = `${statusFilter}|${dateFilter}|${version}|${liveTick}`;
  const [list, setList] = useState<{ key: string; data?: DoctorAppointment[]; error?: string } | null>(null);
  const [overview, setOverview] = useState<DoctorAppointment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (dateFilter) params.set("date", dateFilter);
    api<DoctorAppointment[]>(`/doctors/me/appointments${params.size ? `?${params}` : ""}`)
      .then((data) => !cancelled && setList({ key: listKey, data }))
      // A failed background refresh keeps the list already on screen (same filters only).
      .catch(
        (e) =>
          !cancelled &&
          setList((prev) =>
            prev?.data && prev.key.split("|").slice(0, 2).join("|") === `${statusFilter}|${dateFilter}`
              ? prev
              : { key: listKey, error: messageOf(e) },
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [statusFilter, dateFilter, listKey]);

  // The doctor's own profile (is the location set?) and rating, for the banner and tile.
  const [me, setMe] = useState<DoctorProfile | null>(null);
  const [reviews, setReviews] = useState<DoctorReviewPage | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<DoctorProfile>("/doctors/me")
      .then((p) => !cancelled && setMe(p))
      .catch(() => {});
    api<DoctorReviewPage>("/doctors/me/reviews?page_size=1")
      .then((r) => !cancelled && setReviews(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  // Unfiltered "today and upcoming" view, for the summary tiles.
  useEffect(() => {
    let cancelled = false;
    api<DoctorAppointment[]>("/doctors/me/appointments")
      .then((data) => !cancelled && setOverview(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version, liveTick]);

  const stats = useMemo(() => {
    const all = overview ?? [];
    return {
      today: today ? all.filter((a) => a.slot.date === today && (a.status === "pending" || a.status === "confirmed")).length : 0,
      pending: all.filter((a) => a.status === "pending").length,
      confirmed: all.filter((a) => a.status === "confirmed").length,
    };
  }, [overview, today]);

  const current = list; // the previous result stays visible while a refresh is in flight
  const focusLoaded = focusId !== null && current?.data?.some((a) => a.id === focusId);
  useEffect(() => {
    if (focusLoaded) document.getElementById(`appointment-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusLoaded, focusId]);
  const refresh = () => setVersion((v) => v + 1);
  const filtered = statusFilter !== "" || dateFilter !== "";

  return (
    <Container className="py-10">
      <PageHeader
        title={displayName ? `Welcome, ${displayName}` : "Doctor dashboard"}
        subtitle="Manage your appointment requests and consultations."
        actions={
          <ButtonLink href="/doctor/availability" variant="secondary">
            Manage availability
          </ButtonLink>
        }
      />

      {profileLoaded && !displayName && (
        <div className="mt-6">
          <Alert tone="warning">
            Complete your profile so patients can find you.{" "}
            <Link href="/doctor/profile" className="font-semibold underline">
              Edit profile
            </Link>
          </Alert>
        </div>
      )}

      {me && !me.city && (
        <div className="mt-6">
          <Alert tone="warning">
            Add your city and area so patients searching in your city can find you. Until then you only appear when patients
            don&apos;t filter by city.{" "}
            <Link href="/doctor/profile" className="font-semibold underline">
              Complete your location
            </Link>
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Today's appointments", value: stats.today },
          { label: "Awaiting your confirmation", value: stats.pending },
          { label: "Confirmed upcoming", value: stats.confirmed },
        ].map((s) => (
          <Card key={s.label}>
            <p className="text-sm text-slate-600">{s.label}</p>
            <p className="mt-1 text-3xl font-bold text-ink">{overview ? s.value : "–"}</p>
          </Card>
        ))}
        <Link href="/doctor/reviews" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-brand-700">
          <Card className="h-full hover:border-brand-600">
            <p className="text-sm text-slate-600">Your rating</p>
            <p className="mt-1 text-3xl font-bold text-ink">
              {!reviews ? "–" : reviews.summary.average !== null ? `★ ${reviews.summary.average.toFixed(1)}` : "New"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {reviews && reviews.summary.count > 0
                ? `${reviews.summary.count} review${reviews.summary.count === 1 ? "" : "s"}${reviews.unreplied ? ` · ${reviews.unreplied} to reply to` : ""}`
                : "No reviews yet"}
            </p>
          </Card>
        </Link>
      </div>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="sm:w-60">
          <Field label="Status" htmlFor="status-filter">
            <Select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | AppointmentStatus)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="sm:w-52">
          <Field label="Date" htmlFor="date-filter" hint="Empty = today and upcoming">
            <Input id="date-filter" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </Field>
        </div>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setStatusFilter("");
              setDateFilter("");
            }}
            className="sm:mt-7"
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-4">
        {!current && <p className="text-slate-500">Loading appointments…</p>}
        {current?.error && <Alert tone="error">{current.error}</Alert>}
        {current?.data?.length === 0 && (
          <EmptyState title={filtered ? "No appointments match these filters" : "No upcoming appointments"}>
            {!filtered && (
              <>
                Patients can book any time within your weekly hours.{" "}
                <Link href="/doctor/availability" className="font-semibold text-brand-700 hover:underline">
                  Set your availability
                </Link>
              </>
            )}
          </EmptyState>
        )}
        {current?.data?.map((a) => (
          <AppointmentRow
            key={a.id}
            appointment={a}
            now={now}
            highlighted={a.id === focusId}
            onChanged={refresh}
            onCancel={setCancelling}
          />
        ))}
      </div>

      {cancelling && (
        <CancelDialog
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            refresh();
          }}
        />
      )}
    </Container>
  );
}

export default function DoctorPage() {
  return (
    <RequireRole role="doctor">
      <Suspense fallback={<PageLoading />}>
        <DoctorDashboard />
      </Suspense>
    </RequireRole>
  );
}
