"use client";

import { useEffect, type RefObject } from "react";

/**
 * Focus trap for the hand-built Modal/Drawer.
 *
 * The brief calls out "a cleanly hand-built modal (focus trap, Escape to
 * close)", so this is written rather than installed. What it does:
 *
 *   1. remembers what was focused before opening;
 *   2. moves focus into the dialog;
 *   3. keeps Tab/Shift+Tab cycling inside it;
 *   4. restores focus to the original trigger on close.
 *
 * Step 4 is the one most hand-rolled traps miss, and it is the one that matters
 * most: without it, closing the drawer dumps a keyboard user at the top of the
 * document instead of back on the table row they came from.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      // offsetParent is null for display:none — cheaper than getComputedStyle
      // and correct for everything this app renders.
      (el.offsetParent !== null || el === document.activeElement),
  );
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: { initialFocusRef?: RefObject<HTMLElement | null> } = {},
): void {
  const { initialFocusRef } = options;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Defer one frame: on open the panel is mid-animation and children may not
    // be laid out yet, so querying focusables immediately can come back empty.
    const focusTimer = window.setTimeout(() => {
      const target =
        initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
      target.focus({ preventScroll: true });
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;

      const focusable = getFocusable(node);
      if (focusable.length === 0) {
        // Nothing to focus — keep focus pinned to the dialog itself.
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;

      if (event.shiftKey && (current === first || current === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    /**
     * Focus can still escape via a browser-level jump (address bar, dev tools,
     * a stray programmatic focus). Pull it back if it lands outside.
     */
    function handleFocusIn(event: FocusEvent) {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(event.target as Node)) {
        const focusable = getFocusable(node);
        (focusable[0] ?? node).focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      // Return focus to whatever opened the dialog, if it is still in the DOM.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, initialFocusRef]);
}

/**
 * Lock body scroll while a dialog is open.
 *
 * Compensating for the scrollbar width prevents the whole page jolting sideways
 * as the scrollbar disappears — the tell-tale sign of a hand-rolled modal.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const current = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [active]);
}
