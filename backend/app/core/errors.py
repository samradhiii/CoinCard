"""Domain errors and the HTTP shape they map to.

Services raise these; the API layer translates them. Business logic therefore
never imports FastAPI, which keeps it testable without an HTTP client.
"""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base class for expected, client-facing failures."""

    status_code: int = 400
    code: str = "bad_request"

    def __init__(self, message: str, **details: Any) -> None:
        super().__init__(message)
        self.message = message
        self.details = details

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"error": {"code": self.code, "message": self.message}}
        if self.details:
            payload["error"]["details"] = self.details
        return payload


class NotFoundError(DomainError):
    """404 — the addressed resource does not exist."""

    status_code = 404
    code = "not_found"


class InsufficientBalanceError(DomainError):
    """409 — the request is well-formed but the user cannot afford it.

    409 rather than 400: the payload is valid, it is the *current server state*
    (the balance) that makes it fail, and it would succeed after earning more.
    """

    status_code = 409
    code = "insufficient_balance"


class RewardUnavailableError(DomainError):
    """409 — the reward exists but is inactive or out of stock."""

    status_code = 409
    code = "reward_unavailable"


class ValidationError(DomainError):
    """422 — semantically invalid input that Pydantic could not catch."""

    status_code = 422
    code = "validation_error"
