"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { ConsultationForm } from "@/components/health/consultation-form";
import { PrescriptionEditor } from "@/components/prescription/prescription-editor";
import { FileViewer, callFileUrls, doctorFileUrls, ownPrescriptionUrls } from "@/components/health/file-viewer";
import type { FileUrls } from "@/components/health/file-viewer";
import { ConsultationCard, DocumentGroups, QuickGlance, Timeline } from "@/components/health/history-views";
import { RequireRole } from "@/components/require-role";
import { StatusBadge } from "@/components/status-badge";
import { Alert, Card, Container, EmptyState, PageLoading } from "@/components/ui";
import { ApiError, api, messageOf } from "@/lib/api";
import { clinicToday, formatDate, formatTime, hasStarted } from "@/lib/format";
import { documentTitle, formatSize } from "@/lib/health";
import { TYPE_LABELS } from "@/lib/follow-ups";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import type { CallDocument, Consultation, DoctorPatientHistory, MedicalDocument, OwnConsultation } from "@/lib/types";
import { useNow } from "@/lib/use-now";

type Tab = "timeline" | "documents" | "consultation";

function age(dob: string | null, nowMs: number | null): string | null {
  if (!dob || nowMs === null) return null;
  const now = new Date(nowMs);
  const [y, m, d] = dob.split("-").map(Number);
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years--;
  return `${years} years`;
}

