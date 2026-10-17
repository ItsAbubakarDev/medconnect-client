"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import type { AppNotification, NotificationPage, NotificationState, Role } from "./types";
import { LIVE_EVENT } from "./use-live-refresh";

const RECENT_LIMIT = 15; // what the bell's panel shows
const WAIT_SECONDS = 20; // long-poll hold; the server answers sooner the moment anything changes
const MIN_WAIT_SECONDS = 3;

interface NotificationsValue {
  /** false until the first load finished. */
  loaded: boolean;
  unreadCount: number;
  /** The newest few, for the bell. */
  recent: AppNotification[];
  /** Bumps whenever anything changed, so a fuller list (the notifications page) refetches. */
  version: number;
  /** One that just arrived while the page was open (shown as a toast), if any. */
  incoming: AppNotification | null;
  dismissIncoming(): void;
  markRead(id: number): Promise<void>;
  markAllRead(): Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

const untilVisible = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (document.visibilityState === "visible") return resolve();
    const done = () => {
      if (document.visibilityState !== "visible" && !signal.aborted) return;
      document.removeEventListener("visibilitychange", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * Keeps the signed-in user's notifications current without reloads: a long poll
 * (GET /notifications/wait) that the server answers the instant something changes, then a
 * refetch. Plain requests, so it works through any proxy; if waiting fails it backs off and
 * keeps polling. Paused while the tab is hidden; catches up the moment it's visible again.
 */
function LiveNotifications({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [version, setVersion] = useState(0);
  const [incoming, setIncoming] = useState<AppNotification | null>(null);
  const cursor = useRef<string | null>(null);
  const latestSeen = useRef<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await api<NotificationPage>(`/notifications?limit=${RECENT_LIMIT}`, { signal });
    const previous = latestSeen.current;
    if (previous !== null && next.latest_id > previous) {
      // Not for the user's own booking receipt: they're looking at the confirmation already.
      const fresh = next.items.find((n) => n.id > previous && n.read_at === null && n.type !== "booking_requested");
      if (fresh) setIncoming(fresh);
    }
    const changed = cursor.current !== null && cursor.current !== next.cursor;
    cursor.current = next.cursor;
    latestSeen.current = next.latest_id;
    setPage(next);
    setVersion((v) => v + 1);
    // Something happened to one of this user's appointments: open dashboards refetch now.
    if (changed) window.dispatchEvent(new Event(LIVE_EVENT));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      let failures = 0;
      // Shortened after a failed wait: if something in between (a proxy) cuts long requests,
      // this settles into short, quick polls instead of waiting out a growing backoff.
      let waitSeconds = WAIT_SECONDS;
      let stale = true; // load before waiting (first run, and after the tab was hidden)
      while (!signal.aborted) {
        if (document.visibilityState !== "visible") {
          await untilVisible(signal);
          stale = true;
          continue;
        }
        try {
          if (stale || cursor.current === null) {
            await load(signal);
            stale = false;
          }
          const state = await api<NotificationState>(
            `/notifications/wait?timeout=${waitSeconds}&cursor=${encodeURIComponent(cursor.current ?? "")}`,
            { signal },
          );
          failures = 0;
          if (state.cursor !== cursor.current) stale = true;
        } catch (e) {
          if (signal.aborted) break;
          if (e instanceof ApiError && e.status === 401) break; // signed out; the provider unmounts
          failures += 1;
          waitSeconds = Math.max(MIN_WAIT_SECONDS, Math.floor(waitSeconds / 2));
          stale = true;
          await sleep(Math.min(10_000, 1_000 * 2 ** failures), signal);
        }
      }
    })();

    return () => controller.abort();
  }, [load]);

  const markRead = useCallback(async (id: number) => {
    setPage((p) => {
      if (!p) return p;
      const target = p.items.find((n) => n.id === id);
      if (!target || target.read_at) return p;
      const now = new Date().toISOString();
      return {
        ...p,
        unread_count: Math.max(0, p.unread_count - 1),
        items: p.items.map((n) => (n.id === id ? { ...n, read_at: now } : n)),
      };
    });
    setIncoming((n) => (n?.id === id ? null : n));
    // The server wakes this user's other tabs (and this one's long poll) to match.
    await api(`/notifications/${id}/read`, { method: "PATCH" }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setPage((p) => p && { ...p, unread_count: 0, items: p.items.map((n) => (n.read_at ? n : { ...n, read_at: now })) });
    setIncoming(null);
    await api("/notifications/read-all", { method: "POST" }).catch(() => {});
  }, []);

  const dismissIncoming = useCallback(() => setIncoming(null), []);

  const value = useMemo<NotificationsValue>(
    () => ({
      loaded: page !== null,
      unreadCount: page?.unread_count ?? 0,
      recent: page?.items ?? [],
      version,
      incoming,
      dismissIncoming,
      markRead,
      markAllRead,
    }),
    [page, version, incoming, dismissIncoming, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <>{children}</>;
  // Keyed by user, so signing in as someone else starts from a clean slate.
  return <LiveNotifications key={`${session.role}-${session.userId}`}>{children}</LiveNotifications>;
}

/** null when signed out. */
export function useNotifications(): NotificationsValue | null {
  return useContext(NotificationsContext);
}

/** Where a notification takes you: the appointment on your dashboard, or straight into the
 * call when that's what it's about (and the appointment is still confirmed). */
export function notificationHref(n: AppNotification, role: Role): string {
  const a = n.appointment;
  if (!a) return role === "doctor" ? "/doctor" : "/patient";
  if ((n.type === "call_joined" || n.type === "reminder_starting_soon") && a.status === "confirmed") {
    return `/appointments/${a.id}/call`;
  }
  if (n.type === "history_updated") return `/doctor/appointments/${a.id}`;
  if (n.type === "consultation_added") return "/patient/history?tab=timeline";
  return role === "doctor" ? `/doctor?appointment=${a.id}&date=${a.date}` : `/patient?appointment=${a.id}`;
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "14 Oct". */
export function timeAgo(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  const minutes = Math.floor((nowMs - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
