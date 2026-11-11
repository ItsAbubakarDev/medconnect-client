"use client";

import { useParams } from "next/navigation";
import { Suspense, useState } from "react";

import { RequireRole } from "@/components/require-role";
import { Alert, Button, ButtonLink, Card, Container, PageLoading } from "@/components/ui";
import { messageOf } from "@/lib/api";
import { dashboardPath, useAuth } from "@/lib/auth";
import { useCall, useCallStage } from "@/lib/call";

function Call() {
  const id = Number(useParams<{ id: string }>().id);
  const { session } = useAuth();
  const { call, notice, join, requestLeave } = useCall();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const home = session ? dashboardPath(session.role) : "/";
  // While this page is open, the call is shown full size below this header.
  useCallStage(id);

  // The token is requested on click (not on page load) so the browser's camera/microphone
  // prompt follows a deliberate action, and a fresh token is used for every join.
  async function start() {
    setJoining(true);
    setError(null);
    try {
      await join(id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setJoining(false);
    }
  }

  if (call?.appointmentId === id) {
    return (
      <Container className="pb-3 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-ink">Video consultation</h1>
            <p className="text-sm text-slate-600">
              You can use the menu to open other pages — the call carries on in a small window.
            </p>
          </div>
          <div className="flex gap-2">
            <ButtonLink href={home} variant="secondary" size="sm">
              Back to dashboard
            </ButtonLink>
            <Button variant="danger" size="sm" onClick={requestLeave}>
              Leave call
            </Button>
          </div>
        </div>
      </Container>
    );
  }

  if (call) {
    return (
      <Container className="max-w-xl py-12">
        <Card>
          <h1 className="text-2xl font-bold text-ink">You&apos;re in another video call</h1>
          <p className="mt-2 text-slate-600">Leave that consultation before joining this one.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={`/appointments/${call.appointmentId}/call`}>Return to that call</ButtonLink>
            <Button variant="danger" onClick={requestLeave}>
              Leave that call
            </Button>
          </div>
        </Card>
      </Container>
    );
  }

  const dropped = notice?.appointmentId === id ? notice : null;
  const over = dropped !== null && !dropped.canRejoin; // the consultation itself has ended
  return (
    <Container className="max-w-xl py-12">
      <Card>
        <h1 className="text-2xl font-bold text-ink">Video consultation</h1>
        <p className="mt-2 text-slate-600">
          {session?.role === "doctor"
            ? "Your patient joins the same private room from their dashboard."
            : "Your doctor joins the same private room from their dashboard."}
        </p>
        <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Allow camera and microphone access when your browser asks.</li>
          <li>Use a recent Chrome, Edge, Firefox or Safari, ideally with headphones.</li>
          <li>Only you and the other participant of this appointment can join.</li>
          <li>
            Once you&apos;re in, you can open other pages of MedConnect — the call keeps going in a small window. Closing or
            reloading the tab ends it.
          </li>
        </ul>
        {(error || dropped) && (
          <div className="mt-5">
            <Alert tone={error ? "error" : "warning"}>{error ?? dropped?.text}</Alert>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {!over && (
            <Button size="lg" onClick={start} disabled={joining}>
              {joining ? "Connecting…" : dropped ? "Rejoin consultation" : "Join consultation"}
            </Button>
          )}
          <ButtonLink href={home} variant={over ? "primary" : "secondary"} size="lg">
            {over ? "Back to dashboard" : "Back"}
          </ButtonLink>
        </div>
      </Card>
    </Container>
  );
}

export default function CallPage() {
  return (
    <RequireRole>
      <Suspense fallback={<PageLoading />}>
        <Call />
      </Suspense>
    </RequireRole>
  );
}
