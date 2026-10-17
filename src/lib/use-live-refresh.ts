"use client";

import { useEffect, useState } from "react";

// Throttles the "come back" triggers: switching back to a tab fires both visibilitychange
// and focus, which should cause one refetch, not two.
const MIN_GAP_MS = 2_000;

/**
 * A counter that ticks whenever a page should refetch its data, so changes made by someone
 * else (a doctor accepting, a patient cancelling, a slot being booked) show up without a
 * reload. Add it to a fetch effect's dependencies.
 *
 * Ticks every `intervalMs` while the tab is visible, and immediately when the tab becomes
 * visible again, the window regains focus, or the network comes back. Hidden tabs don't poll.
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

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [intervalMs]);

  return tick;
}
