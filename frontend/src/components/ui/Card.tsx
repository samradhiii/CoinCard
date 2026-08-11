import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/format";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Renders as <section> by default; pass "article"/"div" where apt. */
  as?: "section" | "article" | "div";
  interactive?: boolean;
  flush?: boolean;
}

/**
 * Surface primitive. Composed rather than configured — `Card.Header` etc. are
 * separate exports, so a card with a chart in it does not need a `chart` prop.
 */
export function Card({
  as: Tag = "section",
  interactive = false,
  flush = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(
        styles.card,
        interactive && styles.interactive,
        flush && styles.flush,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bordered?: boolean;
  /** Heading level — cards appear at different depths, so this is not fixed. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

export function CardHeader({
  title,
  subtitle,
  actions,
  bordered = false,
  headingLevel = 3,
  className,
}: CardHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={cx(styles.header, bordered && styles.headerBordered, className)}>
      <div className={styles.titles}>
        <Heading className={styles.title}>{title}</Heading>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  tight = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tight?: boolean }) {
  return (
    <div className={cx(styles.body, tight && styles.bodyTight, className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.footer, className)} {...rest}>
      {children}
    </div>
  );
}
