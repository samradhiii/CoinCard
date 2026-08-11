/**
 * Formatting helpers.
 *
 * Money and dates are formatted in exactly one place so the table, the charts,
 * the drawer and the tooltips can never disagree about how ₹1,23,456.78 looks.
 *
 * Amounts arrive from the API as strings (Postgres NUMERIC serialised by
 * Pydantic). They are only converted to Number at the formatting boundary —
 * carrying them as JS numbers through the app would risk precision loss on the
 * larger values.
 */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const INR_WHOLE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const NUMBER = new Intl.NumberFormat("en-IN");

/** Full precision — table cells, detail drawer, confirmation copy. */
export function formatCurrency(value: string | number): string {
  return INR.format(toNumber(value));
}

/** No paise — stat tiles, where two decimals are noise. */
export function formatCurrencyWhole(value: string | number): string {
  return INR_WHOLE.format(toNumber(value));
}

/** ₹1.2L / ₹45.6K — chart axes, where space is the constraint. */
export function formatCompact(value: string | number): string {
  return INR_COMPACT.format(toNumber(value));
}

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatCoins(value: number): string {
  return NUMBER.format(value);
}

export function toNumber(value: string | number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ dates */

const DATE_SHORT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_LONG = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function formatDate(iso: string): string {
  return DATE_SHORT.format(new Date(iso));
}

export function formatDateLong(iso: string): string {
  return DATE_LONG.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** `YYYY-MM-DD` for <input type="date"> round-tripping. */
export function toDateInputValue(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return formatDate(iso);
}

/* ------------------------------------------------------------------ misc */

/**
 * Human label for the timestamp shape a row arrived in. Shown in the detail
 * drawer so the dirty-data handling is visible rather than merely claimed.
 */
export const TIMESTAMP_FORMAT_LABELS: Record<string, string> = {
  iso_utc: "ISO-8601 (UTC)",
  iso_offset: "ISO-8601 (+05:30)",
  epoch_ms: "Epoch milliseconds",
  date_only: "Date only (no time)",
  dmy_slash: "DD/MM/YYYY HH:MM:SS",
};

export function formatTimestampSource(key: string): string {
  return TIMESTAMP_FORMAT_LABELS[key] ?? key;
}

/**
 * Join class names, dropping falsy values. Saves a `clsx` dependency.
 *
 * Numbers are accepted because `someReactNode && styles.x` narrows to
 * `0 | 0n | string | ...` when the left side is a ReactNode. Only strings are
 * ever emitted, so a stray `0` is dropped rather than rendered as a class.
 */
export type ClassValue = string | number | bigint | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0).join(" ");
}
