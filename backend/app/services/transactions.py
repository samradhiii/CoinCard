"""Transaction service — pagination maths and detail assembly."""

from __future__ import annotations

import math
from typing import Any

from psycopg import AsyncConnection

from app.core.errors import NotFoundError, ValidationError
from app.repositories import transactions as repo
from app.repositories.filters import TransactionFilters


async def list_page(
    conn: AsyncConnection,
    filters: TransactionFilters,
    *,
    sort: str,
    order: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    if filters.amount_min is not None and filters.amount_max is not None:
        if filters.amount_min > filters.amount_max:
            raise ValidationError(
                "amount_min cannot be greater than amount_max.",
                amount_min=str(filters.amount_min),
                amount_max=str(filters.amount_max),
            )
    if filters.date_from and filters.date_to and filters.date_from > filters.date_to:
        raise ValidationError(
            "date_from cannot be after date_to.",
            date_from=filters.date_from.isoformat(),
            date_to=filters.date_to.isoformat(),
        )

    rows, total = await repo.list_transactions(
        conn, filters, sort=sort, order=order, page=page, page_size=page_size
    )
    total_pages = max(1, math.ceil(total / page_size)) if total else 0

    return {
        "items": rows,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
        "sort": sort,
        "order": order,
    }


async def get_detail(conn: AsyncConnection, txn_id: int) -> dict[str, Any]:
    txn = await repo.get_transaction(conn, txn_id)
    if txn is None:
        raise NotFoundError("Transaction not found.", id=txn_id)

    siblings: list[dict[str, Any]] = []
    if txn["has_duplicate_external_id"]:
        siblings = await repo.get_sibling_transactions(conn, txn["external_id"], txn_id)

    return {"transaction": txn, "id_collisions": siblings}


async def get_facets(conn: AsyncConnection) -> dict[str, Any]:
    return await repo.get_filter_facets(conn)


async def get_data_quality(conn: AsyncConnection) -> dict[str, Any]:
    return await repo.get_data_quality(conn)
