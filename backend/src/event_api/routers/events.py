import hashlib
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.engine import Connection, RowMapping

from ..activity_service import reference
from ..config import Settings
from ..database import Database, execute, row, rows
from ..dependencies import (
    Staff,
    administrator,
    csrf_administrator,
    csrf_super_admin,
    current_staff,
    database,
    settings,
)
from ..errors import ApiError
from ..form_config import event_form_config
from ..media import cover_path, remove_cover, save_cover
from ..schemas import (
    MAX_CUSTOM_ANSWERS,
    EventValues,
    FormFieldValues,
    PurgeEventRequest,
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
media = APIRouter(prefix="/media/event-covers", tags=["event-media"])

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


def event_row(
    connection: Connection,
    event_id: str,
    lock: bool = False,
    tenant_id: str | None = None,
) -> RowMapping:
    tenant_join = " JOIN organizations o ON o.id=e.organization_id" if tenant_id else ""
    tenant_filter = " AND o.tenant_id=:tenant" if tenant_id else ""
    item = row(
        connection,
        f"SELECT e.* FROM events e{tenant_join} WHERE e.id=:id{tenant_filter}"
        f"{' FOR UPDATE' if lock else ''}",
        {"id": event_id, "tenant": tenant_id},
    )
    if not item:
        raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
    return item


def resolve_direction(
    connection: Connection,
    tenant_id: str,
    organization_id: str,
    direction_id: str | None,
    legacy_name: str | None,
) -> tuple[str | None, str | None]:
    if direction_id:
        item = row(
            connection,
            """SELECT id,name,active FROM activity_directions
            WHERE id=:id AND tenant_id=:tenant
              AND (organization_id IS NULL OR organization_id=:organization)""",
            {"id": direction_id, "tenant": tenant_id, "organization": organization_id},
        )
        if not item:
            raise ApiError(404, "DIRECTION_NOT_FOUND", "Activity direction not found")
        if not item["active"]:
            raise ApiError(409, "DIRECTION_INACTIVE", "Activity direction is inactive")
        if legacy_name is not None and legacy_name != item["name"]:
            raise ApiError(409, "CONFLICT", "Direction reference and name do not match")
        return item["id"], item["name"]
    if not legacy_name:
        return None, None
    matches = rows(
        connection,
        """SELECT id,name,active FROM activity_directions
        WHERE tenant_id=:tenant AND name=:name
          AND (organization_id IS NULL OR organization_id=:organization)
        ORDER BY (organization_id=:organization) DESC,created_at""",
        {"tenant": tenant_id, "organization": organization_id, "name": legacy_name},
    )
    if len(matches) > 1:
        raise ApiError(
            409,
            "DIRECTION_AMBIGUOUS",
            "Direction name matches more than one available direction",
        )
    if matches:
        item = matches[0]
        if not item["active"]:
            raise ApiError(409, "DIRECTION_INACTIVE", "Activity direction is inactive")
        return item["id"], item["name"]
    identity = str(uuid4())
    code = (
        "LEGACY_"
        + hashlib.sha256(f"{organization_id}:{legacy_name}".encode())
        .hexdigest()[:16]
        .upper()
    )
    execute(
        connection,
        """INSERT INTO activity_directions
        (id,tenant_id,organization_id,code,name,active,sort_order,created_at,updated_at)
        VALUES (:id,:tenant,:organization,:code,:name,true,1000,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {
            "id": identity,
            "tenant": tenant_id,
            "organization": organization_id,
            "code": code,
            "name": legacy_name,
        },
    )
    return identity, legacy_name


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
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
    include_archived: bool = Query(False, alias="includeArchived"),
) -> dict[str, Any]:
    archived_filter = "" if include_archived else "AND e.status<>'ARCHIVED'"
    with db.connect() as connection:
        items = rows(
            connection,
            f"""SELECT e.* FROM events e JOIN organizations o ON o.id=e.organization_id
            WHERE o.tenant_id=:tenant {archived_filter}
            ORDER BY e.start_at DESC LIMIT :limit OFFSET :offset""",
            {
                "tenant": staff.tenant_id,
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
        count = row(
            connection,
            f"""SELECT count(*) AS count FROM events e
            JOIN organizations o ON o.id=e.organization_id
            WHERE o.tenant_id=:tenant {archived_filter}""",
            {"tenant": staff.tenant_id},
        )
    return {
        "items": [event_response(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": int(count["count"] if count else 0),
    }


@admin.post("", status_code=201)
def create_event(
    values: EventValues,
    staff: Annotated[Staff, Depends(csrf_administrator)],
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
        direction_id, direction_name = resolve_direction(
            connection,
            staff.tenant_id,
            staff.organization_id,
            str(values.direction_id) if values.direction_id else None,
            values.direction,
        )
        if values.season_id:
            reference(connection, "seasons", str(values.season_id), active=False)
        if values.category_id:
            reference(connection, "event_categories", str(values.category_id))
        if values.level_id:
            reference(connection, "event_levels", str(values.level_id))
        data = values.model_dump(mode="python")
        execute(
            connection,
            """INSERT INTO events
               (id,organization_id,title,slug,description,direction,direction_id,form_config,allowed_person_types,is_listed,season_id,category_id,level_id,cover_object_key,start_at,end_at,timezone,
                location,registration_deadline,capacity,status,created_by,
                offline_data_version,created_at,updated_at)
               VALUES (:id,:organization,:title,:slug,:description,:direction,:direction_id,:form_config,:allowed_person_types,:is_listed,:season_id,:category_id,:level_id,NULL,:start_at,:end_at,
                       :timezone,:location,:registration_deadline,:capacity,:status,:actor,
                       1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                **data,
                "form_config": db_json(values.form_config.model_dump(by_alias=True)),
                "allowed_person_types": db_json(values.allowed_person_types),
                "id": event_id,
                "organization": staff.organization_id,
                "direction": direction_name,
                "direction_id": direction_id,
                "actor": staff.id,
                "start_at": naive_utc(values.start_at),
                "end_at": naive_utc(values.end_at),
                "registration_deadline": naive_utc(values.registration_deadline),
            },
        )
        created = event_row(connection, event_id, tenant_id=staff.tenant_id)
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
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        return event_response(
            event_row(connection, str(event_id), tenant_id=staff.tenant_id)
        )


@admin.patch("/{event_id}")
def update_event(
    event_id: UUID,
    values: UpdateEventRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    with db.transaction() as connection:
        existing = event_row(connection, event_id_s, True, staff.tenant_id)
        if existing["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        changes = values.model_dump(exclude_unset=True)
        if "direction" in changes or "direction_id" in changes:
            direction_id, direction_name = resolve_direction(
                connection,
                staff.tenant_id,
                existing["organization_id"],
                str(changes.get("direction_id"))
                if changes.get("direction_id")
                else None,
                changes.get("direction"),
            )
            changes["direction_id"] = direction_id
            changes["direction"] = direction_name
        if "form_config" in changes and changes["form_config"] is None:
            raise ApiError(400, "VALIDATION_ERROR", "Form configuration cannot be null")
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
        if existing["streams_enabled"] and row(
            connection,
            "SELECT 1 FROM event_streams WHERE event_id=:event AND (start_at<:start OR end_at>:end) LIMIT 1",
            {"event": event_id_s, "start": start, "end": end},
        ):
            raise ApiError(
                409, "INVALID_TIME_RANGE", "Event must include all stream times"
            )
        if "slug" in changes:
            assert_slug(connection, changes["slug"], event_id_s)
        for field, table in (
            ("season_id", "seasons"),
            ("category_id", "event_categories"),
            ("level_id", "event_levels"),
        ):
            if field in changes and changes[field] is not None:
                reference(
                    connection,
                    table,
                    str(changes[field]),
                    active=field != "season_id",
                )
        capacity = changes.get("capacity", existing["capacity"])
        if existing["streams_enabled"] and capacity != existing["capacity"]:
            raise ApiError(409, "CONFLICT", "Edit individual stream capacities")
        active = row(
            connection,
            "SELECT count(*) AS count FROM registrations WHERE event_id=:id AND status='ACTIVE'",
            {"id": event_id_s},
        )
        if capacity != existing["capacity"] and capacity < int(
            active["count"] if active else 0
        ):
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
                "direction",
                "timezone",
                "location",
            )
        }
        execute(
            connection,
            """UPDATE events SET title=:title,slug=:slug,description=:description,form_config=:form_config,
                    direction=:direction,direction_id=:direction_id,allowed_person_types=:allowed_person_types,is_listed=:is_listed,
                    season_id=:season_id,category_id=:category_id,level_id=:level_id,start_at=:start,end_at=:end,timezone=:timezone,
                    location=:location,registration_deadline=:deadline,capacity=:capacity,status=:status,
                    offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {
                **merged,
                "direction_id": changes.get("direction_id", existing["direction_id"]),
                "form_config": db_json(changes["form_config"])
                if "form_config" in changes
                else existing["form_config"],
                "is_listed": changes.get("is_listed", existing["is_listed"]),
                "allowed_person_types": db_json(changes["allowed_person_types"])
                if "allowed_person_types" in changes
                else existing["allowed_person_types"],
                "season_id": str(changes["season_id"])
                if changes.get("season_id")
                else changes.get("season_id", existing["season_id"]),
                "category_id": str(changes["category_id"])
                if changes.get("category_id")
                else changes.get("category_id", existing["category_id"]),
                "level_id": str(changes["level_id"])
                if changes.get("level_id")
                else changes.get("level_id", existing["level_id"]),
                "start": start,
                "end": end,
                "deadline": deadline,
                "capacity": capacity,
                "status": next_status,
                "id": event_id_s,
            },
        )
        updated = event_row(connection, event_id_s, tenant_id=staff.tenant_id)
        audit(
            connection,
            staff.id,
            "EVENT_UPDATED",
            "Event",
            event_id_s,
            {"fields": sorted(values.model_fields_set)},
        )
    return event_response(updated)


@admin.post("/{event_id}/cover")
async def upload_event_cover(
    event_id: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
    cover: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    new_key = await save_cover(cover, config.media_root, config.cover_max_bytes)
    previous_key: str | None = None
    try:
        with db.transaction() as connection:
            existing = event_row(connection, event_id_s, True, staff.tenant_id)
            if existing["status"] == "ARCHIVED":
                raise ApiError(
                    409, "INVALID_EVENT_STATE", "Archived Event is immutable"
                )
            previous_key = existing["cover_object_key"]
            execute(
                connection,
                "UPDATE events SET cover_object_key=:key,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
                {"key": new_key, "id": event_id_s},
            )
            audit(connection, staff.id, "EVENT_COVER_UPDATED", "Event", event_id_s)
            updated = event_row(connection, event_id_s, tenant_id=staff.tenant_id)
    except Exception:
        remove_cover(config.media_root, new_key)
        raise
    remove_cover(config.media_root, previous_key)
    return event_response(updated)


@admin.delete("/{event_id}/cover")
def delete_event_cover(
    event_id: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    previous_key: str | None = None
    with db.transaction() as connection:
        existing = event_row(connection, event_id_s, True, staff.tenant_id)
        if existing["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        previous_key = existing["cover_object_key"]
        execute(
            connection,
            "UPDATE events SET cover_object_key=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": event_id_s},
        )
        audit(connection, staff.id, "EVENT_COVER_REMOVED", "Event", event_id_s)
        updated = event_row(connection, event_id_s, tenant_id=staff.tenant_id)
    remove_cover(config.media_root, previous_key)
    return event_response(updated)


@media.get("/{key}", response_class=FileResponse)
def public_event_cover(
    key: str,
    config: Annotated[Settings, Depends(settings)],
) -> FileResponse:
    target = cover_path(config.media_root, key)
    media_type = {
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }[target.suffix]
    return FileResponse(
        target,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@admin.post("/{event_id}/archive", status_code=201)
def archive_event(
    event_id: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    with db.transaction() as connection:
        existing = event_row(connection, event_id_s, True, staff.tenant_id)
        if existing["status"] != "ARCHIVED":
            execute(
                connection,
                "UPDATE events SET status='ARCHIVED',archived_at=UTC_TIMESTAMP(3),offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
                {"id": event_id_s},
            )
            audit(connection, staff.id, "EVENT_ARCHIVED", "Event", event_id_s)
        archived = event_row(connection, event_id_s, tenant_id=staff.tenant_id)
    return event_response(archived)


@admin.post("/{event_id}/purge", status_code=200)
def purge_event(
    event_id: UUID,
    values: PurgeEventRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, str]:
    """Permanently remove one archived Event while preserving global Person rows."""
    event_id_s = str(event_id)
    with db.transaction() as connection:
        existing = event_row(connection, event_id_s, True, staff.tenant_id)
        if existing["status"] != "ARCHIVED":
            raise ApiError(
                409,
                "INVALID_EVENT_STATE",
                "Event must be archived before permanent deletion",
            )
        previous_key = existing["cover_object_key"]
        if values.confirmation_slug != existing["slug"]:
            raise ApiError(
                400,
                "VALIDATION_ERROR",
                "Event slug confirmation does not match",
            )
        activity = row(
            connection,
            """SELECT
            EXISTS(SELECT 1 FROM participations WHERE event_id=:event) AS has_participation,
            EXISTS(SELECT 1 FROM achievements a
                   LEFT JOIN participations p ON p.id=a.participation_id
                   WHERE a.event_id=:event OR p.event_id=:event) AS has_achievement,
            EXISTS(SELECT 1 FROM score_transactions st
                   LEFT JOIN participations p ON p.id=st.participation_id
                   LEFT JOIN achievements a ON a.id=st.achievement_id
                   LEFT JOIN participations ap ON ap.id=a.participation_id
                   WHERE p.event_id=:event OR a.event_id=:event OR ap.event_id=:event)
              AS has_score""",
            {"event": event_id_s},
        )
        if activity and any(bool(value) for value in activity.values()):
            raise ApiError(
                409,
                "EVENT_HAS_ACTIVITY_HISTORY",
                "Event has Activity history and cannot be permanently deleted; archive it instead",
            )
        preserved = row(
            connection,
            "SELECT count(DISTINCT person_id) AS count FROM registrations WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            """DELETE FROM audit_log
               WHERE (entity_type='Event' AND entity_id=:event)
                  OR entity_id IN (SELECT id FROM registrations WHERE event_id=:event)
                  OR entity_id IN (SELECT id FROM event_form_fields WHERE event_id=:event)
                  OR entity_id IN (SELECT id FROM event_streams WHERE event_id=:event)
                  OR entity_id IN (SELECT id FROM import_jobs WHERE event_id=:event)""",
            {"event": event_id_s},
        )
        execute(
            connection,
            """DELETE FROM email_deliveries
               WHERE event_id=:event
                  OR registration_id IN (SELECT id FROM registrations WHERE event_id=:event)
                  OR staff_invitation_id IN (SELECT id FROM staff_invitations WHERE event_id=:event)""",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM staff_invitations WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            """DELETE FROM registration_answers
               WHERE registration_id IN (SELECT id FROM registrations WHERE event_id=:event)""",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM attendance_events WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM import_jobs WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM event_access WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM registration_requests WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM registrations WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM event_form_fields WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(
            connection,
            "DELETE FROM event_streams WHERE event_id=:event",
            {"event": event_id_s},
        )
        execute(connection, "DELETE FROM events WHERE id=:event", {"event": event_id_s})
        audit(
            connection,
            staff.id,
            "EVENT_PURGED",
            "PurgedEvent",
            event_id_s,
            {"preservedPersonCount": int(preserved["count"] if preserved else 0)},
        )
    remove_cover(config.media_root, previous_key)
    return {"status": "accepted"}


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
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        event_row(connection, str(event_id), tenant_id=staff.tenant_id)
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
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    validate_options(str(values.type), values.options)
    field_id = str(uuid4())
    with db.transaction() as connection:
        event = event_row(connection, str(event_id), True, staff.tenant_id)
        if event["status"] == "ARCHIVED":
            raise ApiError(409, "INVALID_EVENT_STATE", "Archived Event is immutable")
        active_count = row(
            connection,
            "SELECT COUNT(*) AS total FROM event_form_fields WHERE event_id=:event AND active=true",
            {"event": str(event_id)},
        )
        if int(active_count["total"] if active_count else 0) >= MAX_CUSTOM_ANSWERS:
            raise ApiError(
                409,
                "FORM_FIELD_LIMIT_EXCEEDED",
                f"Maximum {MAX_CUSTOM_ANSWERS} active custom fields per event",
            )
        execute(
            connection,
            """INSERT INTO event_form_fields
            (id,event_id,type,label,required,onsite_required,sort_order,options,active,created_at,updated_at)
            VALUES (:id,:event,:type,:label,:required,:onsite_required,:sort,:options,true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": field_id,
                "event": str(event_id),
                "type": str(values.type),
                "label": values.label,
                "required": values.required,
                "onsite_required": values.onsite_required,
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
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        event = event_row(connection, str(event_id), True, staff.tenant_id)
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
            """UPDATE event_form_fields SET type=:type,label=:label,required=:required,onsite_required=:onsite_required,
            sort_order=:sort,options=:options,updated_at=UTC_TIMESTAMP(3) WHERE id=:field AND event_id=:event""",
            {
                "type": field_type,
                "label": changes.get("label", existing["label"]),
                "required": changes.get("required", existing["required"]),
                "onsite_required": changes.get(
                    "onsite_required", existing["onsite_required"]
                ),
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
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        event = event_row(connection, str(event_id), True, staff.tenant_id)
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
        if staff.role != "SCANNER":
            items = rows(
                connection,
                """SELECT e.* FROM events e JOIN organizations o ON o.id=e.organization_id
                WHERE o.tenant_id=:tenant AND e.status<>'ARCHIVED'
                ORDER BY e.start_at LIMIT 100""",
                {"tenant": staff.tenant_id},
            )
        else:
            items = rows(
                connection,
                """SELECT e.* FROM events e JOIN event_access a ON a.event_id=e.id
                JOIN organizations o ON o.id=e.organization_id
                WHERE a.user_id=:user AND o.tenant_id=:tenant AND a.role='SCANNER'
                  AND e.status<>'ARCHIVED' ORDER BY e.start_at""",
                {"user": staff.id, "tenant": staff.tenant_id},
            )
    return {
        "items": [
            {
                key: event_response(item)[key]
                for key in (
                    "id",
                    "title",
                    "allowedPersonTypes",
                    "streamsEnabled",
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
        event = event_row(connection, str(event_id), tenant_id=staff.tenant_id)
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
    return {
        "items": [field_response(item) for item in items],
        "systemFields": event_form_config(event)["onsite"],
        "allowedPersonTypes": json_value(event["allowed_person_types"]),
    }
