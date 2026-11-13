"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { RxSummary } from "@/components/prescription/issued-view";
import { PdfViewer } from "@/components/prescription/pdf-viewer";
import { RequireRole } from "@/components/require-role";
import { Alert, Button, Card, Container, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import type { Prescription, PrescriptionSummary } from "@/lib/types";

function PrescriptionCard({ rx, onView }: { rx: PrescriptionSummary; onView: () => void }) {
  const [details, setDetails] = useState<Prescription | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setOpen((o) => !o);
    if (!details) {
      try {
        setDetails(await api<Prescription>(`/prescriptions/${rx.id}`));
      } catch (e) {
        setError(messageOf(e));
      }
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{rx.doctor_name ?? "Your doctor"}</p>
          <p className="text-sm text-slate-600">
            {[rx.doctor_specialty, `Visit ${formatDate(rx.visit_date)}`].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {rx.diagnoses.join(", ")}
            {rx.diagnoses.length > 0 && " · "}
            {rx.medicine_count} medicine{rx.medicine_count === 1 ? "" : "s"}
            {rx.test_count > 0 && ` · ${rx.test_count} test${rx.test_count === 1 ? "" : "s"}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rx.number}
            {rx.is_correction && " · corrected version"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button onClick={onView}>View / download PDF</Button>
          <Button variant="secondary" onClick={() => void toggle()} aria-expanded={open}>
            {open ? "Hide details" : "Details"}
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          {error ? <Alert tone="error">{error}</Alert> : details ? <RxSummary content={details.content} /> : <p className="text-sm text-slate-500">Loading…</p>}
        </div>
      )}
    </Card>
  );
}

function Prescriptions() {
  // ?appointment=<id>: opened from a notification or an appointment — show that one's PDF.
  const wanted = Number(useSearchParams().get("appointment")) || null;
  const [list, setList] = useState<PrescriptionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PrescriptionSummary | null>(null);
  const [openedWanted, setOpenedWanted] = useState(false);
  const liveTick = useLiveRefresh(120_000);

  useEffect(() => {
    let cancelled = false;
    api<PrescriptionSummary[]>("/prescriptions/mine")
      .then((data) => {
        if (cancelled) return;
        setList(data);
        setError(null);
      })
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  const target = wanted && list && !openedWanted ? list.find((r) => r.appointment_id === wanted) : undefined;
  useEffect(() => {
    if (target) {
      // Opening the prescription the link pointed to, once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewing(target);
      setOpenedWanted(true);
    }
  }, [target]);

  if (error && !list) {
    return (
      <Container className="py-16">
        <Alert tone="error">{error}</Alert>
      </Container>
    );
  }
  if (!list) return <PageLoading />;

  return (
    <Container className="py-10">
      <PageHeader
        title="Prescriptions"
        subtitle="Prescriptions your doctors have issued. Show them at a pharmacy or lab — on your phone or printed."
      />
      <div className="mt-6 space-y-3">
        {wanted && list.length > 0 && !list.some((r) => r.appointment_id === wanted) && (
          <Alert tone="info">That appointment has no current prescription (it may have been cancelled).</Alert>
        )}
        {list.length === 0 ? (
          <EmptyState title="No prescriptions yet">
            When a doctor issues a prescription after your consultation, it appears here and in your{" "}
            <Link href="/patient/history" className="font-semibold text-brand-700 hover:underline">
              health record
            </Link>
            .
          </EmptyState>
        ) : (
          list.map((rx) => <PrescriptionCard key={rx.id} rx={rx} onView={() => setViewing(rx)} />)
        )}
      </div>
      {viewing && (
        <PdfViewer
          prescriptionId={viewing.id}
          number={viewing.number}
          title={`Prescription from ${viewing.doctor_name ?? "your doctor"} · ${formatDate(viewing.visit_date)}`}
          onClose={() => setViewing(null)}
        />
      )}
    </Container>
  );
}

export default function PatientPrescriptionsPage() {
  return (
    <RequireRole role="patient">
      <Suspense fallback={<PageLoading />}>
        <Prescriptions />
      </Suspense>
    </RequireRole>
  );
}
