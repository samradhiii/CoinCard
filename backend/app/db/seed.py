"""One-command database seed.

    python -m app.db.seed --file ../data/transactions.json --reset

Creates the schema, normalises and loads the transaction feed, awards coins,
and records a data-quality report. Safe to re-run: ``--reset`` truncates first,
and without it the script refuses to double-load.

Everything printed at the end is derived from the actual file, not hardcoded, so
the report is a live description of the data rather than a stale comment.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from psycopg import Connection, sql

from app.db.pool import read_schema_sql, sync_connection
from app.domain import coins as coin_rules
from app.domain.normalize import (
    IngestReport,
    NormalizationError,
    NormalizedTransaction,
    backfill_categories,
    build_merchant_category_map,
    flag_duplicate_external_ids,
    normalize_row,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed")

DEFAULT_DATA_FILE = Path(__file__).resolve().parents[3] / "data" / "transactions.json"

# Stable, colour-blind-friendly hue per category. Stored in the DB so the chart,
# the table badge and the legend can never disagree about a category's colour.
CATEGORY_PALETTE: dict[str, tuple[str, str, int]] = {
    "Travel":         ("travel",        "#6366F1", 1),
    "Shopping":       ("shopping",      "#EC4899", 2),
    "Utilities":      ("utilities",     "#0EA5E9", 3),
    "Food & Dining":  ("food-dining",   "#F97316", 4),
    "Groceries":      ("groceries",     "#84CC16", 5),
    "Health":         ("health",        "#10B981", 6),
    "Education":      ("education",     "#8B5CF6", 7),
    "Entertainment":  ("entertainment", "#F43F5E", 8),
    "Fuel":           ("fuel",          "#EAB308", 9),
    "Insurance":      ("insurance",     "#14B8A6", 10),
}
FALLBACK_COLOR = "#94A3B8"

DEMO_USER = {
    "email": "aarav@coincard.app",
    "full_name": "Aarav Sharma",
    "card_last4": "4291",
}

# Six rewards. The last one is deliberately priced above the balance this
# dataset can produce (~362,729 coins) so the "cannot afford" path — the 409 the
# brief asks the backend to return — is demonstrable in the live UI.
REWARDS: list[dict[str, Any]] = [
    {
        "sku": "SPOTIFY_1M",
        "title": "Spotify Premium — 1 Month",
        "description": "One month of ad-free listening, credited to your registered number.",
        "coin_cost": 1_200,
        "value_inr": 149,
        "icon": "🎧",
        "accent": "violet",
        "stock": None,
        "sort_order": 1,
    },
    {
        "sku": "SWIGGY_250",
        "title": "₹250 Swiggy Voucher",
        "description": "Valid on orders above ₹399. Single use, expires in 90 days.",
        "coin_cost": 2_500,
        "value_inr": 250,
        "icon": "🍜",
        "accent": "orange",
        "stock": None,
        "sort_order": 2,
    },
    {
        "sku": "AMAZON_500",
        "title": "₹500 Amazon Gift Card",
        "description": "Redeemable across Amazon.in. Delivered to your email instantly.",
        "coin_cost": 5_000,
        "value_inr": 500,
        "icon": "📦",
        "accent": "sky",
        "stock": None,
        "sort_order": 3,
    },
    {
        "sku": "CASHBACK_1000",
        "title": "₹1,000 Statement Cashback",
        "description": "Applied directly to your next credit-card statement.",
        "coin_cost": 9_500,
        "value_inr": 1_000,
        "icon": "💸",
        "accent": "emerald",
        "stock": None,
        "sort_order": 4,
    },
    {
        "sku": "MMT_2500",
        "title": "₹2,500 MakeMyTrip Flight Credit",
        "description": "Valid on domestic flight bookings above ₹6,000.",
        "coin_cost": 22_000,
        "value_inr": 2_500,
        "icon": "✈️",
        "accent": "indigo",
        # Finite stock so the "sold out" 409 branch is real, not theoretical.
        "stock": 25,
        "sort_order": 5,
    },
    {
        "sku": "LOUNGE_ANNUAL",
        "title": "Annual Fee Waiver + Lounge Pack",
        "description": "Waives next year's card fee and adds 8 domestic lounge visits.",
        "coin_cost": 400_000,
        "value_inr": 12_000,
        "icon": "🛋️",
        "accent": "amber",
        "stock": None,
        "sort_order": 6,
    },
]


# --------------------------------------------------------------------------- #
# Load + normalise
# --------------------------------------------------------------------------- #


def load_and_normalize(path: Path) -> tuple[list[NormalizedTransaction], IngestReport]:
    raw_rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw_rows, list):
        raise SystemExit(f"expected a JSON array at the top level of {path}")

    report = IngestReport(rows_read=len(raw_rows))
    rows: list[NormalizedTransaction] = []

    for index, raw in enumerate(raw_rows):
        if not isinstance(raw, dict):
            report.rejected.append({"index": index, "reason": "row is not an object"})
            continue
        try:
            rows.append(normalize_row(raw, report))
        except NormalizationError as exc:
            # Rejected rows are recorded, never silently dropped.
            report.rejected.append(
                {"index": index, "id": raw.get("id"), "reason": str(exc)}
            )

    merchant_categories = build_merchant_category_map(rows)
    backfill_categories(rows, merchant_categories, report)
    flag_duplicate_external_ids(rows, report)

    report.rows_loaded = len(rows)
    report.merchants = len({r.merchant for r in rows})
    report.categories = len({r.category for r in rows if r.category})
    return rows, report


def award_coins(rows: list[NormalizedTransaction], report: IngestReport) -> dict[int, int]:
    """Compute coins per row index and update the report totals."""
    earned: dict[int, int] = {}
    for i, row in enumerate(rows):
        coins = coin_rules.coins_for_transaction(
            row.amount, row.status, is_outlier=row.is_outlier
        )
        earned[i] = coins
        report.coins_awarded += coins
        if coin_rules.is_capped(row.amount, row.status, is_outlier=row.is_outlier):
            report.coins_capped_transactions += 1
    return earned


# --------------------------------------------------------------------------- #
# Write
# --------------------------------------------------------------------------- #


def apply_schema(conn: Connection, *, reset: bool) -> None:
    with conn.cursor() as cur:
        if reset:
            logger.info("  dropping existing objects (--reset)")
            cur.execute(
                """
                DROP VIEW  IF EXISTS v_transactions CASCADE;
                DROP TABLE IF EXISTS coin_ledger, redemptions, ingest_runs,
                                     transactions, rewards, merchants,
                                     categories, users CASCADE;
                DROP TYPE  IF EXISTS payment_status, payment_method,
                                     redemption_status, ledger_reason CASCADE;
                """
            )
        cur.execute(read_schema_sql())


def table_has_rows(conn: Connection, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("SELECT EXISTS (SELECT 1 FROM {} LIMIT 1) AS present").format(
                sql.Identifier(table)
            )
        )
        row = cur.fetchone()
        return bool(row and row["present"])


def upsert_categories(conn: Connection, names: set[str]) -> dict[str, int]:
    ordered = sorted(names, key=lambda n: (CATEGORY_PALETTE.get(n, ("", "", 99))[2], n))
    with conn.cursor() as cur:
        for name in ordered:
            slug, color, order = CATEGORY_PALETTE.get(
                name, (name.lower().replace(" & ", "-").replace(" ", "-"), FALLBACK_COLOR, 99)
            )
            cur.execute(
                """
                INSERT INTO categories (name, slug, color_token, sort_order)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (name) DO UPDATE
                    SET slug = EXCLUDED.slug,
                        color_token = EXCLUDED.color_token,
                        sort_order = EXCLUDED.sort_order
                """,
                (name, slug, color, order),
            )
        cur.execute("SELECT name, id FROM categories")
        return {r["name"]: r["id"] for r in cur.fetchall()}


def upsert_merchants(
    conn: Connection, merchant_categories: dict[str, str], category_ids: dict[str, int]
) -> dict[str, int]:
    with conn.cursor() as cur:
        for merchant in sorted(merchant_categories):
            cur.execute(
                """
                INSERT INTO merchants (name, default_category_id)
                VALUES (%s, %s)
                ON CONFLICT (name) DO UPDATE
                    SET default_category_id = EXCLUDED.default_category_id
                """,
                (merchant, category_ids.get(merchant_categories[merchant])),
            )
        cur.execute("SELECT name, id FROM merchants")
        return {r["name"]: r["id"] for r in cur.fetchall()}


def copy_transactions(
    conn: Connection,
    rows: list[NormalizedTransaction],
    merchant_ids: dict[str, int],
    category_ids: dict[str, int],
    coins: dict[int, int],
) -> None:
    """Bulk-load via COPY. 10k INSERTs would work but COPY is ~10x faster."""
    columns = (
        "external_id, occurred_at, merchant_id, category_id, amount, currency, "
        "status, method, is_refund, is_outlier, category_backfilled, "
        "source_ts_format, has_duplicate_external_id, coins_earned"
    )
    with conn.cursor() as cur:
        with cur.copy(f"COPY transactions ({columns}) FROM STDIN") as copy:
            for i, row in enumerate(rows):
                copy.write_row(
                    (
                        row.external_id,
                        row.occurred_at,
                        merchant_ids[row.merchant],
                        category_ids.get(row.category) if row.category else None,
                        row.amount,
                        row.currency,
                        row.status,
                        row.method,
                        row.is_refund,
                        row.is_outlier,
                        row.category_backfilled,
                        row.source_ts_format,
                        row.has_duplicate_external_id,
                        coins[i],
                    )
                )


def seed_user(conn: Connection) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO users (email, full_name, card_last4)
            VALUES (%(email)s, %(full_name)s, %(card_last4)s)
            ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
            RETURNING id
            """,
            DEMO_USER,
        )
        return cur.fetchone()["id"]


