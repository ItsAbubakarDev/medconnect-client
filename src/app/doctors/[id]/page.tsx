"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ShareChooser } from "@/components/health/share-chooser";
import { Alert, Avatar, Button, ButtonLink, Card, Container, Field, PageLoading, Textarea } from "@/components/ui";
import { ApiError, api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { addDays, clinicToday, formatDate, formatDayShort, formatFee, formatTime, initials } from "@/lib/format";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import type { Appointment, DoctorPublic, MedicalHistory, ShareItemType, Slot } from "@/lib/types";

const DAYS_SHOWN = 14;

function DoctorProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status, session, displayName, profileLoaded } = useAuth();

  const [doctor, setDoctor] = useState<{ id: string; data?: DoctorPublic; error?: string } | null>(null);
  const [slots, setSlots] = useState<{ id: string; data: Slot[] } | null>(null);
  const [slotsVersion, setSlotsVersion] = useState(0);
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  // The sharing step: the patient's history (loaded when they review the booking) and what
  // they unticked for this doctor.
  const [myHistory, setMyHistory] = useState<MedicalHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [bookError, setBookError] = useState<string | null>(null);
  // Refetch open times every 15s (and on returning to the tab), so times other patients
  // book disappear without a reload.
  const liveTick = useLiveRefresh(15_000);

  useEffect(() => {
    let cancelled = false;
    api<DoctorPublic>(`/doctors/${id}`, { auth: false })
      .then((data) => !cancelled && setDoctor({ id, data }))
      .catch((e) =>
        !cancelled && setDoctor({ id, error: e instanceof ApiError && e.status === 404 ? "This doctor could not be found." : messageOf(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const from = clinicToday();
    const to = addDays(from, DAYS_SHOWN - 1);
    api<Slot[]>(`/doctors/${id}/available-slots?from=${from}&to=${to}`, { auth: false })
      .then((data) => !cancelled && setSlots({ id, data }))
      // A failed background refresh keeps the times already on screen.
      .catch(() => !cancelled && setSlots((prev) => (prev?.id === id ? prev : { id, data: [] })));
    return () => {
      cancelled = true;
    };
  }, [id, slotsVersion, liveTick]);

  const currentDoctor = doctor?.id === id ? doctor : null;
  const currentSlots = slots?.id === id ? slots.data : null;

  const slotsByDate = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of currentSlots ?? []) {
      grouped.set(slot.date, [...(grouped.get(slot.date) ?? []), slot]);
    }
    return grouped;
  }, [currentSlots]);

  // The chosen time counts only while it's still open: if a refresh shows someone else
  // booked it, the selection is dropped and the patient is told.
  const selectedSlot = chosenSlot !== null && currentSlots?.some((s) => s.id === chosenSlot) ? chosenSlot : null;
  const selectionTaken = chosenSlot !== null && currentSlots !== null && selectedSlot === null;

  const dates = [...slotsByDate.keys()];
  const activeDate = chosenDate && slotsByDate.has(chosenDate) ? chosenDate : (dates[0] ?? null);

  if (!currentDoctor) return <PageLoading />;
  if (currentDoctor.error || !currentDoctor.data) {
    return (
      <Container className="py-16">
        <Alert tone="error">{currentDoctor.error}</Alert>
        <ButtonLink href="/doctors" variant="secondary" className="mt-6">
          Back to doctors
        </ButtonLink>
      </Container>
    );
  }

  const d = currentDoctor.data;
  const fee = formatFee(d.consultation_fee);
  const isPatient = session?.role === "patient";
  const needsName = isPatient && profileLoaded && !displayName;

  const slotToBook = selectedSlot !== null ? currentSlots?.find((s) => s.id === selectedSlot) : undefined;

  // The button only opens the summary; nothing is booked until it's confirmed there.
  function review(e: FormEvent) {
    e.preventDefault();
    if (selectedSlot === null) return;
    setBookError(null);
    setConfirming(true);
    if (!myHistory) {
      api<MedicalHistory>("/patients/me/history")
        .then(setMyHistory)
        .catch((err) => setHistoryError(messageOf(err)));
    }
  }

  async function book() {
    if (!slotToBook) return;
    try {
      const share_exclusions = [...excluded].map((key) => {
        const [type, id] = key.split(":");
        return { type: type as ShareItemType, id: Number(id) };
      });
      const appt = await api<Appointment>("/appointments", {
        method: "POST",
        body: { slot_id: slotToBook.id, notes: notes.trim() || null, share_exclusions },
      });
      router.push(`/patient?booked=${appt.id}`);
    } catch (err) {
      setConfirming(false);
      setBookError(messageOf(err));
      setChosenSlot(null);
      setSlotsVersion((v) => v + 1); // the slot may have just been taken — refresh the list
    }
  }

  return (
    <Container className="py-10">
      <Link href="/doctors" className="text-sm font-medium text-brand-700 hover:underline">
        ← All doctors
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="h-fit">
          <div className="flex flex-col gap-5 sm:flex-row">
            <Avatar text={initials(d.full_name)} size="lg" />
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold text-ink">{d.full_name ?? "Doctor (profile incomplete)"}</h1>
              {d.specialty && <p className="text-lg font-medium text-brand-700">{d.specialty}</p>}
              {d.qualifications && <p className="text-slate-600">{d.qualifications}</p>}
            </div>
          </div>
          <dl className="mt-6 grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Experience</dt>
              <dd className="mt-1 font-semibold text-ink">{d.experience_years !== null ? `${d.experience_years} years` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Consultation fee</dt>
              <dd className="mt-1 font-semibold text-ink">{fee ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Clinic</dt>
              <dd className="mt-1 break-words font-semibold text-ink">{d.clinic_name ?? "—"}</dd>
            </div>
          </dl>
          {d.bio && (
            <div className="mt-6 border-t border-slate-200 pt-6">
              <h2 className="font-semibold text-ink">About</h2>
              <p className="mt-2 whitespace-pre-line break-words text-slate-600">{d.bio}</p>
            </div>
          )}
        </Card>

        <Card className="h-fit">
          <h2 className="text-lg font-semibold text-ink">Book a video consultation</h2>
          {currentSlots === null && <p className="mt-4 text-slate-500">Loading available times…</p>}
          {currentSlots !== null && dates.length === 0 && (
            <p className="mt-4 text-slate-600">No open times in the next {DAYS_SHOWN} days. Please check back later.</p>
          )}

          {activeDate && (
            <form onSubmit={review} className="mt-4 space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Choose a day</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {dates.map((date) => {
                    const { weekday, day } = formatDayShort(date);
                    const active = date === activeDate;
                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => {
                          setChosenDate(date);
                          setChosenSlot(null);
                        }}
                        className={`shrink-0 rounded-lg border px-3 py-2 text-center text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-ink hover:bg-slate-50"}`}
                      >
                        <span className="block font-semibold">{weekday}</span>
                        <span className="block">{day}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink">Choose a time</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(slotsByDate.get(activeDate) ?? []).map((slot) => {
                    const active = slot.id === selectedSlot;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setChosenSlot(slot.id)}
                        className={`rounded-lg border px-2 py-2 text-sm font-medium ${active ? "border-brand-700 bg-brand-50 text-brand-800 ring-1 ring-brand-700" : "border-slate-300 text-ink hover:bg-slate-50"}`}
                      >
                        {formatTime(slot.start_time)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {isPatient && (
                <Field label="Reason for visit" htmlFor="notes" hint="Optional — shared with the doctor.">
                  <Textarea id="notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              )}

              {selectionTaken && !bookError && (
                <Alert tone="warning">The time you picked was just booked by someone else. Please choose another.</Alert>
              )}
              {bookError && <Alert tone="error">{bookError}</Alert>}

              {status === "loading" ? null : !session ? (
                <ButtonLink href={`/login?next=${encodeURIComponent(`/doctors/${id}`)}`} variant="accent" className="w-full">
                  Log in to book
                </ButtonLink>
              ) : !isPatient ? (
                <Alert tone="info">Doctor accounts can&apos;t book appointments. Log in with a patient account to book.</Alert>
              ) : needsName ? (
                <Alert tone="warning">
                  Add your full name to your profile before booking.{" "}
                  <Link href="/patient/profile" className="font-semibold underline">
                    Complete profile
                  </Link>
                </Alert>
              ) : (
                <Button type="submit" variant="accent" size="lg" className="w-full" disabled={selectedSlot === null}>
                  {selectedSlot === null ? "Select a time" : "Book appointment"}
                </Button>
              )}
            </form>
          )}
        </Card>
      </div>

      {/* Closes by itself if the time is taken meanwhile (the warning above then shows). */}
      {confirming && slotToBook && (
        <ConfirmDialog
          title="Confirm your appointment"
          confirmLabel="Confirm booking"
          busyLabel="Booking…"
          tone="accent"
          onConfirm={book}
          onClose={() => setConfirming(false)}
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-3">
            <dt className="text-slate-500">Doctor</dt>
            <dd className="break-words font-semibold text-ink">{d.full_name ?? "Doctor"}</dd>
            <dt className="text-slate-500">Date</dt>
            <dd className="font-semibold text-ink">{formatDate(slotToBook.date)}</dd>
            <dt className="text-slate-500">Time</dt>
            <dd className="font-semibold text-ink">
              {formatTime(slotToBook.start_time)} – {formatTime(slotToBook.end_time)}
            </dd>
            {fee && (
              <>
                <dt className="text-slate-500">Fee</dt>
                <dd className="font-semibold text-ink">{fee}</dd>
              </>
            )}
            {notes.trim() && (
              <>
                <dt className="text-slate-500">Reason</dt>
                <dd className="break-words text-ink">{notes.trim()}</dd>
              </>
            )}
          </dl>
          {historyError ? (
            <Alert tone="warning">Couldn&apos;t load your health record ({historyError}). Everything that isn&apos;t private will be shared.</Alert>
          ) : myHistory ? (
            <ShareChooser history={myHistory} doctorName={d.full_name ?? "the doctor"} excluded={excluded} onChange={setExcluded} />
          ) : (
            <p className="text-slate-500">Loading your health record…</p>
          )}
          <p>
            It&apos;s a video consultation. The doctor will confirm your request, and you&apos;ll be notified when they do. Your shared history becomes
            visible to them only once they accept, and you can change or stop sharing any time from My appointments.
          </p>
        </ConfirmDialog>
      )}
    </Container>
  );
}

export default function DoctorProfilePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DoctorProfile />
    </Suspense>
  );
}
