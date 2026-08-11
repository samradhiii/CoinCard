"""Rewards endpoints: balance, catalogue, redeem, activity."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbConn, TxConn, TxUser
from app.schemas.common import ErrorResponse
from app.schemas.rewards import (
    ActivityOut,
    BalanceOut,
    CatalogueOut,
    RedeemRequest,
    RedeemResponse,
)
from app.services import rewards as service

router = APIRouter(prefix="/api/rewards", tags=["rewards"])


@router.get("/balance", response_model=BalanceOut, summary="Current coin balance")
async def get_balance(conn: DbConn, user: CurrentUser) -> BalanceOut:
    return BalanceOut(**await service.get_balance_summary(conn, user))


@router.get("/catalogue", response_model=CatalogueOut, summary="Redeemable rewards")
async def get_catalogue(conn: DbConn, user: CurrentUser) -> CatalogueOut:
    return CatalogueOut(**await service.get_catalogue(conn, user))


@router.post(
    "/redeem",
    response_model=RedeemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Redeem coins against a reward",
    responses={
        404: {"model": ErrorResponse, "description": "Reward does not exist"},
        409: {
            "model": ErrorResponse,
            "description": "Balance too low, or reward inactive / out of stock",
        },
        422: {"model": ErrorResponse, "description": "Malformed request body"},
    },
)
async def redeem(payload: RedeemRequest, conn: TxConn, user: TxUser) -> RedeemResponse:
    """Runs inside a single database transaction (see the ``TxConn`` dependency).

    Any error raised below rolls the whole thing back, so a failed redeem can
    never leave coins debited without a redemption to show for it.
    """
    result = await service.redeem(
        conn, user, payload.reward_id, idempotency_key=payload.idempotency_key
    )
    return RedeemResponse(**result)


@router.get("/activity", response_model=ActivityOut, summary="Coin ledger and redemptions")
async def get_activity(conn: DbConn, user: CurrentUser) -> ActivityOut:
    return ActivityOut(**await service.get_activity(conn, user))
