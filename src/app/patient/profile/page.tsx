"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { RequireRole } from "@/components/require-role";
import { Alert, Button, ButtonLink, Card, Container, Field, Input, PageHeader, PageLoading, Select } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PatientProfile } from "@/lib/types";

const GENDERS = ["Female", "Male", "Other", "Prefer not to say"];

function ProfileForm({ profile, welcome }: { profile: PatientProfile; welcome: boolean }) {
  const { reloadProfile } = useAuth();
  const [form, setForm] = useState({
    full_name: profile.full_name ?? "",
    gender: profile.gender ?? "",
    date_of_birth: profile.date_of_birth ?? "",
    phone: profile.phone ?? "",
    emergency_contact: profile.emergency_contact ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [hasName, setHasName] = useState(Boolean(profile.full_name));

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const genderOptions = form.gender && !GENDERS.includes(form.gender) ? [form.gender, ...GENDERS] : GENDERS;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api<PatientProfile>("/patients/me", {
        method: "PUT",
        body: {
          full_name: form.full_name,
          gender: form.gender || null,
          date_of_birth: form.date_of_birth || null,
          phone: form.phone.trim() || null,
          emergency_contact: form.emergency_contact.trim() || null,
        },
      });
      setForm((f) => ({ ...f, full_name: saved.full_name ?? "" }));
      setHasName(Boolean(saved.full_name));
      reloadProfile();
      setMessage({ tone: "success", text: "Profile saved." });
    } catch (err) {
      setMessage({ tone: "error", text: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {welcome && !hasName && <Alert tone="info">Welcome to MedConnect! Add your name to start booking appointments.</Alert>}
      <Card>
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Full name" htmlFor="full_name" required hint="Shown to your doctor. Required to book.">
              <Input id="full_name" required maxLength={255} value={form.full_name} onChange={set("full_name")} />
            </Field>
          </div>
          <Field label="Gender" htmlFor="gender">
            <Select id="gender" value={form.gender} onChange={set("gender")}>
              <option value="">Select…</option>
              {genderOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of birth" htmlFor="date_of_birth">
            <Input id="date_of_birth" type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" type="tel" maxLength={50} placeholder="+92 300 1234567" value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="Emergency contact" htmlFor="emergency_contact">
            <Input
              id="emergency_contact"
              maxLength={255}
              placeholder="Name and phone number"
              value={form.emergency_contact}
              onChange={set("emergency_contact")}
            />
          </Field>
          <div className="space-y-4 sm:col-span-2">
            {message && <Alert tone={message.tone}>{message.text}</Alert>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
              {hasName && (
                <ButtonLink href="/doctors" variant="accent">
                  Find a doctor
                </ButtonLink>
              )}
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

function PatientProfilePage() {
  const welcome = useSearchParams().get("welcome") === "1";
  const [state, setState] = useState<{ profile?: PatientProfile; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PatientProfile>("/patients/me")
      .then((profile) => !cancelled && setState({ profile }))
      .catch((e) => !cancelled && setState({ error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title="My profile" subtitle="Keep your details up to date for your doctors." />
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
    <RequireRole role="patient">
      <Suspense fallback={<PageLoading />}>
        <PatientProfilePage />
      </Suspense>
    </RequireRole>
  );
}
