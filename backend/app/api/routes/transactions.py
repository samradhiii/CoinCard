"""Transaction endpoints.

Pagination, filtering and sorting all happen in Postgres. The browser receives
one page (25 rows by default), never all 10,000.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query

from app.api.deps import DbConn, Filters
from app.core.config import get_settings
from app.schemas.common import FacetsOut, Page, TransactionDetailOut, TransactionOut
from app.services import transactions as service

router = APIRouter(prefix="/api/transactions", tags=["transactions"])
settings = get_settings()


@router.get(
    "",
    response_model=Page[TransactionOut],
    summary="List transactions (server-side paginated, filtered and sorted)",
)
async def list_transactions(
    conn: DbConn,
    filters: Filters,
    sort: Annotated[Literal["date", "amount", "merchant"], Query()] = "date",
    order: Annotated[Literal["asc", "desc"], Query()] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=settings.max_page_size)] = settings.default_page_size,
) -> Page[TransactionOut]:
    result = await service.list_page(
        conn, filters, sort=sort, order=order, page=page, page_size=page_size
    )
    return Page[TransactionOut](**result)


@router.get(
    "/facets",
    response_model=FacetsOut,
    summary="Filter options and value bounds derived from the data",
)
async def get_facets(conn: DbConn) -> FacetsOut:
    return FacetsOut(**await service.get_facets(conn))


@router.get(
    "/{transaction_id}",
    response_model=TransactionDetailOut,
    summary="One transaction, with any rows sharing its (non-unique) source id",
    responses={404: {"description": "Transaction not found"}},
)
async def get_transaction(
    conn: DbConn,
    transaction_id: Annotated[int, Path(ge=1)],
) -> TransactionDetailOut:
    return TransactionDetailOut(**await service.get_detail(conn, transaction_id))
