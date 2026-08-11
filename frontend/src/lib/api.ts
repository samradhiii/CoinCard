/**
 * Typed fetch client.
 *
 * Every network call in the app goes through `request()`, which gives one place
 * to handle the API's error envelope. That matters most for redeem: the UI
 * needs the machine-readable `code` (`insufficient_balance` vs `not_found`) to
 * roll back optimistically and show the right message, not a generic
 * "something went wrong".
 */

import type {
  Activity,
  Analytics,
  Balance,
  Catalogue,
  DataQuality,
  Facets,
  Page,
  RedeemResponse,
  Transaction,
  TransactionDetail,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/** Error carrying the server's status + code so callers can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the user simply cannot afford this — a normal, expected state. */
  get isInsufficientBalance(): boolean {
    return this.code === "insufficient_balance";
  }

  get isUnavailable(): boolean {
    return this.code === "reward_unavailable";
  }

  /** Network failures and 5xx are worth retrying; 4xx are not. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

interface RequestOptions extends RequestInit {
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (cause) {
    // fetch() only rejects on network-level failure, never on a 4xx/5xx.
    if ((cause as Error)?.name === "AbortError") throw cause;
    throw new ApiError(0, "network_error", "Can't reach the server. Is the API running?");
  }

  if (!response.ok) {
    let code = "http_error";
    let message = `Request failed with status ${response.status}.`;
    let details: Record<string, unknown> = {};

    try {
      const body = await response.json();
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        details = body.error.details ?? {};
      } else if (body?.detail) {
        // FastAPI's own validation errors use `detail`.
        code = "validation_error";
        message = Array.isArray(body.detail)
          ? (body.detail[0]?.msg ?? message)
          : String(body.detail);
      }
    } catch {
      /* non-JSON error body — keep the generic message */
    }

    throw new ApiError(response.status, code, message, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Query-string building                                                      */
/* -------------------------------------------------------------------------- */

export type QueryValue = string | number | boolean | null | undefined | string[];

export function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      // Repeated keys (?category=A&category=B) — the API accepts this and CSV.
      value.filter(Boolean).forEach((v) => search.append(key, v));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

export const api = {
  transactions: {
    list: (params: Record<string, QueryValue>, signal?: AbortSignal) =>
      request<Page<Transaction>>(`/api/transactions${toQueryString(params)}`, { signal }),

    detail: (id: number, signal?: AbortSignal) =>
      request<TransactionDetail>(`/api/transactions/${id}`, { signal }),

    facets: (signal?: AbortSignal) =>
      request<Facets>("/api/transactions/facets", { signal }),
  },

  analytics: {
    overview: (params: Record<string, QueryValue>, signal?: AbortSignal) =>
      request<Analytics>(`/api/analytics${toQueryString(params)}`, { signal }),
  },

  rewards: {
    balance: (signal?: AbortSignal) =>
      request<Balance>("/api/rewards/balance", { signal }),

    catalogue: (signal?: AbortSignal) =>
      request<Catalogue>("/api/rewards/catalogue", { signal }),

    activity: (signal?: AbortSignal) =>
      request<Activity>("/api/rewards/activity", { signal }),

    redeem: (rewardId: number, idempotencyKey?: string) =>
      request<RedeemResponse>("/api/rewards/redeem", {
        method: "POST",
        body: JSON.stringify({ reward_id: rewardId, idempotency_key: idempotencyKey }),
      }),
  },

  meta: {
    dataQuality: (signal?: AbortSignal) =>
      request<DataQuality>("/api/meta/data-quality", { signal }),
  },
};
