/**
 * Types mirroring the FastAPI response models.
 *
 * Written by hand against the generated OpenAPI schema at /docs rather than
 * code-generated, so the frontend keeps a small, readable surface instead of a
 * thousand-line generated file. Any drift shows up immediately in `tsc`.
 */

export type PaymentStatus = "SUCCESS" | "FAILED" | "PENDING";
export type PaymentMethod = "Credit Card" | "Debit Card" | "UPI" | "Netbanking";
export type SortField = "date" | "amount" | "merchant";
export type SortOrder = "asc" | "desc";

export interface Transaction {
  id: number;
  /** The id from the source file. NOT unique — 40 collide. Use `id`. */
  external_id: string;
  occurred_at: string;
  merchant: string;
  category: string;
  category_slug: string;
  category_color: string;
  /** Serialised as a string by Pydantic to avoid float precision loss. */
  amount: string;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  is_refund: boolean;
  is_outlier: boolean;
  category_backfilled: boolean;
  has_duplicate_external_id: boolean;
  source_ts_format: string;
  coins_earned: number;
}

export interface TransactionDetail {
  transaction: Transaction;
  id_collisions: Transaction[];
}

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  sort: SortField;
  order: SortOrder;
}

export interface CategoryFacet {
  name: string;
  slug: string;
  color: string;
  count: number;
}

export interface MerchantFacet {
  name: string;
  count: number;
}

export interface ValueFacet {
  value: string;
  count: number;
}

export interface Facets {
  categories: CategoryFacet[];
  merchants: MerchantFacet[];
  statuses: ValueFacet[];
  methods: ValueFacet[];
  bounds: {
    min_date: string | null;
    max_date: string | null;
    min_amount: string | null;
    max_amount: string | null;
    total: number;
  };
}

export interface SpendSummary {
  txn_count: number;
  total_spend: string;
  spend_count: number;
  total_refunded: string;
  refund_count: number;
  failed_count: number;
  pending_count: number;
  outlier_count: number;
  coins_earned: number;
  merchant_count: number;
  avg_transaction: string;
}

export interface CategorySlice {
  category: string;
  slug: string;
  color: string;
  total: string;
  count: number;
  average: string;
  share: number;
}

export interface MonthPoint {
  month: string;
  label: string;
  total: string;
  count: number;
  coins: number;
}

export interface MerchantRow {
  merchant: string;
  category: string;
  color: string;
  total: string;
  count: number;
}

export interface StatusSlice {
  status: PaymentStatus;
  count: number;
  total: string;
}

export interface Analytics {
  summary: SpendSummary;
  by_category: CategorySlice[];
  by_month: MonthPoint[];
  top_merchants: MerchantRow[];
  by_status: StatusSlice[];
  filters_active: boolean;
}

export interface Balance {
  user: { id: number; name: string; email: string; card_last4: string };
  balance: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
  earning_transactions: number;
}

export interface Reward {
  id: number;
  sku: string;
  title: string;
  description: string;
  coin_cost: number;
  value_inr: number;
  icon: string;
  accent: string;
  is_active: boolean;
  stock: number | null;
  stock_remaining: number | null;
  redeemed_count: number;
  affordable: boolean;
  sold_out: boolean;
  coins_short: number;
}

export interface Catalogue {
  balance: number;
  items: Reward[];
}

export interface Redemption {
  id: number;
  coin_cost: number;
  code: string;
  status: "CONFIRMED" | "REVERSED";
  created_at: string;
  reward_title: string | null;
  reward_icon: string | null;
  value_inr: number | null;
}

export interface RedeemResponse {
  redemption: Redemption;
  balance: number;
  replayed: boolean;
}

export interface LedgerEntry {
  id: number;
  delta: number;
  reason: "EARN" | "REDEEM" | "REVERSAL" | "ADJUSTMENT";
  note: string | null;
  created_at: string;
  reward_title: string | null;
  merchant: string | null;
}

export interface Activity {
  ledger: LedgerEntry[];
  redemptions: Redemption[];
}

export interface DataQuality {
  live: {
    total: number;
    refunds: number;
    outliers: number;
    backfilled: number;
    duplicate_id_rows: number;
    duplicate_ids: number;
    uncategorised: number;
  };
  timestamp_formats: { format: string; count: number }[];
  last_ingest: {
    rows_read: number;
    rows_loaded: number;
    rows_rejected: number;
    finished_at: string;
    report: Record<string, unknown>;
  } | null;
  rules: {
    rupees_per_coin: number;
    max_coins_per_transaction: number;
    earning_status: string;
  };
  notes: string[];
}
