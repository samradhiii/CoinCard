"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cx } from "@/lib/format";
import styles from "./Field.module.css";

/* -------------------------------------------------------------------------- */
/* Field wrapper — label + hint/error plumbing                                */
/* -------------------------------------------------------------------------- */

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className={styles.hint}>{hint}</span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
  /** Renders an × that clears the value. */
  onClear?: () => void;
  /** Shows a spinner — used while a debounced search is in flight. */
  pending?: boolean;
  fieldClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leadingIcon,
    onClear,
    pending = false,
    className,
    fieldClassName,
    id,
    value,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = value !== undefined && value !== null && String(value).length > 0;

  const control = (
    <div className={cx(styles.control, className)}>
      {leadingIcon ? (
        <span className={styles.leading} aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={cx(styles.input, leadingIcon && styles.withLeading)}
        value={value}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {pending ? <span className={styles.pending} aria-hidden="true" /> : null}
      {onClear && hasValue && !pending ? (
        <button
          type="button"
          className={styles.clear}
          onClick={onClear}
          aria-label={`Clear ${label ?? "input"}`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M8 2L2 8M2 2l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );

  if (!label) return control;

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error} className={fieldClassName}>
      {control}
    </Field>
  );
});

/* -------------------------------------------------------------------------- */
/* Select                                                                     */
/* -------------------------------------------------------------------------- */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options: { value: string; label: string }[];
  fieldClassName?: string;
}

/**
 * Native <select> on purpose. A custom listbox would need its own keyboard
 * model and typeahead to be as good as the platform's, and on mobile the native
 * picker is strictly better than anything rendered in the page.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, options, className, fieldClassName, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  const control = (
    <div className={cx(styles.control, className)}>
      <select ref={ref} id={selectId} className={styles.select} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className={styles.selectChevron} aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );

  if (!label) return control;

  return (
    <Field label={label} htmlFor={selectId} hint={hint} className={fieldClassName}>
      {control}
    </Field>
  );
});
