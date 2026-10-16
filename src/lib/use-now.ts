"use client";

import { useSyncExternalStore } from "react";

// A shared, coarse clock. Returns null during server prerendering (Cache Components
// forbids reading the current time there) and the current time in the browser,
// refreshed every 30 seconds.

let current: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const subscribers = new Set<() => void>();

function subscribe(callback: () => void) {
  subscribers.add(callback);
  timer ??= setInterval(() => {
    current = Date.now();
    subscribers.forEach((s) => s());
  }, 30_000);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  current ??= Date.now();
  return current;
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
