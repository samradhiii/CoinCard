"""Unit tests for the coin-earning rules."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.coins import (
    MAX_COINS_PER_TRANSACTION,
    coins_for_transaction,
    is_capped,
)


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        (Decimal("99.99"), 0),     # under ₹100 earns nothing
        (Decimal("100.00"), 1),
        (Decimal("4999.00"), 49),  # floored, not rounded to 50
        (Decimal("10000.00"), 100),
    ],
)
def test_one_coin_per_hundred_rupees(amount, expected):
    assert coins_for_transaction(amount, "SUCCESS") == expected


def test_cap_applies_per_transaction():
    """A ₹47,538 payment earns the cap, not 475 coins."""
    assert coins_for_transaction(Decimal("47538.10"), "SUCCESS") == MAX_COINS_PER_TRANSACTION
    assert is_capped(Decimal("47538.10"), "SUCCESS") is True
    assert is_capped(Decimal("5000.00"), "SUCCESS") is False


@pytest.mark.parametrize("status", ["FAILED", "PENDING"])
def test_only_successful_payments_earn(status):
    """A PENDING payment must not pay out coins it may never deserve."""
    assert coins_for_transaction(Decimal("5000.00"), status) == 0


def test_refunds_earn_nothing():
    assert coins_for_transaction(Decimal("-25877.00"), "SUCCESS") == 0


def test_corrupt_outlier_earns_nothing():
    """Without this guard the single ₹999,999,999 row would mint 9,999,999
    coins — roughly 27x the entire legitimate balance — and make the whole
    rewards feature meaningless."""
    assert coins_for_transaction(Decimal("999999999.00"), "SUCCESS", is_outlier=True) == 0


def test_coins_are_never_negative():
    for amount in (Decimal("-1"), Decimal("0"), Decimal("-999999")):
        assert coins_for_transaction(amount, "SUCCESS") >= 0
