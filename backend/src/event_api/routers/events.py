from datetime import datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Connection, RowMapping

from ..database import Database, execute, row, rows
from ..dependencies import Staff, csrf_super_admin, current_staff, database, super_admin
from ..errors import ApiError
from ..schemas import (
    EventValues,
    FormFieldValues,
    UpdateEventRequest,
    UpdateFormFieldRequest,
)
from ..service_utils import (
    audit,
    db_json,
    event_response,
    field_response,
    json_value,
    naive_utc,
)

admin = APIRouter(prefix="/admin/events", tags=["events"])
scanner = APIRouter(prefix="/scanner/events", tags=["scanner-events"])

TRANSITIONS: dict[str, set[str]] = {
    "DRAFT": {"DRAFT", "REGISTRATION_OPEN"},
    "REGISTRATION_OPEN": {"REGISTRATION_OPEN", "REGISTRATION_CLOSED", "ACTIVE"},
    "REGISTRATION_CLOSED": {
        "REGISTRATION_CLOSED",
        "REGISTRATION_OPEN",
        "ACTIVE",
        "COMPLETED",
    },
    "ACTIVE": {"ACTIVE", "COMPLETED"},
    "COMPLETED": {"COMPLETED"},
    "ARCHIVED": {"ARCHIVED"},
}


def event_row(connection: Connection, event_id: str, lock: bool = False) -> RowMapping:
    item = row(
        connection,
        f"SELECT * FROM events WHERE id=:id{' FOR UPDATE' if lock else ''}",
        {"id": event_id},
    )
    if not item:
        raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
    return item


def validate_dates(start: datetime, end: datetime, deadline: datetime) -> None:
    if end <= start or deadline > start:
        raise ApiError(
            400,
            "INVALID_TIME_RANGE",
            "Event end must follow start and registration deadline cannot follow start",
        )


def assert_slug(connection: Connection, slug: str, event_id: str | None = None) -> None:
    duplicate = row(
        connection,
        "SELECT id FROM events WHERE slug=:slug AND (:id IS NULL OR id<>:id)",
        {"slug": slug, "id": event_id},
    )
    if duplicate:
        raise ApiError(409, "CONFLICT", "Event slug already exists")


