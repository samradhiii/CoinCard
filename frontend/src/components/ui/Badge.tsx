import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types";
import styles from "./Badge.module.css";

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent"
  | "coin";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Adds a leading colour dot. */
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], className)} {...rest}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  SUCCESS: "success",
  FAILED: "danger",
  PENDING: "warning",
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  SUCCESS: "Success",
  FAILED: "Failed",
  PENDING: "Pending",
};

/**
 * Payment status. Always renders the word alongside the colour — status must
 * never be conveyed by hue alone.
 */
export function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Category chip tinted with that category's colour from the database, so the
 * chart slice and the table badge always match.
 */
export function CategoryBadge({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cx(styles.badge, styles.category, className)}
      style={{ "--cat-color": color } as CSSProperties}
    >
      {name}
    </span>
  );
}