function PatientView({ appointmentId }: { appointmentId: number }) {
  const now = useNow();
  // ?tab=prescription (from the video call), or ?tab=consultation (a follow-up's "your record
  // from then" link): open on the prescription.
  const requestedTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(requestedTab === "consultation" || requestedTab === "prescription" ? "consultation" : "timeline");
  const [history, setHistory] = useState<{ data?: DoctorPatientHistory; closed?: string; error?: string } | null>(null);
  const [own, setOwn] = useState<OwnConsultation | null>(null);
  const [past, setPast] = useState<OwnConsultation[] | null>(null);
  const [viewing, setViewing] = useState<{ document: MedicalDocument; urls: FileUrls; fileId?: number } | null>(null);
  const [version, setVersion] = useState(0);
  // Documents shared in this appointment's video call (open for good, whatever the history access).
  const [callDocs, setCallDocs] = useState<CallDocument[]>([]);
  // The patient updating their history before the visit (a notification) shows up here.
  const liveTick = useLiveRefresh(120_000);

  useEffect(() => {
    let cancelled = false;
    api<DoctorPatientHistory>(`/doctors/me/appointments/${appointmentId}/history`)
      .then((data) => !cancelled && setHistory({ data }))
      .catch((e) => {
        if (cancelled) return;
        // 403: the appointment is theirs, but access isn't open (pending, revoked,
        // cancelled or the follow-up ended) — the server says which.
        setHistory((prev) =>
          prev?.data && !(e instanceof ApiError && e.status === 403)
            ? prev
            : e instanceof ApiError && e.status === 403
              ? { closed: e.message }
              : { error: messageOf(e) },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, version, liveTick]);

  // Their own record for this appointment — and, if access has closed, their earlier ones
  // with this patient (a doctor always keeps their own consultation records).
  useEffect(() => {
    let cancelled = false;
    api<OwnConsultation>(`/doctors/me/appointments/${appointmentId}/consultation`)
      .then((data) => {
        if (cancelled) return;
        setOwn(data);
        return api<OwnConsultation[]>(`/doctors/me/patients/${data.patient.id}/consultations`).then(
          (list) => !cancelled && setPast(list),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appointmentId, version]);

  useEffect(() => {
    let cancelled = false;
    api<CallDocument[]>(`/appointments/${appointmentId}/call-documents`)
      .then((list) => !cancelled && setCallDocs(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appointmentId, liveTick]);

  if (!history || (!own && !history.error && !history.closed && !history.data)) return <PageLoading />;
  if (history.error) {
    return (
      <Container className="py-16">
        <Alert tone="error">{history.error}</Alert>
        <Link href="/doctor" className="mt-6 inline-block font-semibold text-brand-700 hover:underline">
          ← Dashboard
        </Link>
      </Container>
    );
  }

  const data = history.data;
  const appointment = data?.appointment ?? own?.appointment;
  const patientName = data?.patient.full_name ?? own?.patient.full_name ?? "Patient";
  const started =
    appointment && now !== null ? hasStarted({ date: appointment.date, start_time: appointment.start_time }, now) : false;
  const canWrite =
    !!data && !!appointment && (appointment.status === "confirmed" || appointment.status === "completed") && started;
  const openDoc = (document: MedicalDocument, fileId?: number) =>
    setViewing({
      document,
      fileId,
      urls: data ? doctorFileUrls(appointmentId, document.id) : ownPrescriptionUrls(document.consultation_id ?? 0),
    });
  const saved = (c: Consultation) => {
    setOwn((o) => o && { ...o, consultation: c });
    setVersion((v) => v + 1);
  };

  return (
    <Container className="py-10">
      <Link href="/doctor" className="text-sm font-medium text-brand-700 hover:underline">
        ← Dashboard
      </Link>

      <div className="mt-4 flex flex-col gap-2 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{patientName}</h1>
          <p className="mt-1 text-slate-600">
            {[data && age(data.patient.date_of_birth, now), data?.patient.gender].filter(Boolean).join(" · ")}
            {data && (data.patient.date_of_birth || data.patient.gender) ? " · " : ""}
            {appointment && `Appointment ${formatDate(appointment.date)} at ${formatTime(appointment.start_time)}`}
          </p>
        </div>
        {appointment && <StatusBadge status={appointment.status} />}
      </div>

      {own?.follow_up_of && (
        <div className="mt-6">
          <Alert tone="info">
            <span className="font-semibold">Follow-up of the {formatDate(own.follow_up_of.original_visit_date)} visit</span> ·{" "}
            {TYPE_LABELS[own.follow_up_of.consultation_type]} · {own.follow_up_of.fee_label}
            {!own.follow_up_of.in_window && " · booked outside the recommended window"}
            <br />
            Reason: {own.follow_up_of.reason}.{" "}
            <Link
              href={`/doctor/appointments/${own.follow_up_of.original_appointment_id}?tab=consultation`}
              className="font-semibold underline"
            >
              Your consultation record from then
            </Link>
          </Alert>
        </div>
      )}

      {callDocs.length > 0 && (
        <section className="mt-6" aria-labelledby="call-docs-title">
          <h2 id="call-docs-title" className="mb-2 text-lg font-semibold text-ink">
            Shared in the video call ({callDocs.length})
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {callDocs.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setViewing({ document: s.document, urls: callFileUrls(appointmentId, s.id) })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-brand-700"
                >
                  <span className="block truncate font-semibold text-ink">{documentTitle(s.document)}</span>
                  <span className="block truncate text-sm text-slate-600">
                    {s.shared_by === "doctor" ? "Shared by you" : `Shared by ${s.shared_by_name ?? "the patient"}`} ·{" "}
                    {formatSize(s.document.files.reduce((n, f) => n + f.size_bytes, 0))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.closed && (
        <div className="mt-6 space-y-6">
          <Alert tone="info">{history.closed}</Alert>
          {/* The prescription doesn't depend on the patient sharing their history. */}
          <section aria-labelledby="rx-title">
            <h2 id="rx-title" className="mb-3 text-lg font-semibold text-ink">
              Prescription
            </h2>
            <PrescriptionEditor appointmentId={appointmentId} legacyFallback={null} />
          </section>
          {past && past.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-ink">Your consultation records with {patientName}</h2>
              <div className="grid gap-3">
                {past.map((p) =>
                  p.consultation ? (
                    <ConsultationCard
                      key={p.consultation.id}
                      consultation={p.consultation}
                      onOpenDocument={(d, fileId) =>
                        setViewing({ document: d, fileId, urls: ownPrescriptionUrls(p.consultation!.id) })
                      }
                    />
                  ) : null,
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {data && (
        <div className="mt-6 space-y-6">
          <p className="text-sm text-slate-600">
            Shared by the patient for this appointment, available until {formatDate(data.access_ends_on)}. Items they keep private
            aren&apos;t shown. Your views are recorded for the patient.
          </p>
          <QuickGlance history={data} />

          <div className="flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist">
            {(["timeline", "documents", "consultation"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-ink"}`}
              >
                {t === "timeline"
                  ? "History timeline"
                  : t === "documents"
                    ? `Documents (${data.documents.length})`
                    : "Prescription"}
              </button>
            ))}
          </div>

          {tab === "timeline" && <Timeline history={data} onOpenDocument={(d) => openDoc(d)} />}
          {tab === "documents" && (
            <DocumentGroups
              documents={data.documents}
              onOpen={openDoc}
              empty={<EmptyState title="The patient hasn't shared any documents" />}
            />
          )}
          {tab === "consultation" && (
            <PrescriptionEditor
              appointmentId={appointmentId}
              legacyFallback={
                // A record written before prescriptions existed keeps its own form.
                canWrite ? (
                  <ConsultationForm
                    appointmentId={appointmentId}
                    visitDate={appointment?.date ?? clinicToday()}
                    existing={own?.consultation ?? null}
                    onSaved={saved}
                  />
                ) : own?.consultation ? (
                  <ConsultationCard consultation={own.consultation} onOpenDocument={openDoc} />
                ) : (
                  <Card>
                    <p className="text-slate-600">You can write the consultation record once the appointment has started.</p>
                  </Card>
                )
              }
            />
          )}
        </div>
      )}

      {viewing && (
        <FileViewer
          document={viewing.document}
          startFileId={viewing.fileId}
          urls={viewing.urls}
          onClose={() => setViewing(null)}
        />
      )}
    </Container>
  );
}

function ByAppointment() {
  const { id } = useParams<{ id: string }>();
  // Keyed by the appointment, so following a link to another one starts afresh.
  return <PatientView key={id} appointmentId={Number(id)} />;
}

export default function DoctorPatientPage() {
  return (
    <RequireRole role="doctor">
      <Suspense fallback={<PageLoading />}>
        <ByAppointment />
      </Suspense>
    </RequireRole>
  );
}
