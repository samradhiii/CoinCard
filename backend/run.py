"""Development server entrypoint.

    python run.py

Exists because of one platform detail: psycopg's async connections cannot run
on asyncio's ``ProactorEventLoop``, which is the default on Windows. The bare
``uvicorn app.main:app`` CLI therefore hangs on startup there with a pool
timeout. ``asyncio.set_event_loop_policy`` no longer fixes it either — it is
deprecated in Python 3.14 and uvicorn builds its own loop regardless.

Running the server inside ``asyncio.run(..., loop_factory=...)`` is the current
supported way to choose the loop, so that is what this does — on Windows only.
Linux (the Docker image, and any deployment) keeps using the plain uvicorn CLI
from the Dockerfile and is untouched by this file.
"""

from __future__ import annotations

import asyncio
import os
import selectors
import sys

import uvicorn


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload_enabled = os.getenv("RELOAD", "0") == "1"

    if sys.platform == "win32" and not reload_enabled:
        config = uvicorn.Config("app.main:app", host=host, port=port, log_level="info")
        server = uvicorn.Server(config)
        if sys.version_info >= (3, 12):
            asyncio.run(
                server.serve(),
                loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
            )
        else:
            loop = asyncio.SelectorEventLoop(selectors.SelectSelector())
            asyncio.set_event_loop(loop)
            loop.run_until_complete(server.serve())
        return

    # Non-Windows, or reload mode (which needs uvicorn's own supervisor process).
    uvicorn.run("app.main:app", host=host, port=port, reload=reload_enabled)


if __name__ == "__main__":
    main()
