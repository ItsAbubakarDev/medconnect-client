import type { AppointmentStatus } from "@/lib/types";

const styles: Record<AppointmentStatus, { label: string; className: string }> = {
  pending: { label: "Awaiting confirmation", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  confirmed: { label: "Confirmed", className: "bg-brand-50 text-brand-800 ring-brand-200" },
  completed: { label: "Completed", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { label, className } = styles[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${className}`}>{label}</span>;
}
