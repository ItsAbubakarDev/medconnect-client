"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ShareChooser } from "@/components/health/share-chooser";
import { RequireRole } from "@/components/require-role";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Button, Card, Container, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { refKey } from "@/lib/health";
import { timeAgo } from "@/lib/notifications";
import type { AccessLogEntry, DoctorPublic, MedicalHistory, PatientAppointment, ShareItemType, Sharing } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

function accessText(s: Sharing, doctor: string): { tone: "success" | "info" | "warning"; text: string } {
  if (s.status === "revoked" && s.ended_reason === "cancelled")
    return { tone: "warning", text: "This appointment was cancelled, so nothing is shared any more." };
  if (s.status === "revoked")
    return { tone: "warning", text: `You stopped sharing. ${doctor} can't see your medical history through this appointment.` };
  if (s.access.reason === "pending")
    return { tone: "info", text: `${doctor} will be able to see what's ticked below once they accept the appointment.` };
  if (s.access.reason === "expired")
    return {
      tone: "info",
      text: `The follow-up period ended on ${formatDate(s.access.ends_on)}. ${doctor} only keeps their own consultation records.`,
    };
  return {
    tone: "success",
    text: `${doctor} can see what's ticked below until ${formatDate(s.access.ends_on)} (30 days after the visit, for follow-up).`,
  };
}

function LogRow({ entry: e, doctor }: { entry: AccessLogEntry; doctor: string }) {
  const now = useNow();
  const what =
    e.action === "viewed_history"
      ? "viewed your medical history"
      : e.action === "downloaded_document"
        ? `downloaded “${e.document_title ?? "a document"}”`
        : `opened “${e.document_title ?? "a document"}”`;
  return (
    <li className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between">
      <span className="text-sm text-ink">
        {doctor} {what}
        {e.times > 1 && <span className="text-slate-500"> · {e.times} times</span>}
      </span>
      <span className="text-sm text-slate-500" title={new Date(e.last_at).toLocaleString("en-GB")}>
        {now !== null ? timeAgo(e.last_at, now) : ""}
        {e.times > 1 && now !== null && ` (first ${timeAgo(e.first_at, now)})`}
      </span>
    </li>
  );
}

function ManageSharing() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    sharing: Sharing;
    appointment: PatientAppointment;
    doctor: DoctorPublic | null;
    history: MedicalHistory;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sharing, appointments, history] = await Promise.all([
          api<Sharing>(`/appointments/${id}/sharing`),
          api<PatientAppointment[]>("/appointments/me"),
          api<MedicalHistory>("/patients/me/history"),
        ]);
        const appointment = appointments.find((a) => String(a.id) === id);
        if (!appointment) throw new Error("Appointment not found");
        const doctor = await api<DoctorPublic>(`/doctors/${appointment.doctor_id}`, { auth: false }).catch(() => null);
        if (cancelled) return;
        setState({ sharing, appointment, doctor, history });
        setExcluded(new Set(sharing.excluded.map(refKey)));
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function update(body: { active?: boolean; excluded?: { type: ShareItemType; id: number }[] }, done: string) {
    setSaving(true);
    setMessage(null);
    try {
      const sharing = await api<Sharing>(`/appointments/${id}/sharing`, { method: "PUT", body });
      setState((s) => s && { ...s, sharing });
      setExcluded(new Set(sharing.excluded.map(refKey)));
      setMessage({ tone: "success", text: done });
    } catch (e) {
      setMessage({ tone: "error", text: messageOf(e) });
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <Container className="py-16">
        <Alert tone="error">{error}</Alert>
        <Link href="/patient" className="mt-6 inline-block font-semibold text-brand-700 hover:underline">
          ← My appointments
        </Link>
      </Container>
    );
  }
  if (!state) return <PageLoading />;

  const { sharing, appointment: a, doctor, history } = state;
  const doctorName = doctor?.full_name ?? "Your doctor";
  const status = accessText(sharing, doctorName);
  const cancelled = sharing.ended_reason === "cancelled";
  const editable = !cancelled && sharing.access.reason !== "expired";
  const changed = !sameSet(excluded, new Set(sharing.excluded.map(refKey)));

  return (
    <Container className="py-10">
      <Link href="/patient" className="text-sm font-medium text-brand-700 hover:underline">
        ← My appointments
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Medical history sharing"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              {doctorName} · {formatDate(a.slot.date)} at {formatTime(a.slot.start_time)} <StatusBadge status={a.status} />
            </span>
          }
        />
      </div>

      <div className="mt-6 space-y-6">
        <Alert tone={status.tone}>{status.text}</Alert>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">What {doctorName} sees</h2>
              <p className="mt-1 text-sm text-slate-600">
                Everything in your health record that isn&apos;t private, minus what you untick here. It stays up to date: a
                report you add before the visit is shared too.
              </p>
            </div>
            {!cancelled &&
              (sharing.status === "active" ? (
                <Button variant="danger" onClick={() => setConfirmStop(true)} disabled={saving}>
                  Stop sharing
                </Button>
              ) : (
                editable && (
                  <Button onClick={() => update({ active: true }, `Sharing with ${doctorName} again.`)} disabled={saving}>
                    Share again
                  </Button>
                )
              ))}
          </div>
          <div className="mt-4">
            <ShareChooser
              history={history}
              doctorName={doctorName}
              excluded={excluded}
              onChange={setExcluded}
              startOpen
              disabled={!editable || saving}
            />
          </div>
          {editable && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={!changed || saving}
                onClick={() =>
                  update(
                    {
                      excluded: [...excluded].map((k) => {
                        const [type, itemId] = k.split(":");
                        return { type: type as ShareItemType, id: Number(itemId) };
                      }),
                    },
                    "Saved. The doctor sees the change straight away.",
                  )
                }
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {changed && <span className="text-sm text-slate-600">You have unsaved changes.</span>}
            </div>
          )}
          {message && (
            <div className="mt-3">
              <Alert tone={message.tone}>{message.text}</Alert>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-ink">Access log</h2>
          <p className="mt-1 text-sm text-slate-600">
            Every time {doctorName} looked at your history or opened a document through this appointment.
          </p>
          {sharing.log.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="Not viewed yet" />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {sharing.log.map((e, i) => (
                <LogRow key={i} entry={e} doctor={doctorName} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {confirmStop && (
        <ConfirmDialog
          title="Stop sharing your medical history?"
          confirmLabel="Stop sharing"
          busyLabel="Stopping…"
          tone="danger"
          onConfirm={async () => {
            await update({ active: false }, `${doctorName} can no longer see your medical history through this appointment.`);
            setConfirmStop(false);
          }}
          onClose={() => setConfirmStop(false)}
        >
          <p>
            {doctorName} loses access straight away. The appointment itself isn&apos;t affected, and you can share again later.
          </p>
        </ConfirmDialog>
      )}
    </Container>
  );
}

export default function ManageSharingPage() {
  return (
    <RequireRole role="patient">
      <Suspense fallback={<PageLoading />}>
        <ManageSharing />
      </Suspense>
    </RequireRole>
  );
}
