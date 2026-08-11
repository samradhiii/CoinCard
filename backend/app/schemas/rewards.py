"""Request/response models for the rewards endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import ApiModel


class UserOut(ApiModel):
    id: int
    name: str
    email: str
    card_last4: str


class BalanceOut(ApiModel):
    user: UserOut
    balance: int
    lifetime_earned: int
    lifetime_redeemed: int
    earning_transactions: int


class RewardOut(ApiModel):
    id: int
    sku: str
    title: str
    description: str
    coin_cost: int
    value_inr: int
    icon: str
    accent: str
    is_active: bool
    stock: int | None = None
    stock_remaining: int | None = None
    redeemed_count: int = 0
    affordable: bool = False
    sold_out: bool = False
    coins_short: int = 0


class CatalogueOut(ApiModel):
    balance: int
    items: list[RewardOut] = Field(default_factory=list)


class RedeemRequest(ApiModel):
    reward_id: int = Field(..., gt=0, description="Reward to redeem.")
    #: Optional client-generated key. Sending the same key twice returns the
    #: original redemption instead of charging the user again.
    idempotency_key: str | None = Field(default=None, max_length=64)

    @field_validator("idempotency_key")
    @classmethod
    def _strip_key(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class RedemptionOut(ApiModel):
    id: int
    coin_cost: int
    code: str
    status: str
    created_at: datetime
    reward_title: str | None = None
    reward_icon: str | None = None
    value_inr: int | None = None


class RedeemResponse(ApiModel):
    redemption: RedemptionOut
    balance: int
    #: True when an idempotent retry returned the original redemption.
    replayed: bool = False


class LedgerEntryOut(ApiModel):
    id: int
    delta: int
    reason: str
    note: str | None = None
    created_at: datetime
    reward_title: str | None = None
    merchant: str | None = None


class ActivityOut(ApiModel):
    ledger: list[LedgerEntryOut] = Field(default_factory=list)
    redemptions: list[RedemptionOut] = Field(default_factory=list)