@admin.get("")
def list_events(
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            "SELECT * FROM events ORDER BY start_at DESC LIMIT :limit OFFSET :offset",
            {"limit": page_size, "offset": (page - 1) * page_size},
        )
        count = row(connection, "SELECT count(*) AS count FROM events")
    return {
        "items": [event_response(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": int(count["count"] if count else 0),
    }


@admin.post("", status_code=201)
def create_event(
    values: EventValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    if values.status not in {"DRAFT", "REGISTRATION_OPEN"}:
        raise ApiError(
            409,
            "INVALID_EVENT_STATE",
            "New Event must start as DRAFT or REGISTRATION_OPEN",
        )
    validate_dates(values.start_at, values.end_at, values.registration_deadline)
    event_id = str(uuid4())
    with db.transaction() as connection:
        assert_slug(connection, values.slug)
        data = values.model_dump(mode="python")
        execute(
            connection,
            """INSERT INTO events
               (id,title,slug,description,cover_object_key,start_at,end_at,timezone,
                location,registration_deadline,capacity,status,created_by,
                offline_data_version,created_at,updated_at)
               VALUES (:id,:title,:slug,:description,:cover_object_key,:start_at,:end_at,
                       :timezone,:location,:registration_deadline,:capacity,:status,:actor,
                       1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                **data,
                "id": event_id,
                "actor": staff.id,
                "start_at": naive_utc(values.start_at),
                "end_at": naive_utc(values.end_at),
                "registration_deadline": naive_utc(values.registration_deadline),
            },
        )
        created = event_row(connection, event_id)
        audit(
            connection,
            staff.id,
            "EVENT_CREATED",
            "Event",
            event_id,
            {"fields": sorted(values.model_fields_set)},
        )
    return event_response(created)


@admin.get("/{event_id}")
def get_event(
    event_id: UUID,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        return event_response(event_row(connection, str(event_id)))


@admin.patch("/{event_id}")
def update_event(
    event_id: UUID,
    values: UpdateEventRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    with db.transaction() as connection:
        existing = event_row(connection, event_id_s, True)
        if existing["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        changes = values.model_dump(exclude_unset=True)
        next_status = str(changes.get("status", existing["status"]))
        if (
            next_status == "ARCHIVED"
            or next_status not in TRANSITIONS[existing["status"]]
        ):
            raise ApiError(
                409, "INVALID_EVENT_STATE", "Event status transition is not allowed"
            )
        start = naive_utc(changes.get("start_at", existing["start_at"]))
        end = naive_utc(changes.get("end_at", existing["end_at"]))
        deadline = naive_utc(
            changes.get("registration_deadline", existing["registration_deadline"])
        )
        validate_dates(start, end, deadline)
        if "slug" in changes:
            assert_slug(connection, changes["slug"], event_id_s)
        capacity = changes.get("capacity", existing["capacity"])
        active = row(
            connection,
            "SELECT count(*) AS count FROM registrations WHERE event_id=:id AND status='ACTIVE'",
            {"id": event_id_s},
        )
        if capacity < int(active["count"] if active else 0):
            raise ApiError(
                409,
                "CAPACITY_BELOW_ACTIVE_REGISTRATIONS",
                "Capacity cannot be below active registrations",
            )
        merged = {
            key: changes.get(key, existing[key])
            for key in (
                "title",
                "slug",
                "description",
                "cover_object_key",
                "timezone",
                "location",
            )
        }
        execute(
            connection,
            """UPDATE events SET title=:title,slug=:slug,description=:description,
                    cover_object_key=:cover_object_key,start_at=:start,end_at=:end,timezone=:timezone,
                    location=:location,registration_deadline=:deadline,capacity=:capacity,status=:status,
                    offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {
                **merged,
                "start": start,
                "end": end,
                "deadline": deadline,
                "capacity": capacity,
                "status": next_status,
                "id": event_id_s,
            },
        )
        updated = event_row(connection, event_id_s)
        audit(
            connection,
            staff.id,
            "EVENT_UPDATED",
            "Event",
            event_id_s,
            {"fields": sorted(values.model_fields_set)},
        )
    return event_response(updated)


@admin.post("/{event_id}/archive", status_code=201)
def archive_event(
    event_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    with db.transaction() as connection:
        existing = event_row(connection, event_id_s, True)
        if existing["status"] != "ARCHIVED":
            execute(
                connection,
                "UPDATE events SET status='ARCHIVED',archived_at=UTC_TIMESTAMP(3),offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
                {"id": event_id_s},
            )
            audit(connection, staff.id, "EVENT_ARCHIVED", "Event", event_id_s)
        archived = event_row(connection, event_id_s)
    return event_response(archived)


def validate_options(field_type: str, options: Any) -> None:
    choice = field_type in {"SINGLE_CHOICE", "MULTI_CHOICE"}
    if choice and (
        not isinstance(options, list)
        or len(options) < 2
        or len(options) != len(set(options))
    ):
        raise ApiError(
            400, "VALIDATION_ERROR", "Choice fields require at least two unique options"
        )
    if not choice and options is not None:
        raise ApiError(400, "VALIDATION_ERROR", "This field type cannot define options")


@admin.get("/{event_id}/form-fields")
def list_fields(
    event_id: UUID,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        event_row(connection, str(event_id))
        items = rows(
            connection,
            "SELECT * FROM event_form_fields WHERE event_id=:id ORDER BY sort_order,created_at",
            {"id": str(event_id)},
        )
    return {"items": [field_response(item) for item in items]}


@admin.post("/{event_id}/form-fields", status_code=201)
def create_field(
    event_id: UUID,
    values: FormFieldValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    validate_options(str(values.type), values.options)
    field_id = str(uuid4())
    with db.transaction() as connection:
        event = event_row(connection, str(event_id), True)
        if event["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        execute(
            connection,
            """INSERT INTO event_form_fields
            (id,event_id,type,label,required,sort_order,options,active,created_at,updated_at)
            VALUES (:id,:event,:type,:label,:required,:sort,:options,true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": field_id,
                "event": str(event_id),
                "type": str(values.type),
                "label": values.label,
                "required": values.required,
                "sort": values.sort_order,
                "options": db_json(values.options),
            },
        )
        execute(
            connection,
            "UPDATE events SET offline_data_version=offline_data_version+1 WHERE id=:id",
            {"id": str(event_id)},
        )
        audit(
            connection,
            staff.id,
            "EVENT_FORM_FIELD_CREATED",
            "EventFormField",
            field_id,
            {"fields": sorted(values.model_fields_set)},
        )
        created = row(
            connection, "SELECT * FROM event_form_fields WHERE id=:id", {"id": field_id}
        )
    assert created
    return field_response(created)


@admin.patch("/{event_id}/form-fields/{field_id}")
def update_field(
    event_id: UUID,
    field_id: UUID,
    values: UpdateFormFieldRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        event = event_row(connection, str(event_id), True)
        if event["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        existing = row(
            connection,
            "SELECT * FROM event_form_fields WHERE id=:field AND event_id=:event FOR UPDATE",
            {"field": str(field_id), "event": str(event_id)},
        )
        if not existing:
            raise ApiError(404, "NOT_FOUND", "Form field not found")
        changes = values.model_dump(exclude_unset=True)
        field_type = str(changes.get("type", existing["type"]))
        options = (
            changes["options"]
            if "options" in changes
            else json_value(existing["options"])
        )
        validate_options(field_type, options)
        execute(
            connection,
            """UPDATE event_form_fields SET type=:type,label=:label,required=:required,
            sort_order=:sort,options=:options,updated_at=UTC_TIMESTAMP(3) WHERE id=:field AND event_id=:event""",
            {
                "type": field_type,
                "label": changes.get("label", existing["label"]),
                "required": changes.get("required", existing["required"]),
                "sort": changes.get("sort_order", existing["sort_order"]),
                "options": db_json(options),
                "field": str(field_id),
                "event": str(event_id),
            },
        )
        execute(
            connection,
            "UPDATE events SET offline_data_version=offline_data_version+1 WHERE id=:id",
            {"id": str(event_id)},
        )
        audit(
            connection,
            staff.id,
            "EVENT_FORM_FIELD_UPDATED",
            "EventFormField",
            str(field_id),
            {"fields": sorted(values.model_fields_set)},
        )
        updated = row(
            connection,
            "SELECT * FROM event_form_fields WHERE id=:id",
            {"id": str(field_id)},
        )
    assert updated
    return field_response(updated)


@admin.delete("/{event_id}/form-fields/{field_id}")
def deactivate_field(
    event_id: UUID,
    field_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        event = event_row(connection, str(event_id), True)
        if event["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        if not execute(
            connection,
            "UPDATE event_form_fields SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE id=:field AND event_id=:event",
            {"field": str(field_id), "event": str(event_id)},
        ):
            raise ApiError(404, "NOT_FOUND", "Form field not found")
        execute(
            connection,
            "UPDATE events SET offline_data_version=offline_data_version+1 WHERE id=:id",
            {"id": str(event_id)},
        )
        audit(
            connection,
            staff.id,
            "EVENT_FORM_FIELD_DEACTIVATED",
            "EventFormField",
            str(field_id),
        )
        updated = row(
            connection,
            "SELECT * FROM event_form_fields WHERE id=:id",
            {"id": str(field_id)},
        )
    assert updated
    return field_response(updated)


@scanner.get("")
def scanner_events(
    staff: Annotated[Staff, Depends(current_staff)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        if staff.role == "SUPER_ADMIN":
            items = rows(
                connection,
                "SELECT * FROM events WHERE status<>'ARCHIVED' ORDER BY start_at LIMIT 100",
            )
        else:
            items = rows(
                connection,
                """SELECT e.* FROM events e JOIN event_access a ON a.event_id=e.id
                WHERE a.user_id=:user AND a.role='SCANNER' AND e.status<>'ARCHIVED' ORDER BY e.start_at""",
                {"user": staff.id},
            )
    return {
        "items": [
            {
                key: event_response(item)[key]
                for key in (
                    "id",
                    "title",
                    "startAt",
                    "endAt",
                    "timezone",
                    "location",
                    "status",
                )
            }
            for item in items
        ]
    }


@scanner.get("/{event_id}/form-fields")
def scanner_fields(
    event_id: UUID,
    staff: Annotated[Staff, Depends(current_staff)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        event_row(connection, str(event_id))
        if staff.role == "SCANNER" and not row(
            connection,
            "SELECT 1 FROM event_access WHERE event_id=:event AND user_id=:user",
            {"event": str(event_id), "user": staff.id},
        ):
            raise ApiError(403, "FORBIDDEN", "Event access required")
        items = rows(
            connection,
            "SELECT * FROM event_form_fields WHERE event_id=:event AND active=true ORDER BY sort_order,created_at",
            {"event": str(event_id)},
        )
    return {"items": [field_response(item) for item in items]}
