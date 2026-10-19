"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { RequireRole } from "@/components/require-role";
import { Alert, Button, ButtonLink, Card, Container, Field, Input, PageHeader, PageLoading, Select, Textarea } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CITIES } from "@/lib/cities";
import { SPECIALTY_SUGGESTIONS } from "@/lib/specialties";
import type { DoctorProfile } from "@/lib/types";

function ProfileForm({ profile, welcome }: { profile: DoctorProfile; welcome: boolean }) {
  const { reloadProfile } = useAuth();
  const [form, setForm] = useState({
    full_name: profile.full_name ?? "",
    specialty: profile.specialty ?? "",
    qualifications: profile.qualifications ?? "",
    experience_years: profile.experience_years?.toString() ?? "",
    clinic_name: profile.clinic_name ?? "",
    consultation_fee: profile.consultation_fee ?? "",
    bio: profile.bio ?? "",
    city: profile.city ?? "",
    area: profile.area ?? "",
    clinic_address: profile.clinic_address ?? "",
  });
  const [online, setOnline] = useState(profile.offers_online);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [complete, setComplete] = useState(Boolean(profile.full_name && profile.specialty));

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api<DoctorProfile>("/doctors/me", {
        method: "PUT",
        body: {
          full_name: form.full_name,
          specialty: orNull(form.specialty),
          qualifications: orNull(form.qualifications),
          experience_years: form.experience_years === "" ? null : Number(form.experience_years),
          clinic_name: orNull(form.clinic_name),
          consultation_fee: orNull(form.consultation_fee),
          bio: orNull(form.bio),
          city: form.city,
          area: orNull(form.area),
          clinic_address: orNull(form.clinic_address),
          offers_online: online,
        },
      });
      setComplete(Boolean(saved.full_name && saved.specialty));
      reloadProfile();
      setMessage({ tone: "success", text: "Profile saved. This is what patients see on your public page." });
    } catch (err) {
      setMessage({ tone: "error", text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {welcome && !complete && (
        <Alert tone="info">
          Welcome to MedConnect! Fill in your profile, then set your availability so patients can book you.
        </Alert>
      )}
      <Card>
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor="full_name" required hint='As patients should see it, e.g. "Dr. Ayesha Khan".'>
            <Input id="full_name" required maxLength={255} value={form.full_name} onChange={set("full_name")} />
          </Field>
          <Field label="Specialty" htmlFor="specialty" hint="Pick a suggestion or type your own.">
            <Input id="specialty" list="specialties" maxLength={255} value={form.specialty} onChange={set("specialty")} />
            <datalist id="specialties">
              {SPECIALTY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Qualifications" htmlFor="qualifications">
            <Input
              id="qualifications"
              maxLength={255}
              placeholder="MBBS, FCPS"
              value={form.qualifications}
              onChange={set("qualifications")}
            />
          </Field>
          <Field label="Experience (years)" htmlFor="experience_years">
            <Input
              id="experience_years"
              type="number"
              min={0}
              max={100}
              value={form.experience_years}
              onChange={set("experience_years")}
            />
          </Field>
          <Field label="Clinic / hospital" htmlFor="clinic_name">
            <Input id="clinic_name" maxLength={255} value={form.clinic_name} onChange={set("clinic_name")} />
          </Field>
          <Field label="Consultation fee (Rs.)" htmlFor="consultation_fee">
            <Input
              id="consultation_fee"
              type="number"
              min={0}
              max={99999999.99}
              step="0.01"
              value={form.consultation_fee}
              onChange={set("consultation_fee")}
            />
          </Field>
          <fieldset className="grid gap-5 rounded-xl border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-ink">Location</legend>
            {!profile.city && (
              <div className="sm:col-span-2">
                <Alert tone="warning">
                  Add your city so patients searching in your city can find you. Until then you only appear when patients
                  don&apos;t filter by city.
                </Alert>
              </div>
            )}
            <Field label="City" htmlFor="city" required>
              <Select id="city" required value={form.city} onChange={set("city")}>
                <option value="" disabled>
                  Choose your city
                </option>
                {CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Area or locality" htmlFor="area" hint='e.g. "DHA Phase 5", "F-10", "Gulberg III"'>
              <Input id="area" maxLength={120} value={form.area} onChange={set("area")} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Clinic address" htmlFor="clinic_address" hint="Shown on your public page.">
                <Input
                  id="clinic_address"
                  maxLength={500}
                  placeholder="Building, street, area, city"
                  value={form.clinic_address}
                  onChange={set("clinic_address")}
                />
              </Field>
            </div>
            <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
              <input
                type="checkbox"
                checked={online}
                onChange={(e) => setOnline(e.target.checked)}
                className="mt-1 h-4 w-4 accent-brand-700"
              />
              <span>
                <span className="block font-medium text-ink">Offers online (video) consultation</span>
                <span className="block text-sm text-slate-600">
                  Patients anywhere in Pakistan can find you when they search for online consultations.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="sm:col-span-2">
            <Field label="About you" htmlFor="bio" hint={`${form.bio.length}/2000`}>
              <Textarea id="bio" rows={5} maxLength={2000} value={form.bio} onChange={set("bio")} />
            </Field>
          </div>
          <div className="space-y-4 sm:col-span-2">
            {message && <Alert tone={message.tone}>{message.text}</Alert>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
              <ButtonLink href={`/doctors/${profile.id}`} variant="secondary">
                View public page
              </ButtonLink>
              {complete && (
                <ButtonLink href="/doctor/availability" variant="ghost">
                  Set availability →
                </ButtonLink>
              )}
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

function DoctorProfilePage() {
  const welcome = useSearchParams().get("welcome") === "1";
  const [state, setState] = useState<{ profile?: DoctorProfile; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DoctorProfile>("/doctors/me")
      .then((profile) => !cancelled && setState({ profile }))
      .catch((e) => !cancelled && setState({ error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Container className="max-w-4xl py-10">
      <PageHeader title="My profile" subtitle="Your public profile helps patients choose you." />
      <div className="mt-6">
        {!state && <p className="text-slate-500">Loading profile…</p>}
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {state?.profile && <ProfileForm profile={state.profile} welcome={welcome} />}
      </div>
    </Container>
  );
}

export default function Page() {
  return (
    <RequireRole role="doctor">
      <Suspense fallback={<PageLoading />}>
        <DoctorProfilePage />
      </Suspense>
    </RequireRole>
  );
}
