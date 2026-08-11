"""FastAPI dependencies: connections, the demo user, and query-param parsing.

Query parsing lives here so routes stay thin and every endpoint that accepts
filters interprets them identically.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

from fastapi import Depends, Query
from psycopg import AsyncConnection

from app.core.config import Settings, get_settings
from app.core.errors import NotFoundError, ValidationError
from app.db import pool
from app.domain.normalize import VALID_METHODS, VALID_STATUSES
from app.repositories import rewards as rewards_repo
from app.repositories.filters import TransactionFilters


async def get_conn() -> AsyncIterator[AsyncConnection]:
    async with pool.connection() as conn:
        yield conn


async def get_tx_conn() -> AsyncIterator[AsyncConnection]:
    """Connection wrapped in an explicit transaction (used by redeem)."""
    async with pool.transaction() as conn:
        yield conn


DbConn = Annotated[AsyncConnection, Depends(get_conn)]
TxConn = Annotated[AsyncConnection, Depends(get_tx_conn)]
AppSettings = Annotated[Settings, Depends(get_settings)]


async def get_current_user(conn: DbConn, settings: AppSettings) -> dict[str, Any]:
    """Resolve the demo user.

    There is no auth in this build — the brief describes a single consumer
    looking at *their own* spending, and inventing a login would have cost
    frontend time the brief explicitly wants spent elsewhere. Every route still
    goes through this dependency, so swapping in a real token check later is a
    one-function change rather than a refactor.
    """
    user = await rewards_repo.get_user_by_email(conn, settings.demo_user_email)
    if user is None:
        raise NotFoundError(
            "Demo user not found. Has the database been seeded?",
            email=settings.demo_user_email,
        )
    return user


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]


async def get_tx_user(conn: TxConn, settings: AppSettings) -> dict[str, Any]:
    """Same as :func:`get_current_user` but on the transactional connection."""
    user = await rewards_repo.get_user_by_email(conn, settings.demo_user_email)
    if user is None:
        raise NotFoundError(
            "Demo user not found. Has the database been seeded?",
            email=settings.demo_user_email,
        )
    return user


TxUser = Annotated[dict[str, Any], Depends(get_tx_user)]


# --------------------------------------------------------------------------- #
# Filter parsing
# --------------------------------------------------------------------------- #


def _csv(values: list[str] | None) -> list[str]:
    """Accept both ``?category=A&category=B`` and ``?category=A,B``."""
    if not values:
        return []
    out: list[str] = []
    for value in values:
        out.extend(part.strip() for part in value.split(",") if part.strip())
    return out


def _decimal(value: str | None, field: str) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValidationError(f"{field} must be a number.", value=value) from exc
    if parsed < 0:
        raise ValidationError(f"{field} cannot be negative.", value=value)
    return parsed


def parse_filters(
    category: Annotated[list[str] | None, Query(description="Category name(s).")] = None,
    status: Annotated[list[str] | None, Query(description="SUCCESS | FAILED | PENDING")] = None,
    method: Annotated[list[str] | None, Query(description="Payment method(s).")] = None,
    merchant: Annotated[list[str] | None, Query(description="Exact merchant name(s).")] = None,
    q: Annotated[str | None, Query(description="Merchant search (substring).")] = None,
    date_from: Annotated[date | None, Query(description="Inclusive start date.")] = None,
    date_to: Annotated[date | None, Query(description="Inclusive end date.")] = None,
    amount_min: Annotated[str | None, Query(description="Minimum absolute amount.")] = None,
    amount_max: Annotated[str | None, Query(description="Maximum absolute amount.")] = None,
    include_refunds: Annotated[bool, Query(description="Show negative amounts.")] = True,
    include_outliers: Annotated[bool, Query(description="Show corrupt-magnitude rows.")] = True,
) -> TransactionFilters:
    statuses = [s.strip().upper() for s in _csv(status)]
    for s in statuses:
        if s not in VALID_STATUSES:
            raise ValidationError(
                f"Unknown status '{s}'.", allowed=sorted(VALID_STATUSES)
            )

    methods = _csv(method)
    for m in methods:
        if m not in VALID_METHODS:
            raise ValidationError(
                f"Unknown payment method '{m}'.", allowed=sorted(VALID_METHODS)
            )

    search = (q or "").strip()
    return TransactionFilters(
        categories=_csv(category),
        statuses=statuses,
        methods=methods,
        merchants=_csv(merchant),
        search=search or None,
        date_from=date_from,
        date_to=date_to,
        amount_min=_decimal(amount_min, "amount_min"),
        amount_max=_decimal(amount_max, "amount_max"),
        include_refunds=include_refunds,
        include_outliers=include_outliers,
    )


Filters = Annotated[TransactionFilters, Depends(parse_filters)]
