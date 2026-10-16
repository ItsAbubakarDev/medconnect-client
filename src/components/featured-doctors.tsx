"use client";

import { useEffect, useState } from "react";

import { api, messageOf } from "@/lib/api";
import type { DoctorList, DoctorPublic } from "@/lib/types";

import { DoctorCard } from "./doctor-card";
import { Alert, EmptyState } from "./ui";

export function FeaturedDoctors() {
  const [doctors, setDoctors] = useState<DoctorPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DoctorList>("/doctors?page_size=20", { auth: false })
      .then((list) => {
        // Doctors who haven't finished their profile aren't featured on the home page.
        if (!cancelled) setDoctors(list.items.filter((d) => d.full_name && d.specialty).slice(0, 4));
      })
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!doctors) return <p className="text-slate-500">Loading doctors…</p>;
  if (doctors.length === 0) return <EmptyState title="No doctors listed yet">Check back soon.</EmptyState>;
  return (
    <div className="grid gap-4">
      {doctors.map((d) => (
        <DoctorCard key={d.id} doctor={d} />
      ))}
    </div>
  );
}
