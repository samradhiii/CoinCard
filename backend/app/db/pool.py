"""Postgres connection pooling.

Raw SQL over psycopg 3 rather than an ORM. The interesting work here is the
query shape — window-function pagination, filtered aggregates for the charts,
``SELECT ... FOR UPDATE`` on redeem — and hand-written SQL makes all of that
visible instead of hiding it behind a query builder. See DECISIONS.md.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from psycopg import AsyncConnection, Connection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import get_settings

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

#: Pin every session to UTC.
#:
#: This is a correctness requirement, not a preference. A bare date in a filter
#: (``date_from=2026-03-01``) is cast to ``timestamptz`` using the *session*
#: timezone, while the monthly-trend query buckets with ``AT TIME ZONE 'UTC'``
#: (it has to — see schema.sql). On a machine running IST those two disagree by
#: 5.5 hours, so "all of March" quietly returned rows that bucketed into
#: February. Worse, the same request would return different results on a
#: developer's laptop and on a UTC production server.
#:
#: Every timestamp in this database was normalised to UTC at ingest, so pinning
#: the session to UTC makes filtering, bucketing and JSON serialisation agree
#: everywhere. The browser still renders in the viewer's local timezone.
SESSION_OPTIONS = "-c timezone=UTC"

_pool: AsyncConnectionPool | None = None


async def open_pool() -> AsyncConnectionPool:
    """Create the pool. Called once on application startup."""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = AsyncConnectionPool(
            conninfo=settings.database_url,
            min_size=settings.pool_min_size,
            max_size=settings.pool_max_size,
            kwargs={"row_factory": dict_row, "options": SESSION_OPTIONS},
            open=False,
        )
        await _pool.open(wait=True, timeout=30)
        logger.info("postgres pool opened (max_size=%s)", settings.pool_max_size)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("postgres pool closed")


def get_pool() -> AsyncConnectionPool:
    if _pool is None:  # pragma: no cover - guarded by app lifespan
        raise RuntimeError("connection pool is not open")
    return _pool


@asynccontextmanager
async def connection() -> AsyncIterator[AsyncConnection]:
    """Borrow a connection. Autocommit-per-statement unless a tx is opened."""
    async with get_pool().connection() as conn:
        yield conn


@asynccontextmanager
async def transaction() -> AsyncIterator[AsyncConnection]:
    """Borrow a connection inside an explicit transaction.

    Everything in the block commits together or rolls back together — this is
    what makes the redeem path safe.
    """
    async with get_pool().connection() as conn:
        async with conn.transaction():
            yield conn


# --------------------------------------------------------------------------- #
# Sync helpers — used by the seed script and tests, which are not async.
# --------------------------------------------------------------------------- #


@contextmanager
def sync_connection(dsn: str | None = None) -> Iterator[Connection]:
    dsn = dsn or get_settings().database_url
    with Connection.connect(
        dsn, row_factory=dict_row, autocommit=False, options=SESSION_OPTIONS
    ) as conn:
        yield conn


def read_schema_sql() -> str:
    return SCHEMA_PATH.read_text(encoding="utf-8")
