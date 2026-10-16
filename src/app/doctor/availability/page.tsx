"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { RequireRole } from "@/components/require-role";
import { Alert, Button, Card, Container, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { addDays, clinicToday, formatDate, formatTime, WEEKDAYS } from "@/lib/format";
import type { Availability } from "@/lib/types";

const DURATIONS = [10, 15, 20, 30, 45, 60];
const PUBLISH_RANGES = [
  { weeks: 2, label: "Next 2 weeks" },
  { weeks: 4, label: "Next 4 weeks" },
  { weeks: 8, label: "Next 8 weeks" },
];

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

function WeeklySchedule({ onChanged }: { onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const [items, setItems] = useState<{ data?: Availability[]; error?: string } | null>(null);
  const [form, setForm] = useState({ day_of_week: "0", start_time: "09:00", end_time: "13:00", slot_duration_minutes: "30" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let cancelled = false;
    api<Availability[]>("/doctors/me/availability")
      .then((data) => !cancelled && setItems({ data }))
      .catch((e) => !cancelled && setItems({ error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function add(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await api("/doctors/me/availability", {
        method: "POST",
        body: { ...form, day_of_week: Number(form.day_of_week), slot_duration_minutes: Number(form.slot_duration_minutes) },
      });
      setNotice({ tone: "success", text: `Added ${WEEKDAYS[Number(form.day_of_week)]} hours. Publish slots below so patients can book them.` });
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    setNotice(null);
    try {
      await api(`/doctors/me/availability/${id}`, { method: "DELETE" });
      setVersion((v) => v + 1);
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
    }
  }

  const sorted = [...(items?.data ?? [])].sort(
    (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
  );

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">1. Weekly working hours</h2>
      <p className="mt-1 text-sm text-slate-600">The hours you consult each week. They repeat every week.</p>

      <div className="mt-4">
        {!items && <p className="text-slate-500">Loading…</p>}
        {items?.error && <Alert tone="error">{items.error}</Alert>}
        {items?.data && sorted.length === 0 && <EmptyState title="No working hours yet">Add your first block below.</EmptyState>}
        {sorted.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {sorted.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-ink">{WEEKDAYS[a.day_of_week]}</p>
                  <p className="text-sm text-slate-600">
                    {formatTime(a.start_time)} – {formatTime(a.end_time)} · {a.slot_duration_minutes}-minute appointments
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => remove(a.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={add} className="mt-6 grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-5 sm:items-end">
        <Field label="Day" htmlFor="day">
          <Select id="day" value={form.day_of_week} onChange={set("day_of_week")}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="start">
          <Input id="start" type="time" required value={form.start_time} onChange={set("start_time")} />
        </Field>
        <Field label="To" htmlFor="end">
          <Input id="end" type="time" required value={form.end_time} onChange={set("end_time")} />
        </Field>
        <Field label="Each appointment" htmlFor="duration">
          <Select id="duration" value={form.slot_duration_minutes} onChange={set("slot_duration_minutes")}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add hours"}
        </Button>
      </form>
      {notice && (
        <div className="mt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
    </Card>
  );
}

function PublishSlots({ highlight }: { highlight: boolean }) {
  const [publishing, setPublishing] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function publish(weeks: number) {
    setPublishing(weeks);
    setNotice(null);
    const from = clinicToday();
    const to = addDays(from, weeks * 7 - 1);
    try {
      const { created } = await api<{ created: number }>("/doctors/me/slots/generate", {
        method: "POST",
        body: { from_date: from, to_date: to },
      });
      setNotice(
        created > 0
          ? { tone: "success", text: `Published ${created} new bookable time${created === 1 ? "" : "s"} from ${formatDate(from)} to ${formatDate(to)}.` }
          : { tone: "info", text: "Nothing new to publish — this period is already published (or you have no working hours on those days)." },
      );
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
    } finally {
      setPublishing(null);
    }
  }

  return (
    <Card className={highlight ? "ring-2 ring-brand-600" : ""}>
      <h2 className="text-lg font-semibold text-ink">2. Publish bookable times</h2>
      <p className="mt-1 text-sm text-slate-600">
        Patients can only book times you publish. Publishing again is safe — existing times are never duplicated. Re-publish
        after changing your hours.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {PUBLISH_RANGES.map((r) => (
          <Button key={r.weeks} variant={r.weeks === 2 ? "primary" : "secondary"} onClick={() => publish(r.weeks)} disabled={publishing !== null}>
            {publishing === r.weeks ? "Publishing…" : r.label}
          </Button>
        ))}
      </div>
      {notice && (
        <div className="mt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
    </Card>
  );
}

function BlockDate() {
  const [form, setForm] = useState({ date: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await api("/doctors/me/blocked-dates", { method: "POST", body: { date: form.date, reason: form.reason.trim() || null } });
      setNotice({ tone: "success", text: `${formatDate(form.date)} is blocked. No times will be published for it.` });
      setForm({ date: "", reason: "" });
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Days off</h2>
      <p className="mt-1 text-sm text-slate-600">
        Block a date (holiday, conference) before publishing that period. Times already published for that date stay
        bookable.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <Field label="Date" htmlFor="block-date">
          <Input id="block-date" type="date" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </Field>
        <Field label="Reason (optional)" htmlFor="block-reason">
          <Input
            id="block-reason"
            maxLength={255}
            placeholder="e.g. Public holiday"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? "Blocking…" : "Block date"}
        </Button>
      </form>
      {notice && (
        <div className="mt-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
    </Card>
  );
}

function AvailabilityPage() {
  const [hoursAdded, setHoursAdded] = useState(false);
  return (
    <Container className="max-w-4xl py-10">
      <PageHeader title="Availability" subtitle="Set your weekly hours, then publish them as bookable times." />
      <div className="mt-6 space-y-6">
        <WeeklySchedule onChanged={() => setHoursAdded(true)} />
        <PublishSlots highlight={hoursAdded} />
        <BlockDate />
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
