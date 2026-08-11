"""Response models for the analytics endpoint."""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from app.schemas.common import ApiModel


class SpendSummary(ApiModel):
    txn_count: int
    total_spend: Decimal
    spend_count: int
    total_refunded: Decimal
    refund_count: int
    failed_count: int
    pending_count: int
    outlier_count: int
    coins_earned: int
    merchant_count: int
    avg_transaction: Decimal


class CategorySlice(ApiModel):
    category: str
    slug: str
    color: str
    total: Decimal
    count: int
    average: Decimal
    share: float = 0.0


class MonthPoint(ApiModel):
    month: str
    label: str
    total: Decimal
    count: int
    coins: int


class MerchantRow(ApiModel):
    merchant: str
    category: str
    color: str
    total: Decimal
    count: int


class StatusSlice(ApiModel):
    status: str
    count: int
    total: Decimal


class AnalyticsOut(ApiModel):
    summary: SpendSummary
    by_category: list[CategorySlice] = Field(default_factory=list)
    by_month: list[MonthPoint] = Field(default_factory=list)
    top_merchants: list[MerchantRow] = Field(default_factory=list)
    by_status: list[StatusSlice] = Field(default_factory=list)
    filters_active: bool = False
