import Link from "next/link";

import { formatFee, initials } from "@/lib/format";
import type { DoctorPublic } from "@/lib/types";

import { Avatar, ButtonLink } from "./ui";

export function DoctorCard({ doctor }: { doctor: DoctorPublic }) {
  const name = doctor.full_name ?? "Doctor (profile incomplete)";
  const fee = formatFee(doctor.consultation_fee);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
      <Avatar text={initials(doctor.full_name)} />
      <div className="min-w-0 flex-1">
        <Link href={`/doctors/${doctor.id}`} className="block truncate text-lg font-semibold text-ink hover:text-brand-700">
          {name}
        </Link>
        {doctor.specialty && <p className="truncate font-medium text-brand-700">{doctor.specialty}</p>}
        {doctor.qualifications && <p className="truncate text-sm text-slate-600">{doctor.qualifications}</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          {doctor.experience_years !== null && <span>{doctor.experience_years} years experience</span>}
          {doctor.clinic_name && <span className="truncate">{doctor.clinic_name}</span>}
          {fee && <span className="font-semibold text-ink">{fee}</span>}
        </div>
      </div>
      <ButtonLink href={`/doctors/${doctor.id}`} variant="accent" className="shrink-0">
        Book appointment
      </ButtonLink>
    </div>
  );
}
