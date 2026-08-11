"""Application settings, read once from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _split_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL", "postgresql://coincard:coincard@localhost:5433/coincard"
        )
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _split_csv(
            os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
        )
    )
    #: Single-user demo app — every request acts as this user.
    demo_user_email: str = field(
        default_factory=lambda: os.getenv("DEMO_USER_EMAIL", "aarav@coincard.app")
    )
    pool_min_size: int = field(default_factory=lambda: int(os.getenv("POOL_MIN_SIZE", "1")))
    pool_max_size: int = field(default_factory=lambda: int(os.getenv("POOL_MAX_SIZE", "10")))
    default_page_size: int = 25
    max_page_size: int = 200
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "development"))

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
