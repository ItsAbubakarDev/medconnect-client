"use client";

import { useEffect, useState } from "react";

import { NotificationItem } from "@/components/notifications";
import { RequireRole } from "@/components/require-role";
import { Alert, Button, Container, EmptyState, PageHeader } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { useNotifications } from "@/lib/notifications";
import type { AppNotification, NotificationPage } from "@/lib/types";

const PAGE_SIZE = 20;
type Filter = "all" | "unread";

interface ListState {
  filter: Filter;
  items: AppNotification[];
  hasMore: boolean;
  error?: string;
}

function query(filter: Filter, before?: number) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filter === "unread") params.set("unread", "true");
  if (before) params.set("before", String(before));
  return `/notifications?${params}`;
}

function NotificationsList() {
  const live = useNotifications();
  const version = live?.version ?? 0;
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<ListState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // The first page refetches whenever anything changes (a new notification, one read in
  // another tab); pages loaded further down are kept.
  useEffect(() => {
    let cancelled = false;
    api<NotificationPage>(query(filter))
      .then((page) => {
        if (cancelled) return;
        setList((prev) => {
          if (!prev || prev.filter !== filter) return { filter, items: page.items, hasMore: page.has_more };
          const oldest = page.items.at(-1)?.id ?? Infinity;
          const older = page.has_more ? prev.items.filter((n) => n.id < oldest) : [];
          return { filter, items: [...page.items, ...older], hasMore: older.length ? prev.hasMore : page.has_more };
        });
      })
      .catch(
        (e) =>
          !cancelled &&
          setList((prev) => (prev?.filter === filter ? prev : { filter, items: [], hasMore: false, error: messageOf(e) })),
      );
    return () => {
      cancelled = true;
    };
  }, [filter, version]);

  async function loadMore() {
    if (!list?.items.length) return;
    setLoadingMore(true);
    try {
      const page = await api<NotificationPage>(query(list.filter, list.items.at(-1)!.id));
      setList((prev) => prev && { ...prev, items: [...prev.items, ...page.items], hasMore: page.has_more });
    } catch (e) {
      setList((prev) => prev && { ...prev, error: messageOf(e) });
    } finally {
      setLoadingMore(false);
    }
  }

  const markLocal = (id?: number) =>
    setList((prev) => {
      if (!prev) return prev;
      const now = new Date().toISOString();
      return {
        ...prev,
        items: prev.items.map((n) => ((id === undefined || n.id === id) && !n.read_at ? { ...n, read_at: now } : n)),
      };
    });

  const current = list?.filter === filter ? list : null;
  const unread = live?.unreadCount ?? 0;

  return (
    <Container className="py-10">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          <Button
            variant="secondary"
            disabled={unread === 0}
            onClick={() => {
              markLocal();
              void live?.markAllRead();
            }}
          >
            Mark all as read
          </Button>
        }
      />

      <div className="mt-6 flex gap-2 border-b border-slate-200" role="tablist">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${filter === f ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-ink"}`}
          >
            {f === "all" ? "All" : `Unread (${unread})`}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {!current && <p className="text-slate-500">Loading notifications…</p>}
        {current?.error && <Alert tone="error">{current.error}</Alert>}
        {current && !current.error && current.items.length === 0 && (
          <EmptyState title={filter === "unread" ? "No unread notifications" : "No notifications yet"}>
            Bookings, confirmations, cancellations and reminders for your appointments will show up here.
          </EmptyState>
        )}
        {current && current.items.length > 0 && (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {current.items.map((n) => (
              <NotificationItem key={n.id} notification={n} onRead={markLocal} />
            ))}
          </ul>
        )}
        {current?.hasMore && (
          <div className="mt-4 text-center">
            <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Show older"}
            </Button>
          </div>
        )}
      </div>
    </Container>
  );
}

export default function NotificationsPage() {
  return (
    <RequireRole>
      <NotificationsList />
    </RequireRole>
  );
}
