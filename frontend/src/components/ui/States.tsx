import type { CSSProperties, ReactNode } from "react";

import { ApiError } from "@/lib/api";
import { cx } from "@/lib/format";
import { Button } from "./Button";
import styles from "./States.module.css";

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height, radius, className, style }: SkeletonProps) {
  return (
    <span
      className={cx(styles.skeleton, className)}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, display: "block", ...style }}
    />
  );
}

export function SkeletonText({ width = "100%" }: { width?: string | number }) {
  return <Skeleton className={styles.skeletonText} width={width} />;
}

/* -------------------------------------------------------------------------- */
/* Empty                                                                      */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string;
  message?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, message, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.state, className)}>
      <span className={styles.icon} aria-hidden="true">
        {icon ?? <SearchIcon />}
      </span>
      <p className={styles.title}>{title}</p>
      {message ? <p className={styles.message}>{message}</p> : null}
      {action ? <div className={styles.actions}>{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

/**
 * Error state that says something useful.
 *
 * A dead API is by far the likeliest failure in a local demo, so that case gets
 * its own message telling the reader exactly which command to run rather than a
 * generic "Something went wrong".
 */
export function ErrorState({ error, onRetry, title, className }: ErrorStateProps) {
  const isApiError = error instanceof ApiError;
  const isOffline = isApiError && error.code === "network_error";

  const heading = title ?? (isOffline ? "Can't reach the API" : "Something went wrong");
  const message = isOffline
    ? "The backend isn't responding. Start it with `docker compose up` and try again."
    : isApiError
      ? error.message
      : "An unexpected error occurred while loading this view.";

  return (
    <div className={cx(styles.state, className)} role="alert">
      <span className={cx(styles.icon, styles.iconDanger)} aria-hidden="true">
        <AlertIcon />
      </span>
      <p className={styles.title}>{heading}</p>
      <p className={styles.message}>{message}</p>
      {isApiError && error.status > 0 ? (
        <p className={styles.detail}>
          {error.status} · {error.code}
        </p>
      ) : null}
      {onRetry ? (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons — inline so there is no icon-library dependency                      */
/* -------------------------------------------------------------------------- */

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
    </svg>
  );
}
