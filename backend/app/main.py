"""FastAPI application entry point.

Layering, outermost to innermost::

    api/routes/    HTTP only — parse, delegate, serialise
    services/      business rules, framework-free and unit-testable
    repositories/  SQL; the only layer that knows about psycopg
    domain/        pure functions: normalisation, coin maths

A route never writes SQL and a service never imports FastAPI.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

# NOTE for Windows dev: psycopg's async connections cannot run on asyncio's
# ProactorEventLoop (the Windows default). Use `python run.py`, which supplies a
# selector loop, rather than the bare `uvicorn` CLI. Linux — including the
# Docker image and any deployment — is unaffected.

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import analytics, meta, rewards, transactions
from app.core.config import get_settings
from app.core.errors import DomainError
from app.db import pool

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("coincard")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await pool.open_pool()
    try:
        yield
    finally:
        await pool.close_pool()


app = FastAPI(
    title="CoinCard API",
    version="1.0.0",
    description=(
        "Backend for CoinCard — a credit-card transactions, spend analytics and "
        "reward-coins dashboard. Pagination, filtering, sorting and all "
        "aggregation happen in PostgreSQL."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    """Server-render time, so the "is it the DB or the browser?" question is
    answerable from the network tab alone."""
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Response-Time-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
    return response


@app.exception_handler(DomainError)
async def handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
    """One place that turns a domain failure into its HTTP status.

    Services raise ``InsufficientBalanceError``; this decides that means 409.
    """
    return JSONResponse(status_code=exc.status_code, content=exc.to_payload())


@app.get("/health", tags=["meta"], summary="Liveness + database reachability")
async def health() -> dict[str, object]:
    try:
        async with pool.connection() as conn, conn.cursor() as cur:
            await cur.execute("SELECT 1 AS ok, version() AS version")
            row = await cur.fetchone()
        return {
            "status": "ok",
            "database": "connected",
            "postgres": (row or {}).get("version", "").split(",")[0],
        }
    except Exception as exc:  # pragma: no cover - surfaced in deployment
        logger.exception("health check failed")
        return {"status": "degraded", "database": "unreachable", "detail": str(exc)}


app.include_router(transactions.router)
app.include_router(analytics.router)
app.include_router(rewards.router)
app.include_router(meta.router)
