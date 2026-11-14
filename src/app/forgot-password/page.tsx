"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { formatCountdown, useRetryCooldown } from "@/lib/use-retry-cooldown";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cooldown = useRetryCooldown(() => setError(null));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
        auth: false,
      });
      setSent(res.message);
    } catch (err) {
      setError(messageOf(err));
      cooldown.noteError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link href="/login" className="font-semibold text-brand-700 hover:underline">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">{sent}</Alert>
          <p className="text-sm text-slate-600">
            Email delivery isn&apos;t set up yet in this build: the reset link is printed in the terminal where the
            backend is running.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <Alert tone={cooldown.secondsLeft ? "warning" : "error"}>{error}</Alert>}
          <Button type="submit" className="w-full" size="lg" disabled={submitting || cooldown.secondsLeft > 0}>
            {cooldown.secondsLeft ? `Try again in ${formatCountdown(cooldown.secondsLeft)}` : submitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
