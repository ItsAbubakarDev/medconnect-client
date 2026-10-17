"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { CancellationInfo } from "@/components/cancellation-info";
import { RequireRole } from "@/components/require-role";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Button, ButtonLink, Card, Container, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatDate, formatTime } from "@/lib/format";
import type { Appointment, DoctorPublic } from "@/lib/types";

const slotKey = (a: Appointment) => `${a.slot.date}T${a.slot.start_time}`;

function AppointmentItem({
  appointment,
  doctor,
  onChanged,
}: {
  appointment: Appointment;
  doctor: DoctorPublic | null | undefined;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCancel = appointment.status === "pending" || appointment.status === "confirmed";

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/appointments/${appointment.id}/cancel`, { method: "PATCH" });
      onChanged();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
          {error && (
            <div className="mt-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {appointment.status === "confirmed" && <ButtonLink href={`/appointments/${appointment.id}/call`}>Join video call</ButtonLink>}
          {canCancel &&
            (confirming ? (
              <div className="flex gap-2">
                <Button variant="danger" size="sm" onClick={cancel} disabled={busy}>
                  {busy ? "Cancelling…" : "Yes, cancel"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Cancel appointment
              </Button>
            ))}
        </div>
      </div>
    </Card>
  );
}

function PatientDashboard() {
  const { displayName, profileLoaded } = useAuth();
  const bookedId = useSearchParams().get("booked");
  const [version, setVersion] = useState(0);
  const [appointments, setAppointments] = useState<{ version: number; data?: Appointment[]; error?: string } | null>(null);
  const [doctors, setDoctors] = useState<Record<number, DoctorPublic | null>>({});
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  // Refetch every 10s (and on returning to the tab), so a doctor accepting, cancelling or
  // completing shows up without a reload.
  const liveTick = useLiveRefresh(10_000);

  useEffect(() => {
    let cancelled = false;
    api<Appointment[]>("/appointments/me")
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

  const shown = tab === "upcoming" ? upcoming : history;

  return (
    <Container className="py-10">
      <PageHeader
        title="My appointments"
        subtitle={displayName ? `Signed in as ${displayName}` : undefined}
        actions={
          <ButtonLink href="/doctors" variant="accent">
            Book a new appointment
          </ButtonLink>
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
          <AppointmentItem key={a.id} appointment={a} doctor={doctors[a.doctor_id]} onChanged={() => setVersion((v) => v + 1)} />
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
