"""Integration tests for the redeem flow.

The brief singles this endpoint out — "the backend has to reject a redeem when
the balance is too low or the reward doesn't exist, with sensible status codes"
— so it gets the most coverage, against a real database.

Each test rolls back, so running the suite never changes the seeded balance.
"""

from __future__ import annotations

import pytest

from app.core.errors import (
    InsufficientBalanceError,
    NotFoundError,
    RewardUnavailableError,
)
from app.repositories import rewards as repo
from app.services import rewards as service

pytestmark = pytest.mark.asyncio


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #


async def test_redeem_debits_exactly_the_reward_cost(conn, user):
    before = await repo.get_balance(conn, user["id"])
    reward = await _affordable_reward(conn, before)

    result = await service.redeem(conn, user, reward["id"])

    assert result["balance"] == before - reward["coin_cost"]
    # The returned figure must match what the ledger actually says.
    assert await repo.get_balance(conn, user["id"]) == before - reward["coin_cost"]
    assert result["replayed"] is False


async def test_redeem_writes_a_matching_ledger_entry(conn, user):
    reward = await _affordable_reward(conn, await repo.get_balance(conn, user["id"]))

    result = await service.redeem(conn, user, reward["id"])

    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT delta, reason::text AS reason, redemption_id "
            "FROM coin_ledger WHERE redemption_id = %s",
            (result["redemption"]["id"],),
        )
        entry = await cur.fetchone()

    assert entry is not None
    assert entry["delta"] == -reward["coin_cost"]
    assert entry["reason"] == "REDEEM"


async def test_redeem_returns_a_voucher_code(conn, user):
    reward = await _affordable_reward(conn, await repo.get_balance(conn, user["id"]))
    result = await service.redeem(conn, user, reward["id"])

    code = result["redemption"]["code"]
    prefix, *blocks = code.split("-")

    assert prefix  # derived from the reward SKU
    assert len(blocks) == 2
    # The random blocks deliberately exclude I/O/0/1 so a code can be read
    # aloud or retyped without ambiguity. (The SKU-derived prefix is exempt —
    # "SPOTIFY" legitimately contains an I and an O.)
    for block in blocks:
        assert len(block) == 4
        assert not set(block) & set("IO01")


# --------------------------------------------------------------------------- #
# Rejections — the status codes the brief asks for
# --------------------------------------------------------------------------- #


async def test_unaffordable_redeem_is_rejected_with_409(conn, user):
    balance = await repo.get_balance(conn, user["id"])
    reward = await _unaffordable_reward(conn, balance)

    with pytest.raises(InsufficientBalanceError) as exc:
        await service.redeem(conn, user, reward["id"])

    assert exc.value.status_code == 409
    assert exc.value.code == "insufficient_balance"
    # The error carries the shortfall so the UI can say how far off the user is.
    assert exc.value.details["shortfall"] == reward["coin_cost"] - balance
    # Nothing was charged.
    assert await repo.get_balance(conn, user["id"]) == balance


async def test_unknown_reward_is_rejected_with_404(conn, user):
    balance = await repo.get_balance(conn, user["id"])

    with pytest.raises(NotFoundError) as exc:
        await service.redeem(conn, user, 999_999)

    assert exc.value.status_code == 404
    assert await repo.get_balance(conn, user["id"]) == balance


async def test_inactive_reward_is_rejected_with_409(conn, user):
    reward = await _affordable_reward(conn, await repo.get_balance(conn, user["id"]))
    async with conn.cursor() as cur:
        await cur.execute("UPDATE rewards SET is_active = FALSE WHERE id = %s", (reward["id"],))

    with pytest.raises(RewardUnavailableError) as exc:
        await service.redeem(conn, user, reward["id"])

    assert exc.value.status_code == 409