def seed_rewards(conn: Connection) -> None:
    with conn.cursor() as cur:
        for reward in REWARDS:
            cur.execute(
                """
                INSERT INTO rewards (sku, title, description, coin_cost, value_inr,
                                     icon, accent, stock, sort_order)
                VALUES (%(sku)s, %(title)s, %(description)s, %(coin_cost)s,
                        %(value_inr)s, %(icon)s, %(accent)s, %(stock)s, %(sort_order)s)
                ON CONFLICT (sku) DO UPDATE SET
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    coin_cost = EXCLUDED.coin_cost,
                    value_inr = EXCLUDED.value_inr,
                    icon = EXCLUDED.icon,
                    accent = EXCLUDED.accent,
                    stock = EXCLUDED.stock,
                    sort_order = EXCLUDED.sort_order
                """,
                reward,
            )


def post_earn_ledger(conn: Connection, user_id: int) -> int:
    """Write one EARN row per coin-earning transaction, set-based.

    ``ON CONFLICT DO NOTHING`` leans on the partial unique index so re-running
    the seed can never double-credit the user.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO coin_ledger (user_id, delta, reason, transaction_id, note)
            SELECT %s, t.coins_earned, 'EARN', t.id,
                   'Earned on ' || to_char(t.occurred_at, 'DD Mon YYYY')
            FROM transactions t
            WHERE t.coins_earned > 0
            ON CONFLICT (transaction_id) WHERE reason = 'EARN' DO NOTHING
            """,
            (user_id,),
        )
        return cur.rowcount


