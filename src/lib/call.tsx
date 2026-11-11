"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";

import { api, messageOf } from "./api";
import { dashboardPath, useAuth } from "./auth";
import type { VideoToken } from "./types";

// LiveKit (WebRTC) is only loaded once a call starts, and only in the browser.
const CallDock = dynamic(() => import("@/components/call-dock"), {
  ssr: false,
  loading: () => <p className="py-16 text-center text-slate-500">Starting video…</p>,
});

export interface ActiveCall {
  appointmentId: number;
  token: string;
  serverUrl: string;
  userId: number;
}

/** Shown after a call ended without the user leaving it (connection lost, page reloaded…). */
export interface CallNotice {
  appointmentId: number;
  text: string;
  /** false once the consultation itself has ended (the server closed its room). */
  canRejoin: boolean;
}

interface CallContextValue {
  call: ActiveCall | null;
  notice: CallNotice | null;
  /** The appointment whose call page is open (the call is shown full size there). */
  stage: number | null;
  /** Gets a fresh token and connects. Throws if the call can't be joined. */
  join(appointmentId: number): Promise<void>;
  /** "Leave the consultation?" — the call only ends once that's confirmed. */
  requestLeave(): void;
  dismissNotice(): void;
  setStage(appointmentId: number | null): void;
  /** The connection ended without the user leaving (dropped, opened elsewhere, room closed). */
  onEnded(appointmentId: number, text: string, canRejoin: boolean): void;
}

const CallContext = createContext<CallContextValue | null>(null);

// Per tab: survives a reload or a typed address, so the call can be offered again.
const STORAGE_KEY = "medconnect.call";

function remember(value: { appointmentId: number; userId: number } | null) {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode): the call still works, it just isn't offered after a reload
  }
}

function remembered(): { appointmentId: number; userId: number } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return typeof value?.appointmentId === "number" && typeof value?.userId === "number" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Owns the video consultation, above the pages: moving around the app (menu, links, back)
 * keeps the call connected — it shrinks to a small window and grows back on the call page.
 * Only "Leave" (confirmed), logging out, or closing/reloading the tab ends it; the browser
 * asks before the last, and the call is offered again after a reload.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, session } = useAuth();
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [notice, setNotice] = useState<CallNotice | null>(null);
  const [stage, setStageState] = useState<number | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // Set while we hang up on purpose, so the "disconnected" event that follows is ignored.
  const leaving = useRef(false);
  const stageRef = useRef<number | null>(null);

  // After a reload: offer to rejoin the call this tab was in.
  useEffect(() => {
    if (status !== "authenticated" || !session) return;
    const last = remembered();
    if (last && last.userId === session.userId) {
      startTransition(() =>
        setNotice(
          (n) =>
            n ?? {
              appointmentId: last.appointmentId,
              text: "Your video consultation was interrupted when the page reloaded.",
              canRejoin: true,
            },
        ),
      );
    }
  }, [status, session]);

  // Logging out (or in as someone else) ends the call.
  useEffect(() => {
    if (status === "loading" || !call) return;
    if (!session || session.userId !== call.userId) {
      leaving.current = true;
      remember(null);
      startTransition(() => {
        setCall(null);
        setNotice(null);
        setConfirmingLeave(false);
      });
    }
  }, [status, session, call]);

  // Closing the tab, reloading or typing another address would cut the call: ask first.
  useEffect(() => {
    if (!call) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [call]);

  const join = useCallback(
    async (appointmentId: number) => {
      if (!session) throw new Error("Log in to join the call.");
      const token = await api<VideoToken>(`/appointments/${appointmentId}/video-token`, { method: "POST" });
      leaving.current = false;
      remember({ appointmentId, userId: session.userId });
      setNotice(null);
      setCall({ appointmentId, token: token.token, serverUrl: token.url, userId: session.userId });
    },
    [session],
  );

  const setStage = useCallback((appointmentId: number | null) => {
    stageRef.current = appointmentId;
    setStageState(appointmentId);
  }, []);

  const onEnded = useCallback((appointmentId: number, text: string, canRejoin: boolean) => {
    if (leaving.current) return;
    leaving.current = true;
    remember(null);
    setCall(null);
    setConfirmingLeave(false);
    setNotice({ appointmentId, text, canRejoin });
  }, []);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      notice,
      stage,
      join,
      requestLeave: () => setConfirmingLeave(true),
      dismissNotice: () => {
        remember(null);
        setNotice(null);
      },
      setStage,
      onEnded,
    }),
    [call, notice, stage, join, setStage, onEnded],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {confirmingLeave && call && (
        <ConfirmDialog
          title="Leave the consultation?"
          confirmLabel="Leave call"
          busyLabel="Leaving…"
          cancelLabel="Stay in the call"
          tone="danger"
          onConfirm={async () => {
            leaving.current = true;
            remember(null);
            const onCallPage = stageRef.current === call.appointmentId;
            setCall(null);
            setConfirmingLeave(false);
            if (onCallPage && session) router.push(dashboardPath(session.role));
          }}
          onClose={() => setConfirmingLeave(false)}
        >
          <p>Your camera and microphone switch off. You can rejoin from your dashboard while the appointment is on.</p>
        </ConfirmDialog>
      )}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const value = useContext(CallContext);
  if (!value) throw new Error("useCall must be used inside <CallProvider>");
  return value;
}

/** The call page registers itself, so the call is shown full size there. */
export function useCallStage(appointmentId: number) {
  const { setStage } = useCall();
  useEffect(() => {
    setStage(appointmentId);
    return () => setStage(null);
  }, [appointmentId, setStage]);
}

/** "Rejoin" after a dropped call, from wherever the user is (the call page has its own). */
function RejoinBanner({ notice }: { notice: CallNotice }) {
  const { join, dismissNotice } = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg"
    >
      <p className="font-semibold">{notice.text}</p>
      {error && <p className="mt-1 text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        {notice.canRejoin && (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-brand-700 px-3 py-1.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await join(notice.appointmentId);
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Connecting…" : "Rejoin call"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
          onClick={dismissNotice}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Where the call appears: under the call page's header, or as a small window on any other page. */
export function CallSlot() {
  const { call, notice, stage, requestLeave, onEnded } = useCall();
  if (!call) return notice && stage !== notice.appointmentId ? <RejoinBanner notice={notice} /> : null;
  return (
    <CallDock
      key={`${call.appointmentId}:${call.token}`}
      appointmentId={call.appointmentId}
      token={call.token}
      serverUrl={call.serverUrl}
      full={stage === call.appointmentId}
      onLeaveRequest={requestLeave}
      onEnded={(text, canRejoin) => onEnded(call.appointmentId, text, canRejoin)}
    />
  );
}
