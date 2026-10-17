"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { addDays, clinicNow, formatTime } from "@/lib/format";
import { notificationHref, timeAgo, useNotifications } from "@/lib/notifications";
import type { AppNotification } from "@/lib/types";
import { useNow } from "@/lib/use-now";

import { StatusBadge } from "./status-badge";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

function BellIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

/** "Today, 10:30 AM" / "Tomorrow, 10:30 AM" for an appointment that's still on — computed
 * live, since the stored text uses absolute dates. */
function dayHint(n: AppNotification, nowMs: number | null): string | null {
  const a = n.appointment;
  if (!a || nowMs === null || (a.status !== "pending" && a.status !== "confirmed")) return null;
  const today = clinicNow(nowMs).date;
  if (a.date === today) return `Today, ${formatTime(a.start_time)}`;
  if (a.date === addDays(today, 1)) return `Tomorrow, ${formatTime(a.start_time)}`;
  return null;
}

export function NotificationItem({
  notification: n,
  onOpen,
  onRead,
}: {
  notification: AppNotification;
  /** Called when the notification is followed (e.g. to close the panel). */
  onOpen?: () => void;
  /** Called when it's marked read, so a list of its own can update at once. */
  onRead?: (id: number) => void;
}) {
  const { session } = useAuth();
  const live = useNotifications();
  const now = useNow();
  const unread = n.read_at === null;
  const hint = dayHint(n, now);
  if (!session || !live) return null;
  const read = () => {
    onRead?.(n.id);
    void live.markRead(n.id);
  };

  return (
    <li className={`flex items-start gap-1 ${unread ? "bg-brand-50/60" : "bg-white"}`}>
      <Link
        href={notificationHref(n, session.role)}
        onClick={() => {
          if (unread) read();
          onOpen?.();
        }}
        className={`flex min-w-0 flex-1 gap-3 px-4 py-3 hover:bg-slate-50 ${focusRing}`}
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-brand-700" : "bg-transparent"}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${unread ? "font-semibold text-ink" : "font-medium text-slate-700"}`}>
            {n.title}
            {unread && <span className="sr-only"> (unread)</span>}
          </span>
          <span className="mt-0.5 block break-words text-sm text-slate-600">{n.body}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <time dateTime={n.created_at}>{now !== null ? timeAgo(n.created_at, now) : ""}</time>
            {n.appointment && <StatusBadge status={n.appointment.status} />}
            {hint && <span className="font-medium text-brand-800">{hint}</span>}
          </span>
        </span>
      </Link>
      {unread && (
        <button
          type="button"
          onClick={read}
          className={`mr-2 mt-2 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 ${focusRing}`}
          aria-label={`Mark "${n.title}" as read`}
        >
          Mark read
        </button>
      )}
    </li>
  );
}

export function NotificationBell() {
  const live = useNotifications();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!live) return null;
  const { unreadCount, recent, loaded, markAllRead } = live;
  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className={`relative rounded-md p-2 text-slate-700 hover:bg-slate-100 ${focusRing}`}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-4 top-16 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <p className="font-semibold text-ink">
              Notifications{unreadCount > 0 && <span className="font-normal text-slate-500"> · {unreadCount} unread</span>}
            </p>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className={`rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
            >
              Mark all as read
            </button>
          </div>
          <div className="max-h-[min(65vh,28rem)] overflow-y-auto">
            {!loaded ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
            ) : recent.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="font-semibold text-ink">No notifications yet</p>
                <p className="mt-1 text-sm text-slate-600">Bookings, confirmations and reminders will show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((n) => (
                  <NotificationItem key={n.id} notification={n} onOpen={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-200 px-4 py-2.5 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className={`rounded-md px-2 py-1 text-sm font-semibold text-brand-700 hover:underline ${focusRing}`}
            >
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

const TOAST_MS = 8_000;

/** A brief heads-up when a notification arrives while the page is open. */
export function NotificationToast() {
  const { session } = useAuth();
  const live = useNotifications();
  const incoming = live?.incoming ?? null;
  const dismiss = live?.dismissIncoming;

  useEffect(() => {
    if (!incoming || !dismiss) return;
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [incoming, dismiss]);

  if (!session || !live) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-end sm:left-auto sm:right-6 sm:w-96"
    >
      {incoming && (
        <div className="pointer-events-auto w-full rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-brand-700">
              <BellIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{incoming.title}</p>
              <p className="mt-0.5 break-words text-sm text-slate-600">{incoming.body}</p>
              <Link
                href={notificationHref(incoming, session.role)}
                onClick={() => void live.markRead(incoming.id)}
                className={`mt-2 inline-block rounded-md text-sm font-semibold text-brand-700 hover:underline ${focusRing}`}
              >
                View
              </Link>
            </div>
            <button
              type="button"
              onClick={live.dismissIncoming}
              aria-label="Dismiss"
              className={`rounded-md px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-ink ${focusRing}`}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
