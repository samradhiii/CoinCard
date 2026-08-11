"""Data access for the coin ledger, the reward catalogue and redemptions."""

from __future__ import annotations

from typing import Any

from psycopg import AsyncConnection


async def get_user_by_email(conn: AsyncConnection, email: str) -> dict[str, Any] | None:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, email, full_name, card_last4 FROM users WHERE email = %s",
            (email,),
        )
        return await cur.fetchone()


async def lock_user(conn: AsyncConnection, user_id: int) -> dict[str, Any] | None:
    """Take a row lock on the user for the duration of the transaction.

    This is the concurrency guard for redeem. Two simultaneous requests both
    read a 5,000-coin balance and both approve a 4,000-coin reward unless one is
    made to wait; locking the user row serialises them, so the second re-reads
    the ledger *after* the first has committed and is correctly rejected.
    """
    async with conn.cursor() as cur:
        await cur.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,))
        return await cur.fetchone()


async def get_balance(conn: AsyncConnection, user_id: int) -> int:
    """Balance is always summed from the ledger — never a cached column."""
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT COALESCE(SUM(delta), 0)::bigint AS balance "
            "FROM coin_ledger WHERE user_id = %s",
            (user_id,),
        )
        row = await cur.fetchone()
    return int(row["balance"]) if row else 0


async def get_balance_breakdown(conn: AsyncConnection, user_id: int) -> dict[str, Any]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
                COALESCE(SUM(delta), 0)::bigint                          AS balance,
                COALESCE(SUM(delta) FILTER (WHERE reason = 'EARN'), 0)::bigint
                                                                        AS lifetime_earned,
                COALESCE(ABS(SUM(delta) FILTER (WHERE reason = 'REDEEM')), 0)::bigint
                                                                        AS lifetime_redeemed,
                COUNT(*) FILTER (WHERE reason = 'EARN')                  AS earning_transactions
            FROM coin_ledger
            WHERE user_id = %s
            """,
            (user_id,),
        )
        return await cur.fetchone() or {}


async def list_ledger(
    conn: AsyncConnection, user_id: int, limit: int = 20
) -> list[dict[str, Any]]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT l.id, l.delta, l.reason::text AS reason, l.note, l.created_at,
                   r.title AS reward_title, m.name AS merchant
            FROM coin_ledger l
            LEFT JOIN redemptions rd ON rd.id = l.redemption_id
            LEFT JOIN rewards r      ON r.id = rd.reward_id
            LEFT JOIN transactions t ON t.id = l.transaction_id
            LEFT JOIN merchants m    ON m.id = t.merchant_id
            WHERE l.user_id = %s
            ORDER BY l.id DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        return await cur.fetchall()


async def list_rewards(conn: AsyncConnection) -> list[dict[str, Any]]:
    """Catalogue with remaining stock computed from confirmed redemptions."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT r.id, r.sku, r.title, r.description, r.coin_cost, r.value_inr,
                   r.icon, r.accent, r.is_active, r.stock, r.sort_order,
                   COUNT(rd.id) FILTER (WHERE rd.status = 'CONFIRMED') AS redeemed_count,
                   CASE WHEN r.stock IS NULL THEN NULL
                        ELSE GREATEST(r.stock - COUNT(rd.id)
                             FILTER (WHERE rd.status = 'CONFIRMED'), 0)
                   END AS stock_remaining
            FROM rewards r
            LEFT JOIN redemptions rd ON rd.reward_id = r.id
            WHERE r.is_active
            GROUP BY r.id
            ORDER BY r.sort_order, r.coin_cost
            """
        )
        return await cur.fetchall()


async def get_reward(conn: AsyncConnection, reward_id: int) -> dict[str, Any] | None:
    """Fetch one reward with its live remaining stock.

    ``FOR UPDATE`` is not used on the reward row: the user lock already
    serialises this user's redeems, and locking the catalogue row would
    needlessly block every other user redeeming the same reward.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT r.id, r.sku, r.title, r.description, r.coin_cost, r.value_inr,
                   r.icon, r.accent, r.is_active, r.stock,
                   CASE WHEN r.stock IS NULL THEN NULL
                        ELSE GREATEST(r.stock - (
                            SELECT COUNT(*) FROM redemptions rd
                            WHERE rd.reward_id = r.id AND rd.status = 'CONFIRMED'), 0)
                   END AS stock_remaining
            FROM rewards r
            WHERE r.id = %s
            """,
            (reward_id,),
        )
        return await cur.fetchone()


async def find_redemption_by_key(
    conn: AsyncConnection, user_id: int, key: str
) -> dict[str, Any] | None:
    """Idempotency lookup: has this exact request already been processed?"""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT rd.id, rd.reward_id, rd.coin_cost, rd.code,
                   rd.status::text AS status, rd.created_at,
                   r.title AS reward_title, r.icon AS reward_icon
            FROM redemptions rd
            JOIN rewards r ON r.id = rd.reward_id
            WHERE rd.user_id = %s AND rd.idempotency_key = %s
            """,
            (user_id, key),
        )
        return await cur.fetchone()


async def insert_redemption(
    conn: AsyncConnection,
    *,
    user_id: int,
    reward_id: int,
    coin_cost: int,
    code: str,
    idempotency_key: str | None,
) -> dict[str, Any]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO redemptions (user_id, reward_id, coin_cost, code, idempotency_key)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, coin_cost, code, status::text AS status, created_at
            """,
            (user_id, reward_id, coin_cost, code, idempotency_key),
        )
        return await cur.fetchone()


async def insert_ledger_entry(
    conn: AsyncConnection,
    *,
    user_id: int,
    delta: int,
    reason: str,
    redemption_id: int | None = None,
    transaction_id: int | None = None,
    note: str | None = None,
) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO coin_ledger (user_id, delta, reason, redemption_id,
                                     transaction_id, note)
            VALUES (%s, %s, %s::ledger_reason, %s, %s, %s)
            """,
            (user_id, delta, reason, redemption_id, transaction_id, note),
        )


async def list_redemptions(
    conn: AsyncConnection, user_id: int, limit: int = 20
) -> list[dict[str, Any]]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT rd.id, rd.coin_cost, rd.code, rd.status::text AS status,
                   rd.created_at, r.title AS reward_title, r.icon AS reward_icon,
                   r.value_inr
            FROM redemptions rd
            JOIN rewards r ON r.id = rd.reward_id
            WHERE rd.user_id = %s
            ORDER BY rd.id DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        return await cur.fetchall()
