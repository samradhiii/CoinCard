/**
 * Filter state <-> URL serialisation.
 *
 * The URL is the single source of truth for every filter, the sort, and the
 * page. Nothing about "what the user is looking at" lives in a React store.
 *
 * That one decision buys, for free:
 *   - shareable/bookmarkable views ("here's my Travel spend for Q1");
 *   - working browser back/forward through filter changes;
 *   - no possibility of the table and the charts drifting out of sync, because
 *     both derive their query from the same object;
 *   - refresh-safe state.
 *
 * See DECISIONS.md.
 */

import type { QueryValue } from "./api";
import type { PaymentMethod, PaymentStatus, SortField, SortOrder } from "./types";

export interface FilterState {
  categories: string[];
  statuses: PaymentStatus[];
  methods: PaymentMethod[];
  merchants: string[];
  search: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  includeRefunds: boolean;
  includeOutliers: boolean;
  sort: SortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: FilterState = {
  categories: [],
  statuses: [],
  methods: [],
  merchants: [],
  search: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  includeRefunds: true,
  includeOutliers: true,
  sort: "date",
  order: "desc",
  page: 1,
  pageSize: 25,
};

const VALID_SORTS: SortField[] = ["date", "amount", "merchant"];
const VALID_ORDERS: SortOrder[] = ["asc", "desc"];
const VALID_STATUSES: PaymentStatus[] = ["SUCCESS", "FAILED", "PENDING"];
const VALID_METHODS: PaymentMethod[] = ["Credit Card", "Debit Card", "UPI", "Netbanking"];
export const PAGE_SIZES = [25, 50, 100] as const;

/* -------------------------------------------------------------------------- */
/* Parse                                                                      */
/* -------------------------------------------------------------------------- */

function parseList(params: URLSearchParams, key: string): string[] {
  const values = params.getAll(key);
  if (values.length === 0) return [];
  return values.flatMap((v) => v.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Read filters out of the URL. Every field is validated against a whitelist —
 * a hand-edited `?sort=DROP TABLE` must degrade to the default, not reach the
 * API and certainly not crash the render.
 */
export function parseFilters(params: URLSearchParams): FilterState {
  const sort = params.get("sort") as SortField | null;
  const order = params.get("order") as SortOrder | null;
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(params.get("pageSize") ?? "25", 10);

  return {
    categories: parseList(params, "category"),
    statuses: parseList(params, "status").filter((s): s is PaymentStatus =>
      VALID_STATUSES.includes(s as PaymentStatus),
    ),
    methods: parseList(params, "method").filter((m): m is PaymentMethod =>
      VALID_METHODS.includes(m as PaymentMethod),
    ),
    merchants: parseList(params, "merchant"),
    search: params.get("q") ?? "",
    dateFrom: params.get("from") ?? "",
    dateTo: params.get("to") ?? "",
    amountMin: params.get("min") ?? "",
    amountMax: params.get("max") ?? "",
    includeRefunds: params.get("refunds") !== "0",
    includeOutliers: params.get("outliers") !== "0",
    sort: sort && VALID_SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    order: order && VALID_ORDERS.includes(order) ? order : DEFAULT_FILTERS.order,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number]) ? pageSize : 25,
  };
}

/* -------------------------------------------------------------------------- */
/* Serialise                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Write filters back to a query string, omitting anything at its default.
 * Keeps shared URLs short and readable instead of a wall of `&status=&method=`.
 */
export function serializeFilters(state: FilterState): string {
  const params = new URLSearchParams();

  state.categories.forEach((c) => params.append("category", c));
  state.statuses.forEach((s) => params.append("status", s));
  state.methods.forEach((m) => params.append("method", m));
  state.merchants.forEach((m) => params.append("merchant", m));

  if (state.search) params.set("q", state.search);
  if (state.dateFrom) params.set("from", state.dateFrom);
  if (state.dateTo) params.set("to", state.dateTo);
  if (state.amountMin) params.set("min", state.amountMin);
  if (state.amountMax) params.set("max", state.amountMax);
  if (!state.includeRefunds) params.set("refunds", "0");
  if (!state.includeOutliers) params.set("outliers", "0");
  if (state.sort !== DEFAULT_FILTERS.sort) params.set("sort", state.sort);
  if (state.order !== DEFAULT_FILTERS.order) params.set("order", state.order);
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.pageSize !== DEFAULT_FILTERS.pageSize) params.set("pageSize", String(state.pageSize));

  return params.toString();
}

/* -------------------------------------------------------------------------- */
/* API params                                                                 */
/* -------------------------------------------------------------------------- */

/** The filter half of the query — shared by the table and the charts. */
export function toApiFilterParams(state: FilterState): Record<string, QueryValue> {
  return {
    category: state.categories,
    status: state.statuses,
    method: state.methods,
    merchant: state.merchants,
    q: state.search || undefined,
    date_from: state.dateFrom || undefined,
    date_to: state.dateTo || undefined,
    amount_min: state.amountMin || undefined,
    amount_max: state.amountMax || undefined,
    include_refunds: state.includeRefunds ? undefined : false,
    include_outliers: state.includeOutliers ? undefined : false,
  };
}

/** Filter params plus paging/sorting — the table only. */
export function toApiTableParams(state: FilterState): Record<string, QueryValue> {
  return {
    ...toApiFilterParams(state),
    sort: state.sort,
    order: state.order,
    page: state.page,
    page_size: state.pageSize,
  };
}

/* -------------------------------------------------------------------------- */
/* Introspection                                                              */
/* -------------------------------------------------------------------------- */

export interface ActiveFilterChip {
  key: keyof FilterState;
  label: string;
  value: string;
  /** Present for multi-select fields so one value can be removed at a time. */
  item?: string;
}

/** Flatten the filter state into removable chips for the "active filters" row. */
export function describeActiveFilters(state: FilterState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  state.categories.forEach((c) =>
    chips.push({ key: "categories", label: "Category", value: c, item: c }),
  );
  state.statuses.forEach((s) =>
    chips.push({ key: "statuses", label: "Status", value: titleCase(s), item: s }),
  );
  state.methods.forEach((m) =>
    chips.push({ key: "methods", label: "Method", value: m, item: m }),
  );
  state.merchants.forEach((m) =>
    chips.push({ key: "merchants", label: "Merchant", value: m, item: m }),
  );

  if (state.search) chips.push({ key: "search", label: "Search", value: `"${state.search}"` });

  if (state.dateFrom && state.dateTo) {
    chips.push({ key: "dateFrom", label: "Dates", value: `${state.dateFrom} → ${state.dateTo}` });
  } else if (state.dateFrom) {
    chips.push({ key: "dateFrom", label: "From", value: state.dateFrom });
  } else if (state.dateTo) {
    chips.push({ key: "dateTo", label: "Until", value: state.dateTo });
  }

  if (state.amountMin && state.amountMax) {
    chips.push({ key: "amountMin", label: "Amount", value: `₹${state.amountMin} – ₹${state.amountMax}` });
  } else if (state.amountMin) {
    chips.push({ key: "amountMin", label: "Min", value: `₹${state.amountMin}` });
  } else if (state.amountMax) {
    chips.push({ key: "amountMax", label: "Max", value: `₹${state.amountMax}` });
  }

  if (!state.includeRefunds) {
    chips.push({ key: "includeRefunds", label: "Refunds", value: "Hidden" });
  }
  if (!state.includeOutliers) {
    chips.push({ key: "includeOutliers", label: "Outliers", value: "Hidden" });
  }

  return chips;
}

export function countActiveFilters(state: FilterState): number {
  return describeActiveFilters(state).length;
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
