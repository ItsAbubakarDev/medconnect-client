"use client";

import Link from "next/link";

import { clinicNow, formatFee, formatNextAvailable, initials, windowText } from "@/lib/format";
import type { DoctorPublic } from "@/lib/types";
import { useNow } from "@/lib/use-now";

import { RatingBadge } from "./rating";
import { Avatar, ButtonLink } from "./ui";

/** "Next available: Tomorrow, 10:00 AM" or "No availability in the next 4 weeks". */
export function NextAvailableLine({ doctor }: { doctor: DoctorPublic }) {
  const now = useNow();
  if (now === null) return null;
  if (!doctor.next_available) {
    return <p className="text-sm text-slate-500">No availability in the next {windowText(doctor.booking_window_days)}</p>;
  }
  return (
    <p className="text-sm text-emerald-800">
      <span className="font-semibold">Next available:</span> {formatNextAvailable(doctor.next_available, clinicNow(now).date)}
    </p>
  );
}

export function OnlineBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
      Online consultation
    </span>
  );
}

export function DoctorCard({ doctor }: { doctor: DoctorPublic }) {
  const name = doctor.full_name ?? "Doctor (profile incomplete)";
  const fee = formatFee(doctor.consultation_fee);
  const place = [doctor.city, doctor.area].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
      <Avatar text={initials(doctor.full_name)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={`/doctors/${doctor.id}`} className="truncate text-lg font-semibold text-ink hover:text-brand-700">
            {name}
          </Link>
          <RatingBadge average={doctor.rating_average} count={doctor.review_count} />
        </div>
        {doctor.specialty && <p className="truncate font-medium text-brand-700">{doctor.specialty}</p>}
        {doctor.qualifications && <p className="truncate text-sm text-slate-600">{doctor.qualifications}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          {place && <span className="truncate">{place}</span>}
          {doctor.offers_online && <OnlineBadge />}
          {doctor.experience_years !== null && <span>{doctor.experience_years} years experience</span>}
          {doctor.clinic_name && <span className="truncate">{doctor.clinic_name}</span>}
          {fee && <span className="font-semibold text-ink">{fee}</span>}
        </div>
        <div className="mt-2">
          <NextAvailableLine doctor={doctor} />
        </div>
      </div>
      <ButtonLink href={`/doctors/${doctor.id}`} variant="accent" className="shrink-0">
        Book appointment
      </ButtonLink>
    </div>
  );
}
