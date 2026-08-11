"""Health and data-quality endpoints.

``/api/meta/data-quality`` exists because the supplied dataset is dirty and the
app would rather say so than quietly hide it. The UI renders this as a panel.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.api.deps import DbConn
from app.domain import coins as coin_rules
from app.services import transactions as service

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("/data-quality", summary="What the ingest had to repair, and why")
async def data_quality(conn: DbConn) -> dict[str, Any]:
    report = await service.get_data_quality(conn)
    return {
        **report,
        "rules": {
            "rupees_per_coin": int(coin_rules.RUPEES_PER_COIN),
            "max_coins_per_transaction": coin_rules.MAX_COINS_PER_TRANSACTION,
            "earning_status": coin_rules.EARNING_STATUS,
        },
        "notes": [
            "Timestamps arrived in 5 different shapes and were normalised to UTC.",
            "Negative amounts are treated as refunds: shown in the table, "
            "excluded from spend totals, and they earn no coins.",
            "One transaction has a corrupt magnitude (₹999,999,999). It is kept "
            "and flagged but excluded from analytics so it cannot flatten a chart.",
            "200 rows had a missing, null or empty category. Each was backfilled "
            "from its merchant, which maps 1:1 to a category in this dataset.",
            "40 source ids are reused by a second, unrelated transaction, so the "
            "source id is not the primary key.",
        ],
    }
