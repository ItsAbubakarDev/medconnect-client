"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { RequireRole } from "@/components/require-role";
import { Alert, Button, ButtonLink, Card, Container, PageLoading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { dashboardPath, useAuth } from "@/lib/auth";
import type { VideoToken } from "@/lib/types";

const VideoRoom = dynamic(() => import("@/components/video-room"), {
  ssr: false,
  loading: () => <p className="py-16 text-center text-slate-500">Starting video…</p>,
});

function Call() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [joining, setJoining] = useState(false);
  const [token, setToken] = useState<VideoToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const home = session ? dashboardPath(session.role) : "/";

  // The token is requested on click (not on page load) so the browser's camera/microphone
  // prompt follows a deliberate action, and a fresh token is used for every join.
  async function join() {
    setJoining(true);
    setError(null);
    try {
      setToken(await api<VideoToken>(`/appointments/${id}/video-token`, { method: "POST" }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setJoining(false);
    }
  }

  if (token) {
    return (
      <Container className="py-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-ink">Video consultation</h1>
          <Button variant="secondary" size="sm" onClick={() => setLeaving(true)}>
            Back to dashboard
          </Button>
        </div>
        <VideoRoom
          token={token.token}
          serverUrl={token.url}
          onLeave={() => router.push(home)}
          onLeaveRequest={() => setLeaving(true)}
        />
        {leaving && (
          <ConfirmDialog
            title="Leave the consultation?"
            confirmLabel="Leave call"
            busyLabel="Leaving…"
            cancelLabel="Stay in the call"
            tone="danger"
            onConfirm={async () => router.push(home)}
            onClose={() => setLeaving(false)}
          >
            <p>Your camera and microphone switch off. You can rejoin from your dashboard while the appointment is on.</p>
          </ConfirmDialog>
        )}
      </Container>
    );
  }

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
        </ul>
        {error && (
          <div className="mt-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" onClick={join} disabled={joining}>
            {joining ? "Connecting…" : "Join consultation"}
          </Button>
          <ButtonLink href={home} variant="secondary" size="lg">
            Back
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
