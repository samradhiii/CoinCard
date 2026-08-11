"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useMounted } from "@/hooks/useMounted";
import { cx } from "@/lib/format";
import styles from "./Toast.module.css";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (input: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Errors are given longer on screen — they carry information worth reading. */
const DURATIONS: Record<ToastTone, number> = {
  success: 4200,
  info: 4200,
  error: 6500,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...input, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATIONS[input.tone]),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  // Portals cannot render on the first pass — see useMounted. Without this the
  // client emits the viewport <div> where the server emitted nothing, and React
  // reports a hydration mismatch on every page load.
  const mounted = useMounted();
  if (!mounted) return null;

  return createPortal(
    // `status` + polite: a redeem result should be announced, but it must not
    // interrupt whatever the screen reader is currently saying.
    <div className={styles.viewport} role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={cx(styles.toast, styles[toast.tone])}>
          <span className={styles.icon} aria-hidden="true">
            {toast.tone === "success" ? <CheckIcon /> : toast.tone === "error" ? <XIcon /> : <InfoIcon />}
          </span>
          <div className={styles.content}>
            <p className={styles.title}>{toast.title}</p>
            {toast.description ? <p className={styles.description}>{toast.description}</p> : null}
          </div>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M8 2L2 8M2 2l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 8.2l2 2 3.6-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 6L6 10M6 6l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="5.2" r="0.8" fill="currentColor" />
    </svg>
  );
}
