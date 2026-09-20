"""Stream capacity is derived from ACTIVE registrations, never an occupied counter."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.engine import Connection, RowMapping

from .database import row, rows
from .errors import ApiError
from .security import utc_iso


def list_streams(
    connection: Connection, event_id: str, public: bool = False
) -> list[dict[str, Any]]:
    items = rows(
        connection,
        """SELECT s.*,COUNT(r.id) AS registered
        FROM event_streams s LEFT JOIN registrations r ON r.stream_id=s.id AND r.status='ACTIVE'
        WHERE s.event_id=:event GROUP BY s.id ORDER BY s.sort_order,s.start_at,s.id""",
        {"event": event_id},
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    return [
        {
            "id": item["id"],
            "eventId": event_id,
            "title": item["title"],
            "startAt": utc_iso(item["start_at"]),
            "endAt": utc_iso(item["end_at"]),
            "capacity": item["capacity"],
            "registered": int(item["registered"]),
            "remaining": max(0, item["capacity"] - int(item["registered"])),
            "active": bool(item["active"]),
            "sortOrder": item["sort_order"],
            "ended": item["end_at"] <= now,
        }
        for item in items
        if not public or item["active"]
    ]


def selected_stream(
    connection: Connection, event: RowMapping, stream_id: str | None
) -> RowMapping | None:
    if not event["streams_enabled"]:
        if stream_id:
            raise ApiError(409, "STREAM_INVALID", "Event has no streams")
        return None
    if not stream_id:
        raise ApiError(409, "STREAM_REQUIRED", "Choose one stream")
    item = row(
        connection,
        "SELECT * FROM event_streams WHERE id=:id AND event_id=:event",
        {"id": stream_id, "event": event["id"]},
    )
    if (
        not item
        or not item["active"]
        or item["end_at"] <= datetime.now(UTC).replace(tzinfo=None)
    ):
        raise ApiError(409, "STREAM_INVALID", "Stream is unavailable")
    return item
