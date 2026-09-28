"""Request-local correlation for compact administrative audit entries."""

from contextvars import ContextVar

current_request_id: ContextVar[str | None] = ContextVar(
    "current_request_id", default=None
)