async def test_sold_out_reward_is_rejected_with_409(conn, user):
    reward = await _affordable_reward(conn, await repo.get_balance(conn, user["id"]))
    # Force the stock to zero rather than redeeming it out, so the test stays
    # fast and independent of the catalogue's configured stock level.
    async with conn.cursor() as cur:
        await cur.execute("UPDATE rewards SET stock = 0 WHERE id = %s", (reward["id"],))

    with pytest.raises(RewardUnavailableError) as exc:
        await service.redeem(conn, user, reward["id"])

    assert exc.value.code == "reward_unavailable"


# --------------------------------------------------------------------------- #
# The invariant that matters most
# --------------------------------------------------------------------------- #


async def test_balance_can_never_go_negative(conn, user):
    """Drain the balance to near zero, then try to overspend."""
    balance = await repo.get_balance(conn, user["id"])
    reward = await _affordable_reward(conn, balance)

    # Spend down to just below the cost of one more redemption.
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO coin_ledger (user_id, delta, reason, note)
            VALUES (%s, %s, 'ADJUSTMENT', 'test drain')
            """,
            (user["id"], -(balance - reward["coin_cost"] + 1)),
        )

    remaining = await repo.get_balance(conn, user["id"])
    assert remaining < reward["coin_cost"]

    with pytest.raises(InsufficientBalanceError):
        await service.redeem(conn, user, reward["id"])

    assert await repo.get_balance(conn, user["id"]) == remaining
    assert await repo.get_balance(conn, user["id"]) >= 0


# --------------------------------------------------------------------------- #
# Idempotency
# --------------------------------------------------------------------------- #


async def test_replayed_idempotency_key_does_not_double_charge(conn, user):
    """A retried request must return the original result, not charge twice.

    This is what makes the frontend's "Try again" button safe after a timeout,
    where the first request may well have succeeded.
    """
    before = await repo.get_balance(conn, user["id"])
    reward = await _affordable_reward(conn, before)

    first = await service.redeem(conn, user, reward["id"], idempotency_key="retry-me")
    second = await service.redeem(conn, user, reward["id"], idempotency_key="retry-me")

    assert second["replayed"] is True
    assert second["redemption"]["id"] == first["redemption"]["id"]
    assert second["redemption"]["code"] == first["redemption"]["code"]
    # Charged exactly once.
    assert await repo.get_balance(conn, user["id"]) == before - reward["coin_cost"]


async def test_distinct_keys_charge_separately(conn, user):
    before = await repo.get_balance(conn, user["id"])
    reward = await _affordable_reward(conn, before)

    await service.redeem(conn, user, reward["id"], idempotency_key="key-a")
    await service.redeem(conn, user, reward["id"], idempotency_key="key-b")

    assert await repo.get_balance(conn, user["id"]) == before - 2 * reward["coin_cost"]


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #


async def test_catalogue_marks_affordability_against_the_real_balance(conn, user):
    catalogue = await service.get_catalogue(conn, user)
    balance = catalogue["balance"]

    for item in catalogue["items"]:
        expected = balance >= item["coin_cost"] and not item["sold_out"]
        assert item["affordable"] is expected
        if not item["affordable"] and not item["sold_out"]:
            assert item["coins_short"] == item["coin_cost"] - balance


async def test_catalogue_contains_between_four_and_six_rewards(conn, user):
    """The brief asks for a catalogue of four to six rewards."""
    catalogue = await service.get_catalogue(conn, user)
    assert 4 <= len(catalogue["items"]) <= 6


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


async def _affordable_reward(conn, balance: int) -> dict:
    rewards = await repo.list_rewards(conn)
    for reward in sorted(rewards, key=lambda r: r["coin_cost"]):
        if reward["coin_cost"] <= balance:
            return reward
    pytest.skip("no affordable reward for the current balance")


async def _unaffordable_reward(conn, balance: int) -> dict:
    rewards = await repo.list_rewards(conn)
    for reward in sorted(rewards, key=lambda r: -r["coin_cost"]):
        if reward["coin_cost"] > balance:
            return reward
    pytest.skip("every reward is affordable — cannot test the 409 path")
