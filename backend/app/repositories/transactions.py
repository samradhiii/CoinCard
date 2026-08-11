"""Data access for transactions. SQL lives here and nowhere else."""

from __future__ import annotations

from typing import Any

from psycopg import AsyncConnection

from app.repositories.filters import TransactionFilters, build_order_by, build_where

# The projection is identical for list and detail so the frontend can reuse one
# TypeScript type for a row and for the drawer.
_SELECT_COLUMNS = """
    t.id,
    t.external_id,
    t.occurred_at,
    m.name                             AS merchant,
    COALESCE(c.name, 'Uncategorised')  AS category,
    COALESCE(c.slug, 'uncategorised')  AS category_slug,
    COALESCE(c.color_token, '#94A3B8') AS category_color,
    t.amount,
    t.currency,
    t.status::text                     AS status,
    t.method::text                     AS method,
    t.is_refund,
    t.is_outlier,
    t.category_backfilled,
    t.has_duplicate_external_id,
    t.source_ts_format,
    t.coins_earned
"""

_FROM = """
FROM transactions t
JOIN merchants m       ON m.id = t.merchant_id
LEFT JOIN categories c ON c.id = t.category_id
"""


async def list_transactions(
    conn: AsyncConnection,
    filters: TransactionFilters,
    *,
    sort: str,
    order: str,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    """Return one page of rows plus the total matching count.

    The count is computed in the same statement via a window function, so the
    page and its total always describe the same snapshot and we pay for one
    round trip instead of two.
    """
    where, params = build_where(filters)
    order_by = build_order_by(sort, order)

    query = f"""
        SELECT {_SELECT_COLUMNS},
               COUNT(*) OVER () AS total_count
        {_FROM}
        {where}
        {order_by}
        LIMIT %(limit)s OFFSET %(offset)s
    """
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    async with conn.cursor() as cur:
        await cur.execute(query, params)
        rows = await cur.fetchall()

    if not rows:
        # COUNT(*) OVER () yields nothing when the page is empty (either a real
        # zero-result filter or a page past the end), so ask separately.
        return [], await count_transactions(conn, filters)

    total = rows[0].pop("total_count")
    for row in rows[1:]:
        row.pop("total_count", None)
    return rows, int(total)


async def count_transactions(conn: AsyncConnection, filters: TransactionFilters) -> int:
    where, params = build_where(filters)
    async with conn.cursor() as cur:
        await cur.execute(f"SELECT COUNT(*) AS n {_FROM} {where}", params)
        row = await cur.fetchone()
    return int(row["n"]) if row else 0


async def get_transaction(conn: AsyncConnection, txn_id: int) -> dict[str, Any] | None:
    async with conn.cursor() as cur:
        await cur.execute(
            f"SELECT {_SELECT_COLUMNS} {_FROM} WHERE t.id = %(id)s", {"id": txn_id}
        )
        return await cur.fetchone()


async def get_sibling_transactions(
    conn: AsyncConnection, external_id: str, exclude_id: int
) -> list[dict[str, Any]]:
    """Other rows sharing this source id.

    40 ids in the feed are reused by a second, unrelated transaction. The detail
    drawer surfaces the collision instead of pretending the id is unique.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT {_SELECT_COLUMNS} {_FROM}
            WHERE t.external_id = %(eid)s AND t.id <> %(exclude)s
            ORDER BY t.occurred_at DESC
            """,
            {"eid": external_id, "exclude": exclude_id},
        )
        return await cur.fetchall()


async def get_filter_facets(conn: AsyncConnection) -> dict[str, Any]:
    """Options for the filter controls, derived from the data itself.

    Fetched once and cached client-side; hardcoding these in the frontend would
    mean the UI drifts the moment the dataset changes.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT c.name, c.slug, c.color_token AS color, COUNT(t.id) AS count
            FROM categories c
            LEFT JOIN transactions t ON t.category_id = c.id
            GROUP BY c.id, c.name, c.slug, c.color_token, c.sort_order
            ORDER BY c.sort_order, c.name
            """
        )
        categories = await cur.fetchall()

        await cur.execute(
            """
            SELECT m.name, COUNT(t.id) AS count
            FROM merchants m
            LEFT JOIN transactions t ON t.merchant_id = m.id
            GROUP BY m.name ORDER BY m.name
            """
        )
        merchants = await cur.fetchall()

        await cur.execute(
            """
            SELECT status::text AS value, COUNT(*) AS count
            FROM transactions GROUP BY status ORDER BY COUNT(*) DESC
            """
        )
        statuses = await cur.fetchall()

        await cur.execute(
            """
            SELECT method::text AS value, COUNT(*) AS count
            FROM transactions GROUP BY method ORDER BY COUNT(*) DESC
            """
        )
        methods = await cur.fetchall()

        # Bounds drive the date and amount range inputs. Outliers are excluded
        # from the max so the amount slider is not stretched to ₹999,999,999.
        await cur.execute(
            """
            SELECT MIN(occurred_at)::date            AS min_date,
                   MAX(occurred_at)::date            AS max_date,
                   MIN(ABS(amount)) FILTER (WHERE is_outlier = FALSE) AS min_amount,
                   MAX(ABS(amount)) FILTER (WHERE is_outlier = FALSE) AS max_amount,
                   COUNT(*)                          AS total
            FROM transactions
            """
        )
        bounds = await cur.fetchone()

    return {
        "categories": categories,
        "merchants": merchants,
        "statuses": statuses,
        "methods": methods,
        "bounds": bounds or {},
    }


async def get_data_quality(conn: AsyncConnection) -> dict[str, Any]:
    """Live counts of what the seed had to repair, plus the stored report."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
                COUNT(*)                                                   AS total,
                COUNT(*) FILTER (WHERE is_refund)                          AS refunds,
                COUNT(*) FILTER (WHERE is_outlier)                         AS outliers,
                COUNT(*) FILTER (WHERE category_backfilled)                AS backfilled,
                COUNT(*) FILTER (WHERE has_duplicate_external_id)          AS duplicate_id_rows,
                COUNT(DISTINCT external_id) FILTER (WHERE has_duplicate_external_id)
                                                                           AS duplicate_ids,
                COUNT(*) FILTER (WHERE category_id IS NULL)                AS uncategorised
            FROM transactions
            """
        )
        live = await cur.fetchone() or {}

        await cur.execute(
            """
            SELECT source_ts_format AS format, COUNT(*) AS count
            FROM transactions GROUP BY source_ts_format ORDER BY COUNT(*) DESC
            """
        )
        formats = await cur.fetchall()

        await cur.execute(
            """
            SELECT report, rows_read, rows_loaded, rows_rejected, finished_at
            FROM ingest_runs ORDER BY id DESC LIMIT 1
            """
        )
        last_run = await cur.fetchone()

    return {"live": live, "timestamp_formats": formats, "last_ingest": last_run}
