"""Rewards business logic.

The redeem path is the one place in this app where getting it wrong costs the
user money, so it is deliberately conservative:

* the whole operation runs in **one database transaction**;
* the user row is **locked** before the balance is read, so two concurrent
  redeems cannot both spend the same coins;
* the balance is **re-read inside the lock** — never trusted from the client;
* the debit and the redemption record are written together, so a crash between
  them cannot leave the balance wrong;
* an **idempotency key** makes a retried request return the original result
  instead of charging twice.

Failure modes map to distinct status codes so the UI can react precisely:
404 unknown reward, 409 unaffordable or sold out, 422 malformed input.
"""

from __future__ import annotations

import secrets
from typing import Any

from psycopg import AsyncConnection

from app.core.errors import (
    InsufficientBalanceError,
    NotFoundError,
    RewardUnavailableError,
)
from app.repositories import rewards as repo


def _generate_code(sku: str) -> str:
    """Human-readable voucher code, e.g. ``AMAZON-7F3K-9QX2``."""
    prefix = "".join(ch for ch in sku.upper() if ch.isalnum())[:6] or "COIN"
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1
    block = lambda: "".join(secrets.choice(alphabet) for _ in range(4))  # noqa: E731
    return f"{prefix}-{block()}-{block()}"


async def get_balance_summary(conn: AsyncConnection, user: dict[str, Any]) -> dict[str, Any]:
    breakdown = await repo.get_balance_breakdown(conn, user["id"])
    return {
        "user": {
            "id": user["id"],
            "name": user["full_name"],
            "email": user["email"],
            "card_last4": user["card_last4"],
        },
        "balance": int(breakdown.get("balance") or 0),
        "lifetime_earned": int(breakdown.get("lifetime_earned") or 0),
        "lifetime_redeemed": int(breakdown.get("lifetime_redeemed") or 0),
        "earning_transactions": int(breakdown.get("earning_transactions") or 0),
    }


async def get_catalogue(conn: AsyncConnection, user: dict[str, Any]) -> dict[str, Any]:
    """Catalogue annotated with affordability for the current balance.

    Affordability is computed server-side so the UI never has to reimplement the
    rule the backend will enforce a moment later.
    """
    balance = await repo.get_balance(conn, user["id"])
    rows = await repo.list_rewards(conn)

    items = []
    for row in rows:
        remaining = row["stock_remaining"]
        sold_out = remaining is not None and remaining <= 0
        items.append(
            {
                **row,
                "affordable": balance >= row["coin_cost"] and not sold_out,
                "sold_out": sold_out,
                "coins_short": max(0, row["coin_cost"] - balance),
            }
        )
    return {"balance": balance, "items": items}


async def redeem(
    conn: AsyncConnection,
    user: dict[str, Any],
    reward_id: int,
    *,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Spend coins on a reward. Caller must supply a connection already inside
    a transaction — see :func:`app.db.pool.transaction`.
    """
    user_id = user["id"]

    # Replay protection first: a retry must never re-run the debit.
    if idempotency_key:
        existing = await repo.find_redemption_by_key(conn, user_id, idempotency_key)
        if existing:
            return {
                "redemption": existing,
                "balance": await repo.get_balance(conn, user_id),
                "replayed": True,
            }

    # Serialise this user's redeems before anything is read or written.
    if await repo.lock_user(conn, user_id) is None:
        raise NotFoundError("User not found.", user_id=user_id)

    reward = await repo.get_reward(conn, reward_id)
    if reward is None:
        raise NotFoundError(
            "That reward doesn't exist.", reward_id=reward_id
        )
    if not reward["is_active"]:
        raise RewardUnavailableError(
            f"{reward['title']} is no longer available.", reward_id=reward_id
        )

    remaining = reward["stock_remaining"]
    if remaining is not None and remaining <= 0:
        raise RewardUnavailableError(
            f"{reward['title']} is out of stock.", reward_id=reward_id
        )

    # Authoritative balance, read under the lock. The client's optimistic figure
    # is never consulted.
    balance = await repo.get_balance(conn, user_id)
    cost = int(reward["coin_cost"])
    if balance < cost:
        raise InsufficientBalanceError(
            f"You need {cost - balance:,} more coins to redeem {reward['title']}.",
            balance=balance,
            required=cost,
            shortfall=cost - balance,
        )

    redemption = await repo.insert_redemption(
        conn,
        user_id=user_id,
        reward_id=reward_id,
        coin_cost=cost,
        code=_generate_code(reward["sku"]),
        idempotency_key=idempotency_key,
    )
    await repo.insert_ledger_entry(
        conn,
        user_id=user_id,
        delta=-cost,
        reason="REDEEM",
        redemption_id=redemption["id"],
        note=f"Redeemed {reward['title']}",
    )

    return {
        "redemption": {
            **redemption,
            "reward_title": reward["title"],
            "reward_icon": reward["icon"],
            "value_inr": reward["value_inr"],
        },
        "balance": balance - cost,
        "replayed": False,
    }


async def get_activity(conn: AsyncConnection, user: dict[str, Any]) -> dict[str, Any]:
    return {
        "ledger": await repo.list_ledger(conn, user["id"], limit=15),
        "redemptions": await repo.list_redemptions(conn, user["id"], limit=15),
    }
