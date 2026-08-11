-- ============================================================================
--  CoinCard — schema
--  PostgreSQL 18 (16+ compatible)
--
--  Design notes
--  ------------
--  * The source JSON is NOT dumped into a jsonb blob. Merchants and categories
--    are lookup tables, transactions reference them by FK, and every messy
--    source value (5 timestamp formats, stringly-typed amounts, lowercase
--    status) is normalised into a real typed column at ingest time.
--  * `transactions.external_id` is the id from the source file. It is NOT the
--    primary key: 40 ids appear twice in the dataset with entirely different
--    payloads, so a surrogate bigserial is the PK and external_id is merely
--    indexed. See ASSUMPTIONS.md.
--  * Coin balance is derived from an append-only ledger rather than a mutable
--    integer column, so a redemption can never silently corrupt the balance and
--    every coin is traceable to the transaction or redemption that moved it.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- enum types
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('SUCCESS', 'FAILED', 'PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('Credit Card', 'Debit Card', 'UPI', 'Netbanking');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE redemption_status AS ENUM ('CONFIRMED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_reason AS ENUM ('EARN', 'REDEEM', 'REVERSAL', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------- users
-- Single-user demo app; the table exists so rewards/ledger rows are owned by
-- something real and the redeem path can take a proper per-user row lock.
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT        NOT NULL UNIQUE,
    full_name   TEXT        NOT NULL,
    card_last4  CHAR(4)     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- categories
CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    -- Stable per-category hue so the chart, the badge and the legend always
    -- agree on a colour regardless of sort order.
    color_token TEXT NOT NULL,
    sort_order  SMALLINT NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------- merchants
CREATE TABLE IF NOT EXISTS merchants (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    -- In this dataset every merchant maps to exactly one category, which is how
    -- the 200 rows with a missing/null/empty category get backfilled. It is a
    -- *default*, not a constraint — a transaction may still override it.
    default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_name_trgm
    ON merchants USING gin (name gin_trgm_ops);

-- ------------------------------------------------------------ transactions
CREATE TABLE IF NOT EXISTS transactions (
    id              BIGSERIAL PRIMARY KEY,
    external_id     TEXT           NOT NULL,
    occurred_at     TIMESTAMPTZ    NOT NULL,
    merchant_id     INTEGER        NOT NULL REFERENCES merchants(id),
    category_id     INTEGER            NULL REFERENCES categories(id),
    amount          NUMERIC(14, 2) NOT NULL,
    currency        CHAR(3)        NOT NULL DEFAULT 'INR',
    status          payment_status NOT NULL,
    method          payment_method NOT NULL,

    -- ---- data-quality flags, set once at ingest so the API never re-derives
    -- them per request and the UI can be honest about what it is showing ----

    -- amount < 0 : a refund/reversal, not spend. Excluded from spend totals and
    -- earns no coins, but still shown in the table.
    is_refund       BOOLEAN NOT NULL DEFAULT FALSE,
    -- A single ₹999,999,999 row that is ~28,000x the p99. Kept, flagged, and
    -- excluded from analytics by default so one bad row cannot flatten a chart.
    is_outlier      BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE when category came from merchants.default_category_id, not the file.
    category_backfilled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Which of the 5 source timestamp shapes this row arrived as.
    source_ts_format    TEXT    NOT NULL,
    -- TRUE when external_id collides with another row.
    has_duplicate_external_id BOOLEAN NOT NULL DEFAULT FALSE,

    coins_earned    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_currency_len CHECK (char_length(currency) = 3)
);

-- Sorting/filtering indexes. The composite ones exist because the table is
-- always sorted by date or amount and paged with a stable tiebreaker on id.
CREATE INDEX IF NOT EXISTS idx_txn_occurred_at   ON transactions (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_txn_amount        ON transactions (amount DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_txn_status        ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_txn_category      ON transactions (category_id);
CREATE INDEX IF NOT EXISTS idx_txn_merchant      ON transactions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_txn_external_id   ON transactions (external_id);
-- Analytics group the monthly trend by this expression; indexing it keeps the
-- trend query off a full re-computation per row.
--
-- `AT TIME ZONE 'UTC'` is required, not cosmetic: date_trunc() over a
-- timestamptz is only STABLE (its result depends on the session TimeZone), and
-- Postgres refuses to index a non-IMMUTABLE expression. Casting to a plain UTC
-- timestamp first makes it IMMUTABLE — and also makes month bucketing
-- deterministic regardless of the server's timezone, which is what we want
-- given every row was normalised to UTC at ingest. The analytics query uses
-- the identical expression so it can actually use this index.
CREATE INDEX IF NOT EXISTS idx_txn_month
    ON transactions (date_trunc('month', occurred_at AT TIME ZONE 'UTC'));
-- Most analytics/table queries exclude refunds and the outlier; a partial index
-- on the "clean spend" subset keeps those scans small.
CREATE INDEX IF NOT EXISTS idx_txn_clean_spend
    ON transactions (occurred_at DESC)
    WHERE is_refund = FALSE AND is_outlier = FALSE;

-- ----------------------------------------------------------- reward catalog
CREATE TABLE IF NOT EXISTS rewards (
    id          SERIAL PRIMARY KEY,
    sku         TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL,
    coin_cost   INTEGER NOT NULL CHECK (coin_cost > 0),
    value_inr   INTEGER NOT NULL CHECK (value_inr >= 0),
    icon        TEXT    NOT NULL DEFAULT '🎁',
    accent      TEXT    NOT NULL DEFAULT 'brand',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    -- NULL = unlimited. Lets the backend reject a sold-out reward with 409.
    stock       INTEGER     NULL CHECK (stock IS NULL OR stock >= 0),
    sort_order  SMALLINT NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------- redemptions
CREATE TABLE IF NOT EXISTS redemptions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id   INTEGER NOT NULL REFERENCES rewards(id),
    -- Price is copied, not joined: the catalogue can be repriced later without
    -- rewriting what the user actually paid.
    coin_cost   INTEGER NOT NULL CHECK (coin_cost > 0),
    status      redemption_status NOT NULL DEFAULT 'CONFIRMED',
    -- Voucher-style code handed back to the UI on success.
    code        TEXT    NOT NULL,
    -- Client-supplied key makes retrying a redeem safe: a duplicate submit
    -- returns the original redemption instead of charging twice.
    idempotency_key TEXT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_redemption_idem UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions (user_id, created_at DESC);

-- ------------------------------------------------------------- coin ledger
-- Append-only. Balance = SUM(delta). Never UPDATE a row here.
CREATE TABLE IF NOT EXISTS coin_ledger (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta         INTEGER      NOT NULL CHECK (delta <> 0),
    reason        ledger_reason NOT NULL,
    transaction_id BIGINT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    redemption_id  BIGINT NULL REFERENCES redemptions(id)  ON DELETE CASCADE,
    note          TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- An EARN entry must point at the transaction that produced it; a
    -- REDEEM/REVERSAL must point at the redemption. Keeps the ledger auditable.
    CONSTRAINT chk_ledger_source CHECK (
        (reason = 'EARN'       AND transaction_id IS NOT NULL AND delta > 0) OR
        (reason = 'REDEEM'     AND redemption_id  IS NOT NULL AND delta < 0) OR
        (reason = 'REVERSAL'   AND redemption_id  IS NOT NULL AND delta > 0) OR
        (reason = 'ADJUSTMENT')
    )
);

CREATE INDEX IF NOT EXISTS idx_ledger_user   ON coin_ledger (user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_recent ON coin_ledger (user_id, created_at DESC);
-- One EARN row per transaction, enforced by the database rather than by hoping
-- the seed script is only ever run once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_earn_per_txn
    ON coin_ledger (transaction_id) WHERE reason = 'EARN';

-- --------------------------------------------------------- ingest reporting
-- Every seed run records what it had to clean. Surfaced at /api/meta/data-quality
-- so the UI can tell the truth about the dataset instead of quietly hiding it.
CREATE TABLE IF NOT EXISTS ingest_runs (
    id           BIGSERIAL PRIMARY KEY,
    source_file  TEXT        NOT NULL,
    rows_read    INTEGER     NOT NULL,
    rows_loaded  INTEGER     NOT NULL,
    rows_rejected INTEGER    NOT NULL DEFAULT 0,
    report       JSONB       NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- views
-- Convenience view used by the transaction list/detail queries so the join and
-- the display-name coalescing live in one place.
CREATE OR REPLACE VIEW v_transactions AS
SELECT
    t.id,
    t.external_id,
    t.occurred_at,
    m.name                       AS merchant,
    COALESCE(c.name, 'Uncategorised') AS category,
    c.slug                       AS category_slug,
    c.color_token                AS category_color,
    t.category_id,
    t.merchant_id,
    t.amount,
    t.currency,
    t.status,
    t.method,
    t.is_refund,
    t.is_outlier,
    t.category_backfilled,
    t.has_duplicate_external_id,
    t.source_ts_format,
    t.coins_earned
FROM transactions t
JOIN merchants  m ON m.id = t.merchant_id
LEFT JOIN categories c ON c.id = t.category_id;
