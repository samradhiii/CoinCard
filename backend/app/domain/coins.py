"""Reward-coin earning rules.

The brief: *"Users earn coins on successful payments, one coin per ₹100 spent,
capped per transaction."* The cap value was left open, so it is defined here as
a single constant and documented in ASSUMPTIONS.md.

Rules, in order:

1. Only ``SUCCESS`` payments earn. ``FAILED`` and ``PENDING`` earn nothing — a
   pending payment that later fails must not have already paid out coins.
2. ₹100 spent = 1 coin, floored. ₹4,999 earns 49 coins, not 49.99.
3. Capped at :data:`MAX_COINS_PER_TRANSACTION` per transaction.
4. Refunds (negative amounts) earn nothing. They are not clawed back either —
   see ASSUMPTIONS.md.
5. The corrupt ₹999,999,999 row earns nothing. Without this, that one row alone
   would mint 9,999,999 coins and make the entire rewards feature meaningless.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Final

#: Rupees of spend per coin.
RUPEES_PER_COIN: Final = Decimal("100")

#: Per-transaction earning ceiling. 100 coins == ₹10,000 of spend, in line with
#: how Indian card reward programmes cap points per swipe. On this dataset the
#: cap is not cosmetic: it takes the total from 616,129 coins to 362,729.
MAX_COINS_PER_TRANSACTION: Final = 100

EARNING_STATUS: Final = "SUCCESS"


def coins_for_transaction(
    amount: Decimal,
    status: str,
    *,
    is_outlier: bool = False,
    cap: int = MAX_COINS_PER_TRANSACTION,
) -> int:
    """Coins earned by a single transaction. Never negative.

    Args:
        amount: Transaction amount in rupees. Negative means a refund.
        status: Normalised payment status.
        is_outlier: Flagged corrupt amount; earns nothing.
        cap: Per-transaction ceiling.
    """
    if status != EARNING_STATUS:
        return 0
    if is_outlier:
        return 0
    if amount <= 0:
        return 0

    coins = int(amount // RUPEES_PER_COIN)
    return min(coins, cap)


def is_capped(amount: Decimal, status: str, *, is_outlier: bool = False) -> bool:
    """Whether the cap actually bit for this transaction (for reporting)."""
    if status != EARNING_STATUS or is_outlier or amount <= 0:
        return False
    return int(amount // RUPEES_PER_COIN) > MAX_COINS_PER_TRANSACTION


__all__ = [
    "EARNING_STATUS",
    "MAX_COINS_PER_TRANSACTION",
    "RUPEES_PER_COIN",
    "coins_for_transaction",
    "is_capped",
]
