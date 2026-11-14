"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api";

/**
 * After a "too many attempts" refusal (429 with Retry-After), counts down until the form may
 * be sent again. `noteError(err)` starts it; `onDone` runs when it reaches zero (e.g. to clear
 * the now out-of-date message).
 */
export function useRetryCooldown(onDone?: () => void) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) {
        setUntil(0);
        onDoneRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [until]);

  const noteError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 429 && error.retryAfter) {
      const t = Date.now();
      setNow(t);
      setUntil(t + error.retryAfter * 1000);
    }
  }, []);

  const secondsLeft = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
  return { secondsLeft, noteError };
}

/** "0:42" / "14:05": time left, for a disabled button's label. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
