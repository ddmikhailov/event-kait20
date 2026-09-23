from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends

from ..database import Database, execute, row
from ..dependencies import (
    Staff,
    administrator,
    csrf_administrator,
    current_staff,
    database,
)
from ..errors import ApiError
from ..schemas import StreamValues
from ..service_utils import audit, naive_utc
from ..streams import list_streams
from ..tenant_scope import require_event_for_staff

admin = APIRouter(prefix="/admin/events", tags=["event-streams"])
scanner = APIRouter(prefix="/scanner/events", tags=["scanner-streams"])


@admin.get("/{event_id}/streams")
def admin_streams(
    event_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id
        )
        return {"items": list_streams(connection, str(event_id))}


@scanner.get("/{event_id}/streams")
def scanner_streams(
    event_id: UUID,
    staff: Annotated[Staff, Depends(current_staff)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        # Tenant + Organization first (trusted boundary for every role), then
        # SCANNER's event_access as an additional requirement on top of it.
        event = require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id
        )
        if staff.role == "SCANNER" and not row(
            connection,
            "SELECT 1 FROM event_access WHERE event_id=:event AND user_id=:user",
            {"event": str(event_id), "user": staff.id},
        ):
            raise ApiError(403, "FORBIDDEN", "Event access required")
        return {
            "items": list_streams(connection, str(event_id), public=True),
            "streamsEnabled": bool(event["streams_enabled"]),
        }


def save_stream(
    event_id: UUID,
    values: StreamValues,
    staff: Staff,
    db: Database,
    stream_id: UUID | None = None,
) -> dict[str, Any]:
    event_id_s, identity = str(event_id), str(stream_id or uuid4())
    start, end = naive_utc(values.start_at), naive_utc(values.end_at)
    with db.transaction() as connection:
        event = require_event_for_staff(
            connection, event_id_s, staff.tenant_id, staff.organization_id, lock=True
        )
        if event["status"] in {"ARCHIVED", "COMPLETED"}:
            raise ApiError(409, "INVALID_EVENT_STATE", "Event is immutable")
        if end <= start or start < event["start_at"] or end > event["end_at"]:
            raise ApiError(
                400, "INVALID_TIME_RANGE", "Stream must be within Event time range"
            )
        if not event["streams_enabled"] and row(
            connection,
            "SELECT 1 FROM registrations WHERE event_id=:event LIMIT 1",
            {"event": event_id_s},
        ):
            raise ApiError(
                409,
                "STREAM_HISTORY_CONFLICT",
                "Existing registrations cannot be assigned to streams automatically",
            )
        existing = row(
            connection,
            "SELECT * FROM event_streams WHERE id=:id AND event_id=:event",
            {"id": identity, "event": event_id_s},
        )
        if stream_id and not existing:
            raise ApiError(404, "NOT_FOUND", "Stream not found")
        if row(
            connection,
            "SELECT 1 FROM event_streams WHERE event_id=:event AND title=:title AND id<>:id LIMIT 1",
            {"event": event_id_s, "title": values.title, "id": identity},
        ):
            raise ApiError(
                409, "CONFLICT", "Stream titles must be unique within the Event"
            )
        count = row(
            connection,
            "SELECT COUNT(*) AS total FROM registrations WHERE stream_id=:id AND status='ACTIVE'",
            {"id": identity},
        )
        if (
            existing
            and values.capacity != existing["capacity"]
            and values.capacity < int(count["total"] if count else 0)
        ):
            raise ApiError(
                409,
                "CAPACITY_BELOW_ACTIVE_REGISTRATIONS",
                "Stream capacity is below active registrations",
            )
        if not existing:
            total = row(
                connection,
                "SELECT COUNT(*) AS total FROM event_streams WHERE event_id=:event",
                {"event": event_id_s},
            )
            if total and total["total"] >= 100:
                raise ApiError(409, "CONFLICT", "Maximum 100 streams per event")
            execute(
                connection,
                """INSERT INTO event_streams (id,event_id,title,start_at,end_at,capacity,sort_order,active,created_at,updated_at)
                VALUES (:id,:event,:title,:start,:end,:capacity,:sort_order,:active,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    **values.model_dump(),
                    "id": identity,
                    "event": event_id_s,
                    "start": start,
                    "end": end,
                },
            )
        else:
            execute(
                connection,
                """UPDATE event_streams SET title=:title,start_at=:start,end_at=:end,capacity=:capacity,
                sort_order=:sort_order,active=:active,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
                {**values.model_dump(), "id": identity, "start": start, "end": end},
            )
        execute(
            connection,
            """UPDATE events SET streams_enabled=true,
            capacity=(SELECT SUM(capacity) FROM event_streams WHERE event_id=:event),
            offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:event""",
            {"event": event_id_s},
        )
        audit(
            connection,
            staff.id,
            "EVENT_STREAM_UPDATED" if existing else "EVENT_STREAM_CREATED",
            "EventStream",
            identity,
            {"eventId": event_id_s, "active": values.active},
        )
        return next(
            item
            for item in list_streams(connection, event_id_s)
            if item["id"] == identity
        )


@admin.post("/{event_id}/streams", status_code=201)
def create_stream(
    event_id: UUID,
    values: StreamValues,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return save_stream(event_id, values, staff, db)


@admin.patch("/{event_id}/streams/{stream_id}")
def update_stream(
    event_id: UUID,
    stream_id: UUID,
    values: StreamValues,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return save_stream(event_id, values, staff, db, stream_id)
