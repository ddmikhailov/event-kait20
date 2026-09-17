from datetime import UTC, datetime
from typing import Any


def effective_status(event: Any, now: datetime | None = None) -> str:
    """Time-derived presentation, without mutating the operator's publication state."""
    now = now or datetime.now(UTC)
    if now.tzinfo is not None:
        now = now.astimezone(UTC).replace(tzinfo=None)
    status = str(event["status"])
    if status in {"DRAFT", "ARCHIVED", "COMPLETED"}:
        return status

    def utc_naive(value: datetime) -> datetime:
        return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value

    if now >= utc_naive(event["end_at"]):
        return "COMPLETED"
    if now >= utc_naive(event["start_at"]):
        return "ACTIVE"
    if status != "REGISTRATION_OPEN" or now >= utc_naive(
        event["registration_deadline"]
    ):
        return "REGISTRATION_CLOSED"
    return "REGISTRATION_OPEN"
