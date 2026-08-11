"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap, useScrollLock } from "@/hooks/useFocusTrap";
import { useMounted } from "@/hooks/useMounted";
import { cx } from "@/lib/format";
import styles from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Right-hand sheet instead of a centred dialog. Used for transaction detail. */
  variant?: "modal" | "drawer";
  /** Element to focus on open — e.g. the confirm button in the redeem flow. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Set false during an in-flight action so a stray click can't cancel it. */
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
}

/**
 * Hand-built dialog — no component library.
 *
 * Accessibility contract:
 *   - `role="dialog"` + `aria-modal` + labelled by its own title;
 *   - focus moves in on open and returns to the trigger on close;
 *   - Tab is trapped inside;
 *   - Escape closes (suppressible while a request is in flight);
 *   - background scroll locked without the page shifting sideways;
 *   - overlay click closes, but only when the press *started* on the overlay.
 *
 * That last one is subtle and worth the code: without it, selecting text inside
 * the dialog and releasing the mouse over the overlay closes it and throws the
 * user's work away.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  variant = "modal",
  initialFocusRef,
  closeOnOverlayClick = true,
  closeOnEscape = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDownOnOverlay = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const mounted = useMounted();

  useFocusTrap(panelRef, open, { initialFocusRef });
  useScrollLock(open);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;
  // Portalled to <body> so no ancestor's overflow/transform can clip the dialog
  // or trap it inside a stacking context. Deferred past the first render so the
  // portal cannot cause a hydration mismatch — see useMounted.
  if (!mounted) return null;

  return createPortal(
    <div
      className={cx(styles.overlay, variant === "drawer" && styles.overlayDrawer)}
      onPointerDown={(event) => {
        pointerDownOnOverlay.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          closeOnOverlayClick &&
          pointerDownOnOverlay.current &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
        pointerDownOnOverlay.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        // tabIndex -1 gives the trap somewhere to park focus if the dialog has
        // no focusable children at all.
        tabIndex={-1}
        className={cx(
          styles.panel,
          variant === "drawer" ? styles.drawer : styles[size],
        )}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M12 4L4 12M4 4l8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
