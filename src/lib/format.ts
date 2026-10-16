// Slot dates/times from the backend are naive clinic wall-clock values ("2026-10-15",
// "09:30:00"). They are formatted as-is — never shifted through the browser's timezone.

export const CLINIC_TIMEZONE = process.env.NEXT_PUBLIC_CLINIC_TIMEZONE ?? "Asia/Karachi";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function utcDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(isoDate: string): string {
  return utcDate(isoDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDayShort(isoDate: string): { weekday: string; day: string } {
  const d = utcDate(isoDate);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  };
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function formatFee(fee: string | null): string | null {
  if (fee === null) return null;
  return `Rs. ${Number(fee).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = utcDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The clinic's current date and time as comparable strings ("2026-10-14", "13:05:00"). */
export function clinicNow(nowMs: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

export function clinicToday(): string {
  return clinicNow(Date.now()).date;
}

export function hasStarted(slot: { date: string; start_time: string }, nowMs: number): boolean {
  const now = clinicNow(nowMs);
  return `${slot.date}T${slot.start_time}` <= `${now.date}T${now.time}`;
}

export function initials(name: string | null): string {
  if (!name) return "?";
  const words = name.replace(/^dr\.?\s+/i, "").trim().split(/\s+/);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}
