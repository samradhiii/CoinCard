"""Unit tests for the dirty-data normalisers.

These need no database — they are pure functions, which is exactly why the
normalisation logic lives in ``app.domain`` rather than inside the seed script.

Every case here corresponds to a real quirk found by profiling the supplied
``transactions.json``, not a hypothetical.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.domain.normalize import (
    FMT_DATE_ONLY,
    FMT_DMY,
    FMT_EPOCH_MS,
    FMT_ISO_OFFSET,
    FMT_ISO_UTC,
    IngestReport,
    NormalizationError,
    backfill_categories,
    build_merchant_category_map,
    flag_duplicate_external_ids,
    is_outlier_amount,
    normalize_row,
    parse_amount,
    parse_method,
    parse_status,
    parse_timestamp,
)


# --------------------------------------------------------------------------- #
# Timestamps — all five shapes present in the feed
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("raw", "expected", "fmt"),
    [
        # ISO-8601 with Z (5,476 rows)
        ("2025-10-03T21:03:27Z", datetime(2025, 10, 3, 21, 3, 27, tzinfo=timezone.utc), FMT_ISO_UTC),
        # ISO-8601 with +05:30 offset (1,961 rows) — must convert to UTC, so
        # 06:08 IST becomes 00:38 UTC. Getting this wrong silently shifts ~20%
        # of the dataset by 5.5 hours and moves rows across month boundaries.
        ("2026-03-25T06:08:03+05:30", datetime(2026, 3, 25, 0, 38, 3, tzinfo=timezone.utc), FMT_ISO_OFFSET),
        # Epoch milliseconds as a bare number (1,007 rows)
        (1768265109000, datetime(2026, 1, 13, 0, 45, 9, tzinfo=timezone.utc), FMT_EPOCH_MS),
        # Date only, no clock (715 rows) — anchored to midnight UTC
        ("2025-07-03", datetime(2025, 7, 3, 0, 0, 0, tzinfo=timezone.utc), FMT_DATE_ONLY),
        # DD/MM/YYYY (841 rows). 12/10/2025 is 12 October, not 10 December.
        ("12/10/2025 16:24:49", datetime(2025, 10, 12, 16, 24, 49, tzinfo=timezone.utc), FMT_DMY),
    ],
)
def test_parse_timestamp_handles_every_source_format(raw, expected, fmt):
    parsed, label = parse_timestamp(raw)
    assert parsed == expected
    assert label == fmt


def test_dmy_is_read_day_first():
    """A day component above 12 proves the format is day-first, not US-style."""
    parsed, _ = parse_timestamp("30/07/2025 03:26:03")
    assert parsed.day == 30
    assert parsed.month == 7


def test_epoch_milliseconds_are_not_read_as_seconds():
    parsed, _ = parse_timestamp(1768265109000)
    assert parsed.year == 2026  # would be year 57000+ if read as seconds


@pytest.mark.parametrize("bad", [None, "", "not a date", "31/02/2026 10:00:00", []])
def test_unparseable_timestamps_raise(bad):
    with pytest.raises(NormalizationError):
        parse_timestamp(bad)


# --------------------------------------------------------------------------- #
# Amounts
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (912.62, Decimal("912.62")),
        ("5065.00", Decimal("5065.00")),   # 20 rows arrive as strings
        ("₹1,234.50", Decimal("1234.50")), # defensive: symbols and separators
        (-477.46, Decimal("-477.46")),     # 148 refunds
        (0.005, Decimal("0.01")),          # rounds to 2dp
    ],
)
def test_parse_amount(raw, expected):
    assert parse_amount(raw) == expected


def test_float_amounts_do_not_pick_up_binary_noise():
    """Decimal(float) would give 143.0000000000000284…; Decimal(str) does not."""
    assert parse_amount(143.0) == Decimal("143.00")


@pytest.mark.parametrize("bad", [None, "", "abc", True, {}])
def test_invalid_amounts_raise(bad):
    with pytest.raises(NormalizationError):
        parse_amount(bad)


def test_outlier_detection():
    # The single corrupt row in the dataset.
    assert is_outlier_amount(Decimal("999999999.00")) is True
    # p99 of the real data is ~49,852 — must not be flagged.
    assert is_outlier_amount(Decimal("49852.00")) is False


# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #


def test_lowercase_status_is_normalised():
    """25 rows arrive as 'success' and must not become a separate category."""
    assert parse_status("success") == "SUCCESS"
    assert parse_status("SUCCESS") == "SUCCESS"


@pytest.mark.parametrize("bad", [None, "", "REFUNDED", 42])
def test_unknown_status_raises(bad):
    with pytest.raises(NormalizationError):
        parse_status(bad)


def test_payment_method_aliases():
    assert parse_method("credit card") == "Credit Card"
    assert parse_method("UPI") == "UPI"
    assert parse_method("net banking") == "Netbanking"


# --------------------------------------------------------------------------- #
# Row-level behaviour
# --------------------------------------------------------------------------- #


def _row(**overrides):
    base = {
        "id": "TXN2025000000",
        "timestamp": "2025-10-03T21:03:27Z",
        "merchant": "Cult.fit",
        "category": "Health",
        "amount": 912.62,
        "currency": "INR",
        "status": "SUCCESS",
        "payment_method": "Credit Card",
    }
    base.update(overrides)
    return base


def test_negative_amount_is_flagged_as_refund():
    report = IngestReport()
    row = normalize_row(_row(amount=-477.46), report)
    assert row.is_refund is True
    assert report.refunds == 1


def test_corrupt_amount_is_flagged_but_kept():
    report = IngestReport()
    row = normalize_row(_row(amount=999999999.0), report)
    assert row.is_outlier is True
    # Kept, not dropped — a financial app should not delete a user's record.
    assert row.amount == Decimal("999999999.00")


def test_missing_category_variants_are_counted_separately():
    """The feed has three distinct flavours of 'no category'."""
    report = IngestReport()

    absent = _row()
    del absent["category"]
    normalize_row(absent, report)
    normalize_row(_row(category=None), report)
    normalize_row(_row(category=""), report)

    assert report.category_missing_key == 1
    assert report.category_null == 1
    assert report.category_empty == 1


# --------------------------------------------------------------------------- #
# Cross-row repair
# --------------------------------------------------------------------------- #


def test_categories_are_backfilled_from_the_merchant():
    """The core repair: 200 category-less rows recovered from their merchant."""
    report = IngestReport()
    rows = [
        normalize_row(_row(id="A", merchant="Swiggy", category="Food & Dining"), report),
        normalize_row(_row(id="B", merchant="Swiggy", category=None), report),
        normalize_row(_row(id="C", merchant="Swiggy", category=""), report),
    ]

    mapping = build_merchant_category_map(rows)
    assert mapping["Swiggy"] == "Food & Dining"

    backfill_categories(rows, mapping, report)

    assert all(r.category == "Food & Dining" for r in rows)
    assert rows[0].category_backfilled is False  # came from the file
    assert rows[1].category_backfilled is True   # inferred
    assert rows[2].category_backfilled is True
    assert report.category_backfilled == 2
    assert report.category_unresolved == 0


def test_backfill_leaves_unresolvable_rows_alone():
    """A merchant that never carries a category cannot be inferred — say so."""
    report = IngestReport()
    rows = [normalize_row(_row(merchant="Unknown Co", category=None), report)]
    backfill_categories(rows, build_merchant_category_map(rows), report)

    assert rows[0].category is None
    assert report.category_unresolved == 1


def test_duplicate_external_ids_are_flagged_not_deduplicated():
    """40 source ids are reused by a *different* transaction.

    They are genuinely distinct payments that share a broken id, so both must
    survive — deduplicating would silently delete real transactions.
    """
    report = IngestReport()
    rows = [
        normalize_row(_row(id="TXN2025000336", merchant="ACT Fibernet", amount=3133.69), report),
        normalize_row(_row(id="TXN2025000336", merchant="McDonald's", amount=655.81), report),
        normalize_row(_row(id="TXN2025000999", merchant="Zomato"), report),
    ]

    flag_duplicate_external_ids(rows, report)

    assert len(rows) == 3
    assert rows[0].has_duplicate_external_id is True
    assert rows[1].has_duplicate_external_id is True
    assert rows[2].has_duplicate_external_id is False
    assert report.duplicate_external_ids == 1
    assert report.duplicate_external_id_rows == 2
