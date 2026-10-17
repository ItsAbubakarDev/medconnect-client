"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CancelDialog } from "@/components/cancel-dialog";
import { CancellationInfo } from "@/components/cancellation-info";
import { RequireRole } from "@/components/require-role";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Button, ButtonLink, Card, Container, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { clinicNow, formatDate, formatTime, hasStarted } from "@/lib/format";
import type { AppointmentStatus, DoctorAppointment } from "@/lib/types";
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
  onChanged,
  onCancel,
}: {
  appointment: DoctorAppointment;
  now: number | null;
  onChanged: () => void;
  onCancel: (a: DoctorAppointment) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { status, slot } = appointment;
  const started = now !== null && hasStarted(slot, now);

  async function act(action: "accept" | "complete" | "reopen") {
    setBusy(action);
    setError(null);
    try {
      const path =
        action === "reopen" ? `/doctors/me/slots/${slot.id}/reopen` : `/appointments/${appointment.id}/${action}`;
      await api(path, { method: "PATCH" });
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
          {status === "cancelled" && slot.is_blocked && (
            <p className="mt-2 text-sm text-slate-600">This time is withdrawn from your schedule.</p>
          )}
          {error && (
            <div className="mt-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {status === "pending" && (
            <Button onClick={() => act("accept")} disabled={busy !== null}>
              {busy === "accept" ? "Accepting…" : "Accept"}
            </Button>
          )}
          {status === "confirmed" && (
            <>
              <ButtonLink href={`/appointments/${appointment.id}/call`}>Join video call</ButtonLink>
              <Button
                variant="secondary"
                onClick={() => act("complete")}
                disabled={busy !== null || !started}
                title={started ? undefined : "Available once the appointment's start time has passed"}
              >
                {busy === "complete" ? "Saving…" : "Mark completed"}
              </Button>
            </>
          )}
          {(status === "pending" || status === "confirmed") && (
            <Button variant="danger" onClick={() => onCancel(appointment)} disabled={busy !== null}>
              Cancel
            </Button>
          )}
          {status === "cancelled" && slot.is_blocked && (
            <Button variant="secondary" onClick={() => act("reopen")} disabled={busy !== null || started}>
              {busy === "reopen" ? "Reopening…" : "Reopen this time"}
            </Button>
          )}
        </div>
      </div>
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

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
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
          <AppointmentRow key={a.id} appointment={a} now={now} onChanged={refresh} onCancel={setCancelling} />
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
      <DoctorDashboard />
    </RequireRole>
  );
}
