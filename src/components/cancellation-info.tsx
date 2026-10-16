import type { Appointment, Role } from "@/lib/types";

/** Explains a cancelled appointment from the viewer's point of view. */
export function CancellationInfo({ appointment, viewer }: { appointment: Appointment; viewer: Role }) {
  if (appointment.status !== "cancelled") return null;
  const { cancelled_by, cancellation_reason, cancellation_note } = appointment;

  let headline: string;
  if (cancelled_by === viewer) headline = "You cancelled this appointment.";
  else if (cancelled_by === "doctor") headline = "The doctor cancelled this appointment.";
  else if (cancelled_by === "patient") headline = "The patient cancelled this appointment.";
  else headline = "This appointment was cancelled.";

  const reason =
    cancellation_reason === "busy"
      ? "Reason: the doctor is unavailable at this time."
      : cancellation_reason === "other"
        ? "Reason: other"
        : null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <p className="font-medium">{headline}</p>
      {reason && <p>{reason}</p>}
      {cancellation_note && (
        <p className="mt-1 break-words">
          <span className="font-medium">{viewer === "patient" ? "Doctor's note: " : "Your note: "}</span>
          {cancellation_note}
        </p>
      )}
    </div>
  );
}