def record_ingest_run(
    conn: Connection, source: Path, report: IngestReport, started: datetime
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ingest_runs (source_file, rows_read, rows_loaded,
                                     rows_rejected, report, started_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                source.name,
                report.rows_read,
                report.rows_loaded,
                len(report.rejected),
                json.dumps(report.as_dict()),
                started,
            ),
        )


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


def print_report(report: IngestReport, balance: int, elapsed: float) -> None:
    d = report.as_dict()
    line = "─" * 64
    logger.info("\n%s\n  CoinCard seed complete in %.2fs\n%s", line, elapsed, line)
    logger.info("  Rows read .................... %s", f"{d['rows_read']:,}")
    logger.info("  Rows loaded .................. %s", f"{d['rows_loaded']:,}")
    logger.info("  Rows rejected ................ %s", f"{d['rows_rejected']:,}")
    logger.info("  Merchants / categories ....... %s / %s",
                d["distinct_merchants"], d["distinct_categories"])

    logger.info("\n  Timestamp formats normalised to UTC")
    for fmt, count in sorted(d["timestamp_formats"].items(), key=lambda kv: -kv[1]):
        logger.info("    %-14s %s", fmt, f"{count:,}")

    logger.info("\n  Data repaired")
    logger.info("    amounts coerced from string .. %s", d["amount_coerced_from_string"])
    logger.info("    status case normalised ....... %s", d["status_case_normalised"])
    logger.info("    categories backfilled ........ %s  (missing key %s / null %s / empty %s)",
                d["category_backfilled"], d["category_missing_key"],
                d["category_null"], d["category_empty"])
    logger.info("    categories unresolved ........ %s", d["category_unresolved"])

    logger.info("\n  Data flagged (kept, excluded from spend analytics)")
    logger.info("    refunds (negative amount) .... %s", d["refund_rows"])
    logger.info("    corrupt-magnitude outliers ... %s", d["outlier_rows"])
    logger.info("    rows with duplicate id ....... %s across %s ids",
                d["duplicate_external_id_rows"], d["duplicate_external_ids"])

    logger.info("\n  Rewards")
    logger.info("    coins awarded ................ %s", f"{d['coins_awarded']:,}")
    logger.info("    transactions hitting the cap . %s (cap = %s coins/txn)",
                f"{d['transactions_hitting_coin_cap']:,}",
                coin_rules.MAX_COINS_PER_TRANSACTION)
    logger.info("    opening balance .............. %s coins", f"{balance:,}")
    logger.info("%s\n", line)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed the CoinCard database.")
    parser.add_argument("--file", type=Path, default=DEFAULT_DATA_FILE,
                        help="path to transactions.json")
    parser.add_argument("--reset", action="store_true",
                        help="drop and recreate all objects before loading")
    parser.add_argument("--dsn", default=None, help="override DATABASE_URL")
    args = parser.parse_args(argv)

    source: Path = args.file
    if not source.exists():
        logger.error("data file not found: %s", source)
        return 1

    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()

    logger.info("→ reading %s", source)
    rows, report = load_and_normalize(source)
    logger.info("  normalised %s rows (%s rejected)", f"{len(rows):,}", len(report.rejected))

    coins = award_coins(rows, report)

    with sync_connection(args.dsn) as conn:
        logger.info("→ applying schema")
        apply_schema(conn, reset=args.reset)

        if not args.reset and table_has_rows(conn, "transactions"):
            conn.rollback()
            logger.error(
                "transactions table already has rows. Re-run with --reset to reload."
            )
            return 2

        logger.info("→ loading reference data")
        merchant_categories = build_merchant_category_map(rows)
        category_ids = upsert_categories(conn, {r.category for r in rows if r.category})
        merchant_ids = upsert_merchants(conn, merchant_categories, category_ids)

        logger.info("→ COPYing %s transactions", f"{len(rows):,}")
        copy_transactions(conn, rows, merchant_ids, category_ids, coins)

        logger.info("→ seeding user + rewards catalogue")
        user_id = seed_user(conn)
        seed_rewards(conn)

        logger.info("→ posting coin ledger")
        ledger_rows = post_earn_ledger(conn, user_id)
        logger.info("  %s EARN entries written", f"{ledger_rows:,}")

        record_ingest_run(conn, source, report, started)
        conn.commit()

        with conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(SUM(delta), 0)::int AS balance "
                "FROM coin_ledger WHERE user_id = %s",
                (user_id,),
            )
            balance = cur.fetchone()["balance"]

    print_report(report, balance, time.perf_counter() - t0)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
