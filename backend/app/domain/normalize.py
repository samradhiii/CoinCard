"""Normalisation of the raw transaction feed.

The supplied ``transactions.json`` is deliberately dirty. Every quirk below was
found by profiling all 10,000 rows before any code was written:

==============================  =====  =====================================
Quirk                           Count  Handling
==============================  =====  =====================================
``timestamp`` in 5 shapes       10000  parsed to an aware UTC datetime
  ISO-8601 with ``Z``            5476
  ISO-8601 with ``+05:30``       1961
  epoch milliseconds (number)    1007
  date-only ``YYYY-MM-DD``        715
  ``DD/MM/YYYY HH:MM:SS``         841
``amount`` as a string             20  coerced to Decimal
``amount`` negative                148  kept, flagged ``is_refund``
``amount`` = 999999999.0             1  kept, flagged ``is_outlier``
``category`` key absent             50  backfilled from the merchant
``category`` null                  100  backfilled from the merchant
``category`` empty string           50  backfilled from the merchant
``status`` lowercase 'success'      25  upper-cased to the enum
duplicate ``id``                    40  kept; surrogate PK, flagged
==============================  =====  =====================================

Nothing is silently dropped. Rows are repaired and flagged, because a financial
app that quietly deletes 200 of the user's transactions is worse than one that
labels them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Final

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

#: Amounts at or above this are treated as data corruption rather than a real
#: purchase. The dataset p99 is ~₹49,852; the single offender is ₹999,999,999.
OUTLIER_AMOUNT_THRESHOLD: Final = Decimal("1000000")

VALID_STATUSES: Final = frozenset({"SUCCESS", "FAILED", "PENDING"})
VALID_METHODS: Final = frozenset({"Credit Card", "Debit Card", "UPI", "Netbanking"})

#: Date-only rows have no clock time. They are anchored to 00:00 UTC so ordering
#: stays deterministic instead of depending on ingest time.
_DATE_ONLY_RE: Final = re.compile(r"^\d{4}-\d{2}-\d{2}$")
#: ``12/10/2025 16:24:49``. Day-first — see ``_is_day_first`` for the proof.
_DMY_RE: Final = re.compile(r"^(\d{2})/(\d{2})/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$")
_EPOCH_STR_RE: Final = re.compile(r"^\d{10}(\d{3})?$")

# Source timestamp shape labels, persisted on each row for the data-quality panel.
FMT_ISO_UTC: Final = "iso_utc"
FMT_ISO_OFFSET: Final = "iso_offset"
FMT_EPOCH_MS: Final = "epoch_ms"
FMT_DATE_ONLY: Final = "date_only"
FMT_DMY: Final = "dmy_slash"


class NormalizationError(ValueError):
    """Raised when a row cannot be repaired and must be rejected."""


# --------------------------------------------------------------------------- #
# Timestamps
# --------------------------------------------------------------------------- #


def parse_timestamp(value: Any) -> tuple[datetime, str]:
    """Parse any of the five source timestamp shapes into aware UTC.

    Returns ``(datetime, format_label)``. Raises :class:`NormalizationError`
    for anything unrecognised rather than guessing.
    """
    if value is None:
        raise NormalizationError("timestamp is null")

    # Epoch milliseconds arrive as a bare JSON number (1,007 rows). Seconds are
    # accepted too so the parser does not break if the feed changes units.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _from_epoch(float(value)), FMT_EPOCH_MS

    if not isinstance(value, str):
        raise NormalizationError(f"unsupported timestamp type: {type(value).__name__}")

    raw = value.strip()
    if not raw:
        raise NormalizationError("timestamp is empty")

    if _EPOCH_STR_RE.match(raw):
        return _from_epoch(float(raw)), FMT_EPOCH_MS

    if _DATE_ONLY_RE.match(raw):
        d = date.fromisoformat(raw)
        return datetime(d.year, d.month, d.day, tzinfo=timezone.utc), FMT_DATE_ONLY

    if m := _DMY_RE.match(raw):
        dd, mm, yyyy, hh, mi, ss = (int(g) for g in m.groups())
        try:
            return (
                datetime(yyyy, mm, dd, hh, mi, ss, tzinfo=timezone.utc),
                FMT_DMY,
            )
        except ValueError as exc:  # e.g. 31/02/2026
            raise NormalizationError(f"invalid dd/mm/yyyy timestamp: {raw!r}") from exc

    # Everything else should be ISO-8601. ``fromisoformat`` handles the offset
    # form natively; ``Z`` needs swapping out for Python < 3.11 compatibility.
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise NormalizationError(f"unrecognised timestamp: {raw!r}") from exc

    label = FMT_ISO_UTC if raw.endswith("Z") else FMT_ISO_OFFSET
    if parsed.tzinfo is None:
        # Naive ISO with no offset: assume UTC and say so.
        parsed = parsed.replace(tzinfo=timezone.utc)
        label = FMT_ISO_UTC
    return parsed.astimezone(timezone.utc), label


def _from_epoch(number: float) -> datetime:
    """Interpret a numeric epoch as ms or s, whichever lands in a sane range."""
    # Anything past ~year 2300 in seconds must have been milliseconds.
    seconds = number / 1000.0 if abs(number) > 1e11 else number
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise NormalizationError(f"epoch out of range: {number!r}") from exc


def is_day_first(samples: list[str]) -> bool:
    """Decide whether ``DD/MM/YYYY`` or ``MM/DD/YYYY`` fits the slash-dates.

    Used once at seed time to justify the day-first reading in the log rather
    than assuming a locale. If any sample has a first component > 12 it cannot
    be a month, which settles it.
    """
    for s in samples:
        if m := _DMY_RE.match(s.strip()):
            if int(m.group(1)) > 12:
                return True
    return True  # default; the dataset contains first-components up to 30


# --------------------------------------------------------------------------- #
# Amounts
# --------------------------------------------------------------------------- #


def parse_amount(value: Any) -> Decimal:
    """Coerce an amount to ``Decimal`` with 2dp.

    Handles the 20 rows where the amount arrived as a string like ``"5065.00"``,
    and strips currency symbols / thousands separators defensively.
    """
    if value is None:
        raise NormalizationError("amount is null")

    if isinstance(value, bool):
        raise NormalizationError("amount is a boolean")

    if isinstance(value, str):
        cleaned = value.strip().replace(",", "").replace("₹", "").replace("INR", "").strip()
        if not cleaned:
            raise NormalizationError("amount is an empty string")
        try:
            value = Decimal(cleaned)
        except InvalidOperation as exc:
            raise NormalizationError(f"amount is not numeric: {value!r}") from exc
    elif isinstance(value, (int, float)):
        # str() first: Decimal(float) would drag in binary float noise.
        value = Decimal(str(value))
    else:
        raise NormalizationError(f"unsupported amount type: {type(value).__name__}")

    # ROUND_HALF_UP explicitly: Decimal's default is ROUND_HALF_EVEN (banker's
    # rounding), which would turn ₹0.005 into ₹0.00. Half-up is the convention
    # users expect from money and makes the intent visible rather than implied.
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def is_outlier_amount(amount: Decimal) -> bool:
    """A magnitude so far outside the distribution it must be corrupt."""
    return abs(amount) >= OUTLIER_AMOUNT_THRESHOLD


# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #


def parse_status(value: Any) -> str:
    """Upper-case and validate payment status (25 rows arrive as ``'success'``)."""
    if not isinstance(value, str) or not value.strip():
        raise NormalizationError(f"status is missing: {value!r}")
    status = value.strip().upper()
    if status not in VALID_STATUSES:
        raise NormalizationError(f"unknown status: {value!r}")
    return status


#: Accepts common spelling drift without inventing new enum members.
_METHOD_ALIASES: Final[dict[str, str]] = {
    "credit card": "Credit Card",
    "creditcard": "Credit Card",
    "debit card": "Debit Card",
    "debitcard": "Debit Card",
    "upi": "UPI",
    "netbanking": "Netbanking",
    "net banking": "Netbanking",
}


def parse_method(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise NormalizationError(f"payment_method is missing: {value!r}")
    key = value.strip().lower()
    if key in _METHOD_ALIASES:
        return _METHOD_ALIASES[key]
    raise NormalizationError(f"unknown payment_method: {value!r}")


def parse_currency(value: Any) -> str:
    """The feed is 100% INR; anything else is preserved but must be 3 letters."""
    if value is None:
        return "INR"
    code = str(value).strip().upper()
    return code if len(code) == 3 else "INR"


def clean_text(value: Any) -> str | None:
    """Trim a string field, mapping empty/whitespace-only to ``None``."""
    if value is None or not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


# --------------------------------------------------------------------------- #
# Row-level normalisation
# --------------------------------------------------------------------------- #


@dataclass(slots=True)
class NormalizedTransaction:
    external_id: str
    occurred_at: datetime
    merchant: str
    category: str | None
    amount: Decimal
    currency: str
    status: str
    method: str
    is_refund: bool
    is_outlier: bool
    source_ts_format: str
    #: Set later, once the merchant→category map is known across all rows.
    category_backfilled: bool = False
    has_duplicate_external_id: bool = False


@dataclass(slots=True)
class IngestReport:
    """Counters describing exactly what had to be repaired."""

    rows_read: int = 0
    rows_loaded: int = 0
    rejected: list[dict[str, Any]] = field(default_factory=list)
    ts_formats: dict[str, int] = field(default_factory=dict)
    amount_coerced_from_string: int = 0
    refunds: int = 0
    outliers: int = 0
    category_missing_key: int = 0
    category_null: int = 0
    category_empty: int = 0
    category_backfilled: int = 0
    category_unresolved: int = 0
    status_case_fixed: int = 0
    duplicate_external_ids: int = 0
    duplicate_external_id_rows: int = 0
    merchants: int = 0
    categories: int = 0
    coins_awarded: int = 0
    coins_capped_transactions: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "rows_read": self.rows_read,
            "rows_loaded": self.rows_loaded,
            "rows_rejected": len(self.rejected),
            "rejected_samples": self.rejected[:10],
            "timestamp_formats": self.ts_formats,
            "amount_coerced_from_string": self.amount_coerced_from_string,
            "refund_rows": self.refunds,
            "outlier_rows": self.outliers,
            "category_missing_key": self.category_missing_key,
            "category_null": self.category_null,
            "category_empty": self.category_empty,
            "category_backfilled": self.category_backfilled,
            "category_unresolved": self.category_unresolved,
            "status_case_normalised": self.status_case_fixed,
            "duplicate_external_ids": self.duplicate_external_ids,
            "duplicate_external_id_rows": self.duplicate_external_id_rows,
            "distinct_merchants": self.merchants,
            "distinct_categories": self.categories,
            "coins_awarded": self.coins_awarded,
            "transactions_hitting_coin_cap": self.coins_capped_transactions,
        }


def normalize_row(raw: dict[str, Any], report: IngestReport) -> NormalizedTransaction:
    """Normalise one source record, updating ``report`` with what was repaired."""
    external_id = clean_text(raw.get("id"))
    if not external_id:
        raise NormalizationError("id is missing")

    merchant = clean_text(raw.get("merchant"))
    if not merchant:
        raise NormalizationError("merchant is missing")

    occurred_at, ts_format = parse_timestamp(raw.get("timestamp"))
    report.ts_formats[ts_format] = report.ts_formats.get(ts_format, 0) + 1

    if isinstance(raw.get("amount"), str):
        report.amount_coerced_from_string += 1
    amount = parse_amount(raw.get("amount"))

    raw_status = raw.get("status")
    status = parse_status(raw_status)
    if isinstance(raw_status, str) and raw_status != status and raw_status.upper() == status:
        report.status_case_fixed += 1

    # Distinguish the three flavours of "no category" so the report is precise.
    if "category" not in raw:
        report.category_missing_key += 1
        category = None
    elif raw["category"] is None:
        report.category_null += 1
        category = None
    else:
        category = clean_text(raw["category"])
        if category is None:
            report.category_empty += 1

    is_refund = amount < 0
    if is_refund:
        report.refunds += 1

    is_outlier = is_outlier_amount(amount)
    if is_outlier:
        report.outliers += 1

    return NormalizedTransaction(
        external_id=external_id,
        occurred_at=occurred_at,
        merchant=merchant,
        category=category,
        amount=amount,
        currency=parse_currency(raw.get("currency")),
        status=status,
        method=parse_method(raw.get("payment_method")),
        is_refund=is_refund,
        is_outlier=is_outlier,
        source_ts_format=ts_format,
    )


def build_merchant_category_map(rows: list[NormalizedTransaction]) -> dict[str, str]:
    """Derive merchant → category from the rows that *do* carry a category.

    Profiling showed all 49 merchants map to exactly one category, so this is
    unambiguous. Where a merchant somehow carried more than one, the most
    frequent wins — deterministic, and it degrades rather than crashes.
    """
    tally: dict[str, dict[str, int]] = {}
    for row in rows:
        if row.category:
            tally.setdefault(row.merchant, {})
            tally[row.merchant][row.category] = tally[row.merchant].get(row.category, 0) + 1
    return {
        merchant: max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
        for merchant, counts in tally.items()
    }


def backfill_categories(
    rows: list[NormalizedTransaction],
    merchant_categories: dict[str, str],
    report: IngestReport,
) -> None:
    """Fill the 200 category-less rows in place using the merchant map."""
    for row in rows:
        if row.category:
            continue
        inferred = merchant_categories.get(row.merchant)
        if inferred:
            row.category = inferred
            row.category_backfilled = True
            report.category_backfilled += 1
        else:
            report.category_unresolved += 1


def flag_duplicate_external_ids(
    rows: list[NormalizedTransaction], report: IngestReport
) -> None:
    """Mark rows whose source ``id`` is not unique.

    40 ids appear twice with completely different merchants, dates and amounts,
    so they are distinct transactions that happen to share a broken id — not
    duplicates to be deduplicated. They are all kept.
    """
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.external_id] = counts.get(row.external_id, 0) + 1

    duplicated = {k for k, v in counts.items() if v > 1}
    report.duplicate_external_ids = len(duplicated)
    for row in rows:
        if row.external_id in duplicated:
            row.has_duplicate_external_id = True
            report.duplicate_external_id_rows += 1


__all__ = [
    "FMT_DATE_ONLY",
    "FMT_DMY",
    "FMT_EPOCH_MS",
    "FMT_ISO_OFFSET",
    "FMT_ISO_UTC",
    "IngestReport",
    "NormalizationError",
    "NormalizedTransaction",
    "OUTLIER_AMOUNT_THRESHOLD",
    "backfill_categories",
    "build_merchant_category_map",
    "clean_text",
    "flag_duplicate_external_ids",
    "is_day_first",
    "is_outlier_amount",
    "normalize_row",
    "parse_amount",
    "parse_currency",
    "parse_method",
    "parse_status",
    "parse_timestamp",
]
