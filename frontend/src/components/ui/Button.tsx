import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "@/lib/format";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "coin";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without disabling the element. */
  loading?: boolean;
  block?: boolean;
  iconOnly?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/**
 * The app's only button.
 *
 * `forwardRef` is not decoration — the Modal needs a ref to move focus onto the
 * confirm button when it opens.
 *
 * Loading is modelled as `aria-busy` rather than `disabled`: a disabled element
 * is removed from the tab order, so a screen-reader user who triggered the
 * action would have focus silently dropped to the body mid-flow.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    block = false,
    iconOnly = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    type = "button",
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        block && styles.block,
        iconOnly && styles.iconOnly,
        className,
      )}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        leadingIcon
      )}
      {children ? (
        <span className={loading ? styles.busyLabel : undefined}>{children}</span>
      ) : null}
      {!loading && trailingIcon}
    </button>
  );
});
