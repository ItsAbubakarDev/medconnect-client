"use client";

import { useEffect, useState } from "react";

/** Fired on window whenever the signed-in user's notifications change (see notifications.tsx):
 * something happened to one of their appointments, so open pages refetch at once. */
export const LIVE_EVENT = "mc:live";

// Throttles the "come back" triggers: switching back to a tab fires both visibilitychange
// and focus, which should cause one refetch, not two.
const MIN_GAP_MS = 2_000;

/**
 * A counter that ticks whenever a page should refetch its data, so changes made by someone
 * else (a doctor accepting, a patient cancelling, a slot being booked) show up without a
 * reload. Add it to a fetch effect's dependencies.
 *
 * Ticks every `intervalMs` while the tab is visible, and immediately when the tab becomes
 * visible again, the window regains focus, the network comes back, or a notification arrives
 * (LIVE_EVENT — usually well before the next interval). Hidden tabs don't poll.
 */
export function useLiveRefresh(intervalMs: number): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = Date.now();

    const bump = () => {
      last = Date.now();
      setTick((t) => t + 1);
    };
    const bumpSoon = () => {
      if (Date.now() - last >= MIN_GAP_MS) bump();
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(bump, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        bumpSoon();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => bumpSoon();
    const onOnline = () => bumpSoon();
    const onLive = () => bump();

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener(LIVE_EVENT, onLive);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(LIVE_EVENT, onLive);
    };
  }, [intervalMs]);

  return tick;
}
