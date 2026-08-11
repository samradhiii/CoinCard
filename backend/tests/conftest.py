"""Test fixtures.

The redeem tests run against a **real PostgreSQL database**, not a mock. The
whole point of that endpoint is its transactional behaviour — ``SELECT … FOR
UPDATE``, the ledger constraints, rollback on error. A mocked repository would
assert that the code calls functions in an order, which proves nothing about
whether the balance can go negative.

Each test runs inside a transaction that is rolled back afterwards, so the
suite leaves the seeded database exactly as it found it.
"""

from __future__ import annotations

import asyncio
import os
import selectors
import sys
from collections.abc import AsyncIterator, Iterator

import pytest

DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://coincard:coincard@localhost:5433/coincard"),
)


@pytest.fixture(scope="session")
def event_loop_policy():
    """psycopg's async driver cannot run on Windows' default Proactor loop."""
    if sys.platform == "win32":
        return _SelectorPolicy()
    return asyncio.get_event_loop_policy()


class _SelectorPolicy(asyncio.DefaultEventLoopPolicy):  # pragma: no cover - win32
    def new_event_loop(self):
        return asyncio.SelectorEventLoop(selectors.SelectSelector())


@pytest.fixture(scope="session")
def database_url() -> str:
    return DATABASE_URL


@pytest.fixture(scope="session")
def require_seeded_db(database_url: str) -> None:
    """Skip the integration tests cleanly if the database isn't up and seeded."""
    import psycopg

    try:
        with psycopg.connect(database_url, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM transactions")
                count = cur.fetchone()
                if not count or count[0] == 0:
                    pytest.skip("database is empty — run the seed first")
                cur.execute("SELECT COUNT(*) FROM rewards")
                rewards = cur.fetchone()
                if not rewards or rewards[0] == 0:
                    pytest.skip("no rewards seeded")
    except psycopg.OperationalError as exc:
        pytest.skip(f"PostgreSQL not reachable at {database_url}: {exc}")
    except psycopg.errors.UndefinedTable:
        pytest.skip("schema not applied — run the seed first")


@pytest.fixture
async def conn(database_url: str, require_seeded_db: None) -> AsyncIterator["object"]:
    """An open connection inside a transaction that is always rolled back.

    Using an explicit ``rollback()`` rather than a committed cleanup means a
    test that debits coins cannot leak that debit into the next test — or into
    the database the reviewer is about to open in the browser.
    """
    from psycopg import AsyncConnection
    from psycopg.rows import dict_row

    from app.db.pool import SESSION_OPTIONS

    # Same UTC session pinning the app uses, so tests exercise real behaviour.
    connection = await AsyncConnection.connect(
        database_url, row_factory=dict_row, options=SESSION_OPTIONS
    )
    try:
        tx = connection.transaction(force_rollback=True)
        async with tx:
            yield connection
    finally:
        await connection.close()


@pytest.fixture
async def user(conn) -> dict:
    from app.repositories import rewards as repo

    found = await repo.get_user_by_email(conn, "aarav@coincard.app")
    if found is None:
        pytest.skip("demo user not seeded")
    return found
