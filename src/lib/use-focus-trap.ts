"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

// Open modals, innermost last: only the top one handles Tab (a confirmation opened over a form).
const open: RefObject<HTMLElement | null>[] = [];

/**
 * Keeps Tab and Shift+Tab inside a modal while it's open — `aria-modal` tells screen readers,
 * but keyboard focus could still wander to the page behind. Give the modal's element a ref
 * (and tabIndex={-1}, so it can hold focus when it has nothing focusable).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    open.push(ref);
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (e.key !== "Tab" || !root || open[open.length - 1] !== ref) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0, // visible
      );
      const active = document.activeElement;
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!(active instanceof Node) || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = open.indexOf(ref);
      if (at >= 0) open.splice(at, 1);
    };
  }, [ref]);
}
