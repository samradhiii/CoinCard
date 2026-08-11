"""Pydantic models shared across the API surface.

These exist to give the frontend a stable, documented contract (FastAPI turns
them into OpenAPI, which is what the TypeScript types were written against).
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ErrorDetail(ApiModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail


class Page(ApiModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool
    sort: str
    order: str


class TransactionOut(ApiModel):
    id: int
    external_id: str
    occurred_at: datetime
    merchant: str
    category: str
    category_slug: str
    category_color: str
    amount: Decimal
    currency: str
    status: str
    method: str
    is_refund: bool
    is_outlier: bool
    category_backfilled: bool
    has_duplicate_external_id: bool
    source_ts_format: str
    coins_earned: int


class TransactionDetailOut(ApiModel):
    transaction: TransactionOut
    #: Other rows that share this (non-unique) source id.
    id_collisions: list[TransactionOut] = Field(default_factory=list)


class CategoryFacet(ApiModel):
    name: str
    slug: str
    color: str
    count: int


class MerchantFacet(ApiModel):
    name: str
    count: int


class ValueFacet(ApiModel):
    value: str
    count: int


class FacetBounds(ApiModel):
    min_date: date | None = None
    max_date: date | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    total: int = 0


class FacetsOut(ApiModel):
    categories: list[CategoryFacet]
    merchants: list[MerchantFacet]
    statuses: list[ValueFacet]
    methods: list[ValueFacet]
    bounds: FacetBounds
