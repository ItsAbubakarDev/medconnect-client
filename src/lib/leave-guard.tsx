"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";

interface LeaveGuard {
  add(id: symbol): void;
  remove(id: symbol): void;
  /** Whether any mounted form has unsaved changes right now. */
  isDirty(): boolean;
}

const LeaveGuardContext = createContext<LeaveGuard | null>(null);

/**
 * Asks before unsaved work is lost by leaving the page: a click on any link inside the app
 * (menu, logo, notifications, the call window…) asks "Leave without saving?", and closing the
 * tab, reloading or typing another address gets the browser's own "Leave site?" prompt.
 * Forms opt in with `useLeaveGuard(dirty)`.
 */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dirty = useRef(new Set<symbol>());
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    // On window, in the capture phase: before React (and so next/link) sees the click.
    const onClick = (e: MouseEvent) => {
      if (dirty.current.size === 0 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download"))
        return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return; // another site: the browser's prompt covers it
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0) return;
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const value = useMemo<LeaveGuard>(
    () => ({
      add: (id) => dirty.current.add(id),
      remove: (id) => dirty.current.delete(id),
      isDirty: () => dirty.current.size > 0,
    }),
    [],
  );

  return (
    <LeaveGuardContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          title="Leave without saving?"
          confirmLabel="Leave without saving"
          busyLabel="Leaving…"
          cancelLabel="Stay on this page"
          tone="danger"
          onConfirm={async () => {
            dirty.current.clear();
            router.push(pending);
            setPending(null);
          }}
          onClose={() => setPending(null)}
        >
          <p>You have changes on this page that aren&apos;t saved. If you leave now, they&apos;re lost.</p>
        </ConfirmDialog>
      )}
    </LeaveGuardContext.Provider>
  );
}

/** While `dirty` is true, leaving the page asks first. */
export function useLeaveGuard(dirty: boolean) {
  const guard = useContext(LeaveGuardContext);
  useEffect(() => {
    if (!dirty || !guard) return;
    const id = Symbol("unsaved");
    guard.add(id);
    return () => guard.remove(id);
  }, [dirty, guard]);
}

/** Whether anything on the page is unsaved (read when needed, e.g. by the logout question). */
export function useHasUnsavedChanges(): () => boolean {
  const guard = useContext(LeaveGuardContext);
  return useCallback(() => guard?.isDirty() ?? false, [guard]);
}

/**
 * For pop-up forms: closing one with unsaved input (Cancel, Escape, a click outside) asks
 * "Discard your changes?" first. Use `requestClose` wherever the dialog would close, and
 * render `discardDialog`. `asking` is true while the question is open (ignore Escape then).
 */
export function useDiscardConfirm(dirty: boolean, onClose: () => void) {
  const [asking, setAsking] = useState(false);
  useLeaveGuard(dirty);
  const requestClose = () => (dirty ? setAsking(true) : onClose());
  const discardDialog = asking ? (
    <ConfirmDialog
      title="Discard your changes?"
      confirmLabel="Discard"
      busyLabel="Closing…"
      cancelLabel="Keep editing"
      tone="danger"
      onConfirm={async () => {
        setAsking(false);
        onClose();
      }}
      onClose={() => setAsking(false)}
    >
      <p>What you&apos;ve entered here hasn&apos;t been saved.</p>
    </ConfirmDialog>
  ) : null;
  return { requestClose, discardDialog, asking };
}
