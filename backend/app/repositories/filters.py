"""Shared WHERE-clause builder for transactions.

The list endpoint and the analytics endpoints must interpret a filter set
*identically* — otherwise the charts and the table disagree and the two-way
cross-filtering silently lies. Building the predicate once, here, is what makes
that guarantee structural rather than a matter of discipline.

Every value is passed as a bound parameter; nothing is interpolated into SQL.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Literal

SortField = Literal["date", "amount", "merchant"]
SortOrder = Literal["asc", "desc"]


@dataclass(slots=True)
class TransactionFilters:
    """A normalised, transport-agnostic filter set."""

    categories: list[str] = field(default_factory=list)
    statuses: list[str] = field(default_factory=list)
    methods: list[str] = field(default_factory=list)
    merchants: list[str] = field(default_factory=list)
    search: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    amount_min: Decimal | None = None
    amount_max: Decimal | None = None
    #: Refunds and the corrupt-magnitude row are shown in the table by default
    #: (they are the user's real transactions) but excluded from spend maths.
    include_refunds: bool = True
    include_outliers: bool = True

    @property
    def is_active(self) -> bool:
        """Whether the user has narrowed anything at all."""
        return any(
            [
                self.categories,
                self.statuses,
                self.methods,
                self.merchants,
                self.search,
                self.date_from,
                self.date_to,
                self.amount_min is not None,
                self.amount_max is not None,
                not self.include_refunds,
                not self.include_outliers,
            ]
        )


def build_where(
    filters: TransactionFilters,
    *,
    alias: str = "t",
    spend_only: bool = False,
) -> tuple[str, dict[str, Any]]:
    """Return ``(sql_fragment, params)`` starting with ``WHERE``, or empty.

    Args:
        alias: table alias the predicates should target.
        spend_only: force-exclude refunds and outliers regardless of the filter
            set. Used by the spend aggregates so one corrupt ₹999,999,999 row
            cannot dominate every chart.
    """
    clauses: list[str] = []
    params: dict[str, Any] = {}
    a = alias

    if filters.categories:
        # Matching on the joined display name keeps the API surface human
        # readable (?category=Travel) instead of leaking database ids.
        clauses.append("COALESCE(c.name, 'Uncategorised') = ANY(%(categories)s)")
        params["categories"] = filters.categories

    if filters.statuses:
        clauses.append(f"{a}.status = ANY(%(statuses)s::payment_status[])")
        params["statuses"] = filters.statuses

    if filters.methods:
        clauses.append(f"{a}.method = ANY(%(methods)s::payment_method[])")
        params["methods"] = filters.methods

    if filters.merchants:
        clauses.append("m.name = ANY(%(merchants)s)")
        params["merchants"] = filters.merchants

    if filters.search:
        # Search-as-you-type on merchant name. Case-insensitive substring,
        # backed by the GIN trigram index on merchants.name.
        clauses.append("m.name ILIKE %(search)s")
        params["search"] = f"%{filters.search}%"

    if filters.date_from:
        clauses.append(f"{a}.occurred_at >= %(date_from)s")
        params["date_from"] = filters.date_from

    if filters.date_to:
        # Inclusive of the whole end day: the user picked a date, not an instant.
        clauses.append(f"{a}.occurred_at < (%(date_to)s::date + INTERVAL '1 day')")
        params["date_to"] = filters.date_to

    if filters.amount_min is not None:
        # Compared on absolute value so an amount range behaves sensibly for
        # refunds: "₹500–₹2,000" should match a -₹700 refund too.
        clauses.append(f"ABS({a}.amount) >= %(amount_min)s")
        params["amount_min"] = filters.amount_min

    if filters.amount_max is not None:
        clauses.append(f"ABS({a}.amount) <= %(amount_max)s")
        params["amount_max"] = filters.amount_max

    if spend_only or not filters.include_refunds:
        clauses.append(f"{a}.is_refund = FALSE")

    if spend_only or not filters.include_outliers:
        clauses.append(f"{a}.is_outlier = FALSE")

    if not clauses:
        return "", params
    return "WHERE " + "\n  AND ".join(clauses), params


#: Whitelisted sort expressions. The API never puts user input into ORDER BY;
#: it maps an enum to one of these. Each carries a deterministic tiebreaker so
#: pagination cannot repeat or skip a row when values collide.
_SORT_EXPRESSIONS: dict[str, str] = {
    "date": "t.occurred_at",
    "amount": "t.amount",
    "merchant": "m.name",
}


def build_order_by(sort: str, order: str) -> str:
    expr = _SORT_EXPRESSIONS.get(sort, _SORT_EXPRESSIONS["date"])
    direction = "ASC" if order == "asc" else "DESC"
    return f"ORDER BY {expr} {direction}, t.id {direction}"
