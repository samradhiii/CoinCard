"""Aggregate queries behind the spend charts.

Every aggregate accepts the *same* :class:`TransactionFilters` the table uses,
which is what makes cross-filtering two-way: narrow the table and the charts
reshape, click a chart and the table narrows, both from one predicate.

All aggregation happens in Postgres. Shipping 10k rows to the browser to sum
them there would work at this size and fall over at 10x it.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from psycopg import AsyncConnection

from app.repositories.filters import TransactionFilters, build_where

_FROM = """
FROM transactions t
JOIN merchants m       ON m.id = t.merchant_id
LEFT JOIN categories c ON c.id = t.category_id
"""


async def spend_summary(conn: AsyncConnection, filters: TransactionFilters) -> dict[str, Any]:
    """Headline KPIs for the current filter set.

    ``FILTER (WHERE ...)`` keeps spend, refunds and failures in one pass instead
    of four round trips.
    """
    where, params = build_where(filters)
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT
                COUNT(*)                                                     AS txn_count,
                COALESCE(SUM(t.amount) FILTER (
                    WHERE t.is_refund = FALSE AND t.is_outlier = FALSE
                      AND t.status = 'SUCCESS'), 0)                          AS total_spend,
                COUNT(*) FILTER (
                    WHERE t.is_refund = FALSE AND t.is_outlier = FALSE
                      AND t.status = 'SUCCESS')                              AS spend_count,
                COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.is_refund)), 0)   AS total_refunded,
                COUNT(*) FILTER (WHERE t.is_refund)                          AS refund_count,
                COUNT(*) FILTER (WHERE t.status = 'FAILED')                  AS failed_count,
                COUNT(*) FILTER (WHERE t.status = 'PENDING')                 AS pending_count,
                COUNT(*) FILTER (WHERE t.is_outlier)                         AS outlier_count,
                COALESCE(SUM(t.coins_earned), 0)                             AS coins_earned,
                COUNT(DISTINCT m.name)                                       AS merchant_count
            {_FROM}
            {where}
            """,
            params,
        )
        row = await cur.fetchone() or {}

    spend = row.get("total_spend") or Decimal(0)
    count = row.get("spend_count") or 0
    # Quantise: raw Decimal division yields 28 significant digits, which would
    # be serialised verbatim into JSON as an absurd ₹7171.733079412784649173...
    row["avg_transaction"] = (
        (Decimal(spend) / count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if count
        else Decimal("0.00")
    )
    return row


async def spend_by_category(
    conn: AsyncConnection, filters: TransactionFilters
) -> list[dict[str, Any]]:
    """Category breakdown — the donut chart.

    ``spend_only`` drops refunds and the corrupt row: a category chart is about
    money going out, and one ₹999,999,999 row would otherwise render every other
    slice invisible.
    """
    where, params = build_where(filters, spend_only=True)
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT
                COALESCE(c.name, 'Uncategorised')  AS category,
                COALESCE(c.slug, 'uncategorised')  AS slug,
                COALESCE(c.color_token, '#94A3B8') AS color,
                SUM(t.amount)                      AS total,
                COUNT(*)                           AS count,
                AVG(t.amount)                      AS average
            {_FROM}
            {where}
              AND t.status = 'SUCCESS'
            GROUP BY c.name, c.slug, c.color_token
            ORDER BY SUM(t.amount) DESC
            """,
            params,
        )
        return await cur.fetchall()


async def spend_by_month(
    conn: AsyncConnection, filters: TransactionFilters
) -> list[dict[str, Any]]:
    """Monthly trend — the area/bar chart.

    ``generate_series`` fills months with no matching transactions so the line
    shows a genuine dip rather than silently closing the gap.
    """
    where, params = build_where(filters, spend_only=True)
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            WITH filtered AS (
                -- AT TIME ZONE 'UTC' matches idx_txn_month exactly (see
                -- schema.sql) and keeps bucketing independent of server TZ.
                SELECT date_trunc('month', t.occurred_at AT TIME ZONE 'UTC') AS month,
                       t.amount, t.coins_earned
                {_FROM}
                {where}
                  AND t.status = 'SUCCESS'
            ),
            bounds AS (
                SELECT MIN(month) AS lo, MAX(month) AS hi FROM filtered
            ),
            months AS (
                SELECT generate_series(lo, hi, INTERVAL '1 month') AS month
                FROM bounds WHERE lo IS NOT NULL
            )
            SELECT
                to_char(mo.month, 'YYYY-MM')                  AS month,
                to_char(mo.month, 'Mon YYYY')                 AS label,
                COALESCE(SUM(f.amount), 0)                    AS total,
                COUNT(f.amount)                               AS count,
                COALESCE(SUM(f.coins_earned), 0)              AS coins
            FROM months mo
            LEFT JOIN filtered f ON f.month = mo.month
            GROUP BY mo.month
            ORDER BY mo.month
            """,
            params,
        )
        return await cur.fetchall()


async def top_merchants(
    conn: AsyncConnection, filters: TransactionFilters, limit: int = 8
) -> list[dict[str, Any]]:
    where, params = build_where(filters, spend_only=True)
    params["limit"] = limit
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT
                m.name                             AS merchant,
                COALESCE(c.name, 'Uncategorised')  AS category,
                COALESCE(c.color_token, '#94A3B8') AS color,
                SUM(t.amount)                      AS total,
                COUNT(*)                           AS count
            {_FROM}
            {where}
              AND t.status = 'SUCCESS'
            GROUP BY m.name, c.name, c.color_token
            ORDER BY SUM(t.amount) DESC
            LIMIT %(limit)s
            """,
            params,
        )
        return await cur.fetchall()


async def status_split(
    conn: AsyncConnection, filters: TransactionFilters
) -> list[dict[str, Any]]:
    """Success/failed/pending mix — includes refunds, excludes the outlier."""
    where, params = build_where(filters)
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT t.status::text AS status,
                   COUNT(*)       AS count,
                   COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.is_outlier = FALSE), 0) AS total
            {_FROM}
            {where}
            GROUP BY t.status
            ORDER BY COUNT(*) DESC
            """,
            params,
        )
        return await cur.fetchall()
