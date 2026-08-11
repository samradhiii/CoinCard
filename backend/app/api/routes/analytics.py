"""Analytics endpoints.

Takes the same filter query params as ``/api/transactions``, which is what
makes chart↔table cross-filtering two-way: the frontend sends one filter state
to both endpoints and they cannot disagree.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DbConn, Filters
from app.schemas.analytics import AnalyticsOut
from app.services import analytics as service

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get(
    "",
    response_model=AnalyticsOut,
    summary="Spend summary, category breakdown and monthly trend for a filter set",
)
async def get_analytics(conn: DbConn, filters: Filters) -> AnalyticsOut:
    return AnalyticsOut(**await service.get_overview(conn, filters))
