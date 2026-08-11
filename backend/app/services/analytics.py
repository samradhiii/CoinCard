"""Analytics service — assembles the chart payload in one round trip."""

from __future__ import annotations

from typing import Any

from psycopg import AsyncConnection

from app.repositories import analytics as repo
from app.repositories.filters import TransactionFilters


async def get_overview(
    conn: AsyncConnection, filters: TransactionFilters
) -> dict[str, Any]:
    """Everything the analytics panel needs, filter-aware.

    Returned as one payload rather than four endpoints so the charts can never
    render against mismatched filter states mid-update.
    """
    summary = await repo.spend_summary(conn, filters)
    by_category = await repo.spend_by_category(conn, filters)
    by_month = await repo.spend_by_month(conn, filters)
    merchants = await repo.top_merchants(conn, filters)
    statuses = await repo.status_split(conn, filters)

    total = sum((row["total"] or 0) for row in by_category)
    for row in by_category:
        row["share"] = float((row["total"] or 0) / total * 100) if total else 0.0

    return {
        "summary": summary,
        "by_category": by_category,
        "by_month": by_month,
        "top_merchants": merchants,
        "by_status": statuses,
        "filters_active": filters.is_active,
    }
