"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, messageOf } from "@/lib/api";
import { formatDate, formatTime } from "@/lib/format";
import { STATUS_LABELS, TYPE_LABELS, windowLabel } from "@/lib/follow-ups";
import type { FollowUp, FollowUpStatus } from "@/lib/types";

import { ConfirmDialog } from "./confirm-dialog";
import { FollowUpStatusBadge } from "./follow-ups-card";
import { Alert, Button, Card, EmptyState, Field, Select } from "./ui";

const FILTERS: ("" | FollowUpStatus)[] = ["", "recommended", "booked", "dismissed", "expired", "completed"];

/** The doctor's own follow-up recommendations: who hasn't come back yet. */
export function DoctorFollowUps({ liveTick }: { liveTick: number }) {
  const [list, setList] = useState<{ data?: FollowUp[]; error?: string } | null>(null);
  const [filter, setFilter] = useState<"" | FollowUpStatus>("");
  const [version, setVersion] = useState(0);
  const [removing, setRemoving] = useState<FollowUp | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<FollowUp[]>("/doctors/me/follow-ups")
      .then((data) => !cancelled && setList({ data }))
      .catch((e) => !cancelled && setList((prev) => (prev?.data ? prev : { error: messageOf(e) })));
    return () => {
      cancelled = true;
    };
  }, [version, liveTick]);

  if (!list) return <p className="text-slate-500">Loading follow-ups…</p>;
  if (list.error) return <Alert tone="error">{list.error}</Alert>;
  const all = list.data ?? [];
  const shown = filter ? all.filter((f) => f.status === filter) : all;
  const count = (s: FollowUpStatus) => all.filter((f) => f.status === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-slate-600">
          {count("recommended")} not booked yet · {count("booked")} booked · {count("dismissed")} declined for now ·{" "}
          {count("expired")} expired
        </p>
        <div className="w-full sm:w-56">
          <Field label="Show" htmlFor="fu-filter">
            <Select id="fu-filter" value={filter} onChange={(e) => setFilter(e.target.value as "" | FollowUpStatus)}>
              {FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s ? STATUS_LABELS[s] : "All follow-ups"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState title={all.length === 0 ? "No follow-ups recommended yet" : "None with this status"}>
          {all.length === 0 && "Recommend one in a consultation record and it appears here until the patient comes back."}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {shown.map((f) => (
            <Card key={f.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-semibold text-ink">
                      {f.patient_name ?? `Patient #${f.patient_id}`}
                    </span>
                    <FollowUpStatusBadge status={f.status} />
                  </p>
                  <p className="text-sm text-slate-700">
                    After the {formatDate(f.visit_date)} visit · around{" "}
                    <span className="font-semibold">{formatDate(f.target_date)}</span> ({windowLabel(f)})
                  </p>
                  <p className="break-words text-sm text-slate-600">
                    {f.reason} · {TYPE_LABELS[f.consultation_type]} · {f.fee_label}
                  </p>
                  {f.booked && (
                    <p className="text-sm font-medium text-brand-800">
                      Booked for{" "}
                      <Link href={`/doctor?appointment=${f.booked.id}&date=${f.booked.date}`} className="underline">
                        {formatDate(f.booked.date)} at {formatTime(f.booked.start_time)}
                      </Link>
                      {!f.booked.in_window && " (outside the window)"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/doctor/appointments/${f.appointment_id}?tab=consultation`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-slate-50"
                  >
                    Consultation record
                  </Link>
                  {f.can_edit && (
                    <Button variant="danger" size="sm" onClick={() => setRemoving(f)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove this follow-up recommendation?"
          confirmLabel="Remove follow-up"
          busyLabel="Removing…"
          tone="danger"
          onConfirm={async () => {
            await api(`/doctors/me/appointments/${removing.appointment_id}/consultation/follow-up`, { method: "DELETE" });
            setRemoving(null);
            setVersion((v) => v + 1);
          }}
          onClose={() => setRemoving(null)}
        >
          <p>
            It disappears from {removing.patient_name ?? "the patient"}&apos;s follow-ups, and they&apos;re told you removed it.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
