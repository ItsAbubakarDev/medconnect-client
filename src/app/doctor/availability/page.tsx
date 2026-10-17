"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { RequireRole } from "@/components/require-role";
import { Alert, Button, Card, Container, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { addDays, clinicToday, formatDate, formatDayShort, formatTime, WEEKDAYS } from "@/lib/format";
import type { DayOff, DaysOffResult, MySlot, Schedule, ScheduleChanges, ScheduleSaveResult } from "@/lib/types";
import { useLiveRefresh } from "@/lib/use-live-refresh";

const DURATIONS = [10, 15, 20, 30, 45, 60];
const WINDOWS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 21, label: "3 weeks" },
  { days: 28, label: "4 weeks" },
  { days: 42, label: "6 weeks" },
  { days: 56, label: "8 weeks" },
  { days: 84, label: "12 weeks" },
];
const CALENDAR_DAYS = 14;
const DEFAULT_SESSION = { start: "09:00", end: "17:00" };

type Session = { start: string; end: string };
type Day = { on: boolean; sessions: Session[] };
type Notice = {
  tone: "success" | "error" | "info" | "warning";
  text: string;
} | null;

const hhmm = (t: string) => t.slice(0, 5);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const windowLabel = (days: number) => WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`;

/* ------------------------------------------------------------------------------------------ */
/* Shared: what a change did                                                                   */

function ChangesSummary({ changes, intro }: { changes: ScheduleChanges; intro: string }) {
  const { opened, closed, booked_outside_hours: kept } = changes;
  const parts = [];
  if (opened) parts.push(`${opened} new time${opened === 1 ? "" : "s"} opened`);
  if (closed) parts.push(`${closed} free time${closed === 1 ? "" : "s"} closed`);
  return (
    <div className="space-y-3">
      <Alert tone="success">
        {intro} {parts.length ? `${parts.join(", ")}.` : "Your bookable times already matched."}
      </Alert>
      {kept.length > 0 && (
        <Alert tone="warning">
          <p className="font-semibold">
            {kept.length === 1 ? "1 booked appointment is" : `${kept.length} booked appointments are`} now outside your hours.
            They are kept. Contact the patient, or cancel from your{" "}
            <Link href="/doctor" className="underline">
              dashboard
            </Link>
            .
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {kept.map((b) => (
              <li key={b.appointment_id}>
                {formatDate(b.date)}, {formatTime(b.start_time)} — {b.patient_name ?? "Patient"}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* 1. Weekly hours: the whole week on one screen, saved at once                               */

function toDays(schedule: Schedule): Day[] {
  const days: Day[] = WEEKDAYS.map(() => ({ on: false, sessions: [] }));
  for (const s of [...schedule.sessions].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    days[s.day_of_week].on = true;
    days[s.day_of_week].sessions.push({
      start: hhmm(s.start_time),
      end: hhmm(s.end_time),
    });
  }
  for (const d of days) if (d.sessions.length === 0) d.sessions = [{ ...DEFAULT_SESSION }];
  return days;
}

/** The same rules the API enforces, checked as you type so mistakes show before saving. */
function problemsOf(days: Day[], duration: number): string | null {
  for (const [i, day] of days.entries()) {
    if (!day.on) continue;
    const sorted = [...day.sessions].sort((a, b) => a.start.localeCompare(b.start));
    for (const s of sorted) {
      if (!s.start || !s.end) return `${WEEKDAYS[i]}: fill in both times.`;
      if (minutes(s.end) <= minutes(s.start)) return `${WEEKDAYS[i]}: the end time must be after the start time.`;
      if (minutes(s.end) - minutes(s.start) < duration)
        return `${WEEKDAYS[i]}: ${formatTime(s.start)}–${formatTime(s.end)} is shorter than one ${duration}-minute appointment.`;
    }
    for (let k = 1; k < sorted.length; k++) {
      if (minutes(sorted[k].start) < minutes(sorted[k - 1].end))
        return `${WEEKDAYS[i]}: ${formatTime(sorted[k - 1].start)}–${formatTime(sorted[k - 1].end)} overlaps ${formatTime(sorted[k].start)}–${formatTime(sorted[k].end)}.`;
    }
  }
  return null;
}

function WeeklyHours({ onSaved }: { onSaved: () => void }) {
  const [loaded, setLoaded] = useState<{
    schedule?: Schedule;
    error?: string;
  } | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [duration, setDuration] = useState(30);
  const [windowDays, setWindowDays] = useState(28);
  const [savedKey, setSavedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    changes?: ScheduleChanges;
    error?: string;
    until?: string;
  } | null>(null);

  const stateKey = JSON.stringify({
    days: days.map((d) => (d.on ? d.sessions : null)),
    duration,
    windowDays,
  });

  function adopt(schedule: Schedule) {
    const nextDays = toDays(schedule);
    const nextDuration = schedule.slot_duration_minutes ?? 30;
    setDays(nextDays);
    setDuration(nextDuration);
    setWindowDays(schedule.booking_window_days);
    setSavedKey(
      JSON.stringify({
        days: nextDays.map((d) => (d.on ? d.sessions : null)),
        duration: nextDuration,
        windowDays: schedule.booking_window_days,
      }),
    );
    setLoaded({ schedule });
  }

  useEffect(() => {
    let cancelled = false;
    api<Schedule>("/doctors/me/schedule")
      .then((s) => !cancelled && adopt(s))
      .catch((e) => !cancelled && setLoaded({ error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const updateDay = (i: number, change: (d: Day) => Day) => {
    setResult(null);
    setDays((all) => all.map((d, k) => (k === i ? change(d) : d)));
  };
  const copyMonday = (targets: number[]) => {
    setResult(null);
    setDays((all) =>
      all.map((d, k) => (targets.includes(k) ? { on: all[0].on, sessions: all[0].sessions.map((s) => ({ ...s })) } : d)),
    );
  };

  const problem = problemsOf(days, duration);
  const dirty = loaded?.schedule !== undefined && stateKey !== savedKey;
  const openDays = days.filter((d) => d.on).length;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    setResult(null);
    try {
      const sessions = days.flatMap((d, i) =>
        d.on
          ? d.sessions.map((s) => ({
              day_of_week: i,
              start_time: `${s.start}:00`,
              end_time: `${s.end}:00`,
            }))
          : [],
      );
      const res = await api<ScheduleSaveResult>("/doctors/me/schedule", {
        method: "PUT",
        body: {
          slot_duration_minutes: duration,
          booking_window_days: windowDays,
          sessions,
        },
      });
      adopt(res.schedule);
      setResult({ changes: res.changes, until: res.schedule.bookable_until });
      onSaved();
    } catch (err) {
      setResult({ error: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <Card>Loading your hours…</Card>;
  if (loaded.error) return <Alert tone="error">{loaded.error}</Alert>;

  return (
    <Card>
      <form onSubmit={save}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Weekly hours</h2>
            <p className="mt-1 text-sm text-slate-600">
              Set your week once. Patients can book these hours automatically, always {windowLabel(windowDays)} ahead — no extra
              steps.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Each appointment" htmlFor="duration">
              <Select
                id="duration"
                value={duration}
                onChange={(e) => {
                  setResult(null);
                  setDuration(Number(e.target.value));
                }}
              >
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Patients can book" htmlFor="window">
              <Select
                id="window"
                value={windowDays}
                onChange={(e) => {
                  setResult(null);
                  setWindowDays(Number(e.target.value));
                }}
              >
                {!WINDOWS.some((w) => w.days === windowDays) && <option value={windowDays}>{windowDays} days ahead</option>}
                {WINDOWS.map((w) => (
                  <option key={w.days} value={w.days}>
                    {w.label} ahead
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <ul className="mt-5 divide-y divide-slate-200 rounded-lg border border-slate-200">
          {days.map((day, i) => (
            <li key={WEEKDAYS[i]} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
              <label className="flex w-36 shrink-0 items-center gap-3 pt-2 font-semibold text-ink">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand-700"
                  checked={day.on}
                  onChange={(e) => updateDay(i, (d) => ({ ...d, on: e.target.checked }))}
                />
                {WEEKDAYS[i]}
              </label>
              {day.on ? (
                <div className="flex flex-1 flex-col gap-2">
                  {day.sessions.map((s, k) => (
                    <div key={k} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="w-[7.75rem] sm:w-36">
                        <Input
                          type="time"
                          step={300}
                          aria-label={`${WEEKDAYS[i]} session ${k + 1} start`}
                          value={s.start}
                          onChange={(e) =>
                            updateDay(i, (d) => ({
                              ...d,
                              sessions: d.sessions.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)),
                            }))
                          }
                        />
                      </div>
                      <span className="text-slate-500">to</span>
                      <div className="w-[7.75rem] sm:w-36">
                        <Input
                          type="time"
                          step={300}
                          aria-label={`${WEEKDAYS[i]} session ${k + 1} end`}
                          value={s.end}
                          onChange={(e) =>
                            updateDay(i, (d) => ({
                              ...d,
                              sessions: d.sessions.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)),
                            }))
                          }
                        />
                      </div>
                      {day.sessions.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${WEEKDAYS[i]} session ${k + 1}`}
                          onClick={() =>
                            updateDay(i, (d) => ({
                              ...d,
                              sessions: d.sessions.filter((_, j) => j !== k),
                            }))
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateDay(i, (d) => {
                          const last = d.sessions[d.sessions.length - 1];
                          const start = last ? Math.min(minutes(last.end) + 60, 22 * 60) : 18 * 60;
                          const t = (m: number) =>
                            `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                          return {
                            ...d,
                            sessions: [
                              ...d.sessions,
                              {
                                start: t(start),
                                end: t(Math.min(start + 180, 23 * 60 + 55)),
                              },
                            ],
                          };
                        })
                      }
                    >
                      + Add another session
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="pt-2 text-slate-500">Closed</p>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Copy Monday to:</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => copyMonday([1, 2, 3, 4])}>
            Tue–Fri
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => copyMonday([1, 2, 3, 4, 5])}>
            Tue–Sat
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => copyMonday([1, 2, 3, 4, 5, 6])}>
            Every day
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
          <Button type="submit" disabled={!dirty || saving || problem !== null}>
            {saving ? "Saving…" : "Save hours"}
          </Button>
          {dirty && !problem && <span className="text-sm text-amber-700">You have unsaved changes.</span>}
          {!dirty && openDays === 0 && <span className="text-sm text-slate-600">Tick the days you work to get started.</span>}
        </div>
        {problem && dirty && (
          <div className="mt-4">
            <Alert tone="error">{problem}</Alert>
          </div>
        )}
        {result?.error && (
          <div className="mt-4">
            <Alert tone="error">{result.error}</Alert>
          </div>
        )}
        {result?.changes && (
          <div className="mt-4">
            <ChangesSummary
              changes={result.changes}
              intro={`Saved. Patients can book until ${result.until ? formatDate(result.until) : "the end of your window"}.`}
            />
          </div>
        )}
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* 2. Your times: the next two weeks, one tap to close or reopen a time                       */

function MyTimes({ version, onChanged }: { version: number; onChanged: () => void }) {
  const liveTick = useLiveRefresh(15_000); // new bookings show up while the page is open
  const [data, setData] = useState<{
    slots: MySlot[];
    daysOff: DayOff[];
    schedule?: Schedule;
    error?: string;
  } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [changes, setChanges] = useState<ScheduleChanges | null>(null);

  useEffect(() => {
    let cancelled = false;
    const from = clinicToday();
    const to = addDays(from, CALENDAR_DAYS - 1);
    Promise.all([
      api<MySlot[]>(`/doctors/me/slots?from=${from}&to=${to}`),
      api<DayOff[]>("/doctors/me/days-off"),
      api<Schedule>("/doctors/me/schedule"),
    ])
      .then(([slots, daysOff, schedule]) => !cancelled && setData({ slots, daysOff, schedule }))
      .catch((e) => !cancelled && setData((prev) => prev ?? { slots: [], daysOff: [], error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [version, liveTick]);

  const dates = useMemo(() => {
    const today = clinicToday();
    return Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(today, i));
    // Re-derived with the data so the strip moves on after midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const byDate = useMemo(() => {
    const m = new Map<string, MySlot[]>();
    for (const s of data?.slots ?? []) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [data]);
  const offByDate = useMemo(() => new Map((data?.daysOff ?? []).map((d) => [d.date, d])), [data]);

  if (!data) return <Card>Loading your times…</Card>;
  const active = day && dates.includes(day) ? day : dates[0];
  const slots = byDate.get(active) ?? [];
  const off = offByDate.get(active);

  async function act(key: number | string, run: () => Promise<void>) {
    setBusy(key);
    setNotice(null);
    setChanges(null);
    try {
      await run();
      onChanged();
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
      onChanged(); // the time may have just been booked — show the current state
    } finally {
      setBusy(null);
    }
  }

  const toggle = (s: MySlot) =>
    act(s.id, async () => {
      await api(`/doctors/me/slots/${s.id}/${s.state === "open" ? "close" : "reopen"}`, { method: "PATCH" });
    });
  const takeDayOff = () =>
    act("day", async () => {
      const res = await api<DaysOffResult>("/doctors/me/days-off", {
        method: "POST",
        body: { from_date: active },
      });
      setChanges(res.changes);
    });
  const workDay = (d: DayOff) =>
    act("day", async () => {
      setChanges(
        await api<ScheduleChanges>(`/doctors/me/days-off/${d.id}`, {
          method: "DELETE",
        }),
      );
    });

  const counts = (date: string) => {
    const list = byDate.get(date) ?? [];
    return {
      open: list.filter((s) => s.state === "open" && !s.started).length,
      booked: list.filter((s) => s.state === "booked").length,
    };
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Your times — next 2 weeks</h2>
      <p className="mt-1 text-sm text-slate-600">
        Tap a free time to close it (running late, a meeting). Tap a closed time to open it again.
      </p>
      {data.error && (
        <div className="mt-4">
          <Alert tone="error">{data.error}</Alert>
        </div>
      )}

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Day">
        {dates.map((date) => {
          const { weekday, day: dayLabel } = formatDayShort(date);
          const c = counts(date);
          const isOff = offByDate.has(date);
          const selected = date === active;
          return (
            <button
              key={date}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setDay(date);
                setNotice(null);
                setChanges(null);
              }}
              className={`w-20 shrink-0 rounded-lg border px-2 py-2 text-center text-sm ${selected ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-ink hover:bg-slate-50"}`}
            >
              <span className="block font-semibold">{weekday}</span>
              <span className="block">{dayLabel}</span>
              <span className={`mt-1 block text-xs ${selected ? "text-brand-100" : "text-slate-500"}`}>
                {isOff ? "Day off" : c.booked ? `${c.booked} booked` : c.open ? `${c.open} free` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {off ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-ink">
              <span className="font-semibold">Day off</span>
              {off.reason ? ` — ${off.reason}` : ""}. Patients can&apos;t book {formatDate(active)}.
            </p>
            <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => workDay(off)}>
              {busy === "day" ? "Opening…" : "Work this day after all"}
            </Button>
          </div>
        ) : slots.length === 0 ? (
          <p className="text-slate-600">{emptyDayMessage(active, data.schedule)}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {slots.map((s) => {
                const label = formatTime(s.start_time);
                if (s.state === "booked") {
                  return (
                    <div key={s.id} className="rounded-lg border border-brand-700 bg-brand-700 px-2 py-2 text-sm text-white">
                      <span className="block font-semibold">{label}</span>
                      <span className="block truncate text-xs text-brand-100">{s.appointment?.patient_name ?? "Booked"}</span>
                    </div>
                  );
                }
                const closed = s.state === "closed";
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.started || busy !== null}
                    aria-label={`${label} ${closed ? "closed, tap to open" : "free, tap to close"}`}
                    onClick={() => toggle(s)}
                    className={`rounded-lg border px-2 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${closed ? "border-slate-200 bg-slate-100 text-slate-500" : "border-slate-300 bg-white text-ink hover:border-brand-700"}`}
                  >
                    <span className={`block font-semibold ${closed ? "line-through" : ""}`}>{label}</span>
                    <span className="block text-xs">
                      {busy === s.id ? "Saving…" : s.started ? "Passed" : closed ? "Closed" : "Free"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">Booked times are in teal. To change one, use the dashboard.</p>
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={takeDayOff}>
                {busy === "day" ? "Closing…" : "Take this day off"}
              </Button>
            </div>
          </>
        )}
      </div>

      {notice && (
        <div className="mt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      {changes && (
        <div className="mt-4">
          <ChangesSummary changes={changes} intro="Done." />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* 3. Days off: a day or a whole holiday at once                                              */

/** Why a day in the calendar has no times — so the doctor knows whether to act. */
function emptyDayMessage(date: string, schedule?: Schedule): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const works = schedule?.sessions.some((s) => s.day_of_week === weekday);
  if (!works) return `No working hours on ${WEEKDAYS[weekday]}s. Tick the day in Weekly hours above.`;
  if (date === clinicToday()) return "Today's hours have passed.";
  if (schedule && date > schedule.bookable_until)
    return `Patients can book up to ${formatDate(schedule.bookable_until)}. To open later days, choose a longer "Patients can book" above.`;
  return "No times on this day.";
}

type Range = { from: string; to: string; reason: string | null; ids: number[] };

function toRanges(days: DayOff[]): Range[] {
  const ranges: Range[] = [];
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = ranges[ranges.length - 1];
    if (last && addDays(last.to, 1) === d.date && last.reason === d.reason) {
      last.to = d.date;
      last.ids.push(d.id);
    } else {
      ranges.push({ from: d.date, to: d.date, reason: d.reason, ids: [d.id] });
    }
  }
  return ranges;
}

function DaysOff({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [days, setDays] = useState<DayOff[] | null>(null);
  const [form, setForm] = useState({ from: "", to: "", reason: "" });
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ScheduleChanges | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DayOff[]>("/doctors/me/days-off")
      .then((d) => !cancelled && setDays(d))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setSaving("add");
    setError(null);
    setChanges(null);
    try {
      const res = await api<DaysOffResult>("/doctors/me/days-off", {
        method: "POST",
        body: {
          from_date: form.from,
          to_date: form.to || null,
          reason: form.reason.trim() || null,
        },
      });
      setChanges(res.changes);
      setForm({ from: "", to: "", reason: "" });
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(null);
    }
  }

  async function remove(range: Range) {
    setSaving(range.from);
    setError(null);
    setChanges(null);
    try {
      let total: ScheduleChanges = {
        opened: 0,
        closed: 0,
        booked_outside_hours: [],
      };
      for (const id of range.ids) {
        const c = await api<ScheduleChanges>(`/doctors/me/days-off/${id}`, {
          method: "DELETE",
        });
        total = {
          opened: total.opened + c.opened,
          closed: total.closed + c.closed,
          booked_outside_hours: [...total.booked_outside_hours, ...c.booked_outside_hours],
        };
      }
      setChanges(total);
      onChanged();
    } catch (err) {
      setError(messageOf(err));
      onChanged();
    } finally {
      setSaving(null);
    }
  }

  const today = clinicToday();
  const ranges = toRanges(days ?? []);

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Days off</h2>
      <p className="mt-1 text-sm text-slate-600">
        A holiday, a conference, a week away. Free times on those days close straight away. Booked appointments are kept, and
        you&apos;ll be told about them.
      </p>
      <form onSubmit={add} className="mt-4 grid gap-4 sm:grid-cols-[170px_170px_1fr_auto] sm:items-end">
        <Field label="From" htmlFor="off-from">
          <Input
            id="off-from"
            type="date"
            required
            min={today}
            value={form.from}
            onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
          />
        </Field>
        <Field label="To (optional)" htmlFor="off-to">
          <Input
            id="off-to"
            type="date"
            min={form.from || today}
            value={form.to}
            onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
          />
        </Field>
        <Field label="Reason (optional)" htmlFor="off-reason">
          <Input
            id="off-reason"
            maxLength={255}
            placeholder="e.g. Eid holidays"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={saving !== null}>
          {saving === "add" ? "Adding…" : "Add days off"}
        </Button>
      </form>

      {days && ranges.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-200 rounded-lg border border-slate-200">
          {ranges.map((r) => (
            <li key={r.from} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold text-ink">
                  {r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`}
                </p>
                {r.reason && <p className="text-sm text-slate-600">{r.reason}</p>}
              </div>
              <Button variant="danger" size="sm" disabled={saving !== null} onClick={() => remove(r)}>
                {saving === r.from ? "Removing…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {days && ranges.length === 0 && <p className="mt-4 text-sm text-slate-500">No days off coming up.</p>}

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {changes && (
        <div className="mt-4">
          <ChangesSummary changes={changes} intro="Done." />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------ */

function AvailabilityPage() {
  // Any change in one section refreshes the others (hours -> calendar, day off -> calendar...).
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  return (
    <Container className="max-w-5xl py-10">
      <PageHeader title="Availability" subtitle="Set your week once. Bookable times look after themselves." />
      <div className="mt-6 space-y-6">
        <WeeklyHours onSaved={changed} />
        <MyTimes version={version} onChanged={changed} />
        <DaysOff version={version} onChanged={changed} />
      </div>
    </Container>
  );
}

export default function Page() {
  return (
    <RequireRole role="doctor">
      <AvailabilityPage />
    </RequireRole>
  );
}
