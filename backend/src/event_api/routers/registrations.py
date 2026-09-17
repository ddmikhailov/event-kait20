from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from ..config import Settings
from ..database import Database, row, rows
from ..dependencies import Staff, csrf_staff, database, settings
from ..errors import ApiError
from ..event_status import effective_status
from ..form_config import event_form_config
from ..registration_service import (
    acquire_person_locks,
    form_fields,
    participant,
    register,
    release_person_locks,
)
from ..schemas import OnsiteRegistrationRequest, PublicRegistrationRequest
from ..security import registration_qr, utc_iso, verify_registration
from ..service_utils import json_value
from ..streams import list_streams

public = APIRouter(prefix="/public/events", tags=["public-registration"])
tickets = APIRouter(prefix="/tickets", tags=["tickets"])
scanner = APIRouter(prefix="/scanner/events", tags=["scanner-registration"])
admin = APIRouter(prefix="/admin/events", tags=["admin-registration"])


@public.get("")
def public_events(
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    now = datetime.now(UTC).replace(tzinfo=None)
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT id,title,slug,description,direction,cover_object_key,start_at,end_at,
                      timezone,location,registration_deadline,status
               FROM events
               WHERE is_listed=true AND status IN ('REGISTRATION_OPEN','REGISTRATION_CLOSED','ACTIVE') AND end_at>:now
               ORDER BY start_at ASC LIMIT 200""",
            {"now": now},
        )
    return {
        "items": [
            {
                "id": item["id"],
                "effectiveStatus": effective_status(item, now),
                "title": item["title"],
                "slug": item["slug"],
                "description": item["description"],
                "direction": item["direction"],
                "coverObjectKey": item["cover_object_key"],
                "startAt": utc_iso(item["start_at"]),
                "endAt": utc_iso(item["end_at"]),
                "timezone": item["timezone"],
                "location": item["location"],
                "registrationDeadline": utc_iso(item["registration_deadline"]),
            }
            for item in items
        ]
    }


@public.get("/{slug}")
def public_event(
    slug: str,
    response: Response,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    with db.connect() as connection:
        event = row(
            connection,
            """SELECT id,title,slug,description,direction,cover_object_key,start_at,end_at,
            timezone,form_config,allowed_person_types,is_listed,streams_enabled,location,registration_deadline,capacity,status FROM events WHERE slug=:slug""",
            {"slug": slug},
        )
        if not event or event["status"] in {"DRAFT", "ARCHIVED"}:
            raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
        if not event["is_listed"]:
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        fields = form_fields(connection, event["id"])
        streams = list_streams(connection, event["id"], public=True)
        count = row(
            connection,
            "SELECT count(*) AS count FROM registrations WHERE event_id=:event AND status='ACTIVE'",
            {"event": event["id"]},
        )
    now = datetime.now(UTC).replace(tzinfo=None)
    availability = (
        "CLOSED"
        if event["status"] != "REGISTRATION_OPEN"
        or event["registration_deadline"] <= now
        else (
            "FULL"
            if int(count["count"] if count else 0) >= event["capacity"]
            else "OPEN"
        )
    )
    if availability != "CLOSED" and event["streams_enabled"]:
        availability = (
            "OPEN"
            if any(item["remaining"] > 0 and not item["ended"] for item in streams)
            else "FULL"
        )
    return {
        "id": event["id"],
        "title": event["title"],
        "slug": event["slug"],
        "description": event["description"],
        "direction": event["direction"],
        "allowedPersonTypes": json_value(event["allowed_person_types"]),
        "systemFields": event_form_config(event)["public"],
        "streamsEnabled": bool(event["streams_enabled"]),
        "streams": streams,
        "coverObjectKey": event["cover_object_key"],
        "startAt": utc_iso(event["start_at"]),
        "endAt": utc_iso(event["end_at"]),
        "timezone": event["timezone"],
        "location": event["location"],
        "availability": availability,
        "effectiveStatus": effective_status(event, now),
        "registrationDeadline": utc_iso(event["registration_deadline"]),
        "consentUrl": str(config.consent_url),
        "privacyPolicyUrl": str(config.privacy_policy_url),
        "consentVersion": config.consent_version,
        "formFields": [
            {
                "id": field["id"],
                "type": field["type"],
                "label": field["label"],
                "required": bool(field["required"]),
                "sortOrder": field["sort_order"],
                "options": json_value(field["options"])
                if isinstance(json_value(field["options"]), list)
                else None,
            }
            for field in fields
        ],
    }


@public.post("/{slug}/register")
def public_register(
    slug: str,
    values: PublicRegistrationRequest,
    request: Request,
    response: Response,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    request.app.state.rate_limiter.consume(
        "public-registration", request.client.host if request.client else "unknown"
    )
    if values.consent_version != config.consent_version:
        raise ApiError(
            409, "FORM_VERSION_INVALID", "Consent version is no longer current"
        )
    with db.connect() as connection:
        transaction = connection.begin()
        locks: list[str] = []
        try:
            event = row(
                connection,
                "SELECT * FROM events WHERE slug=:slug FOR UPDATE",
                {"slug": slug},
            )
            if not event:
                raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
            if event["status"] != "REGISTRATION_OPEN" or event[
                "registration_deadline"
            ] <= datetime.now(UTC).replace(tzinfo=None):
                raise ApiError(409, "REGISTRATION_CLOSED", "Registration is closed")
            locks = acquire_person_locks(connection, participant(values))
            result = register(
                connection, event, values, config, "PUBLIC_FORM", True, None, False
            )
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise
        finally:
            release_person_locks(connection, locks)
    response.status_code = 201 if result["status"] == "REGISTERED" else 200
    return result


def onsite(
    event_id: str,
    values: OnsiteRegistrationRequest,
    staff: Staff,
    db: Database,
    config: Settings,
) -> dict[str, Any]:
    with db.connect() as connection:
        transaction = connection.begin()
        locks: list[str] = []
        try:
            event = row(
                connection,
                "SELECT * FROM events WHERE id=:id FOR UPDATE",
                {"id": event_id},
            )
            if not event:
                raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
            if event["status"] not in {
                "REGISTRATION_OPEN",
                "REGISTRATION_CLOSED",
                "ACTIVE",
            }:
                raise ApiError(
                    409,
                    "INVALID_EVENT_STATE",
                    "Onsite registration is not allowed for this Event state",
                )
            if staff.role == "SCANNER" and not row(
                connection,
                "SELECT 1 FROM event_access WHERE event_id=:event AND user_id=:user",
                {"event": event_id, "user": staff.id},
            ):
                raise ApiError(403, "FORBIDDEN", "Event access is required")
            locks = acquire_person_locks(connection, participant(values))
            result = register(
                connection,
                event,
                values,
                config,
                "ONSITE",
                True,
                staff,
                values.capacity_override,
            )
            transaction.commit()
        except Exception:
            transaction.rollback()
            raise
        finally:
            release_person_locks(connection, locks)
    return result


@admin.post("/{event_id}/registrations/onsite", status_code=201)
def admin_onsite(
    event_id: UUID,
    values: OnsiteRegistrationRequest,
    staff: Annotated[Staff, Depends(csrf_staff)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    if staff.role == "SCANNER":
        raise ApiError(403, "FORBIDDEN", "Insufficient permission")
    return onsite(str(event_id), values, staff, db, config)


@scanner.post("/{event_id}/registrations/onsite", status_code=201)
def scanner_onsite(
    event_id: UUID,
    values: OnsiteRegistrationRequest,
    staff: Annotated[Staff, Depends(csrf_staff)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    return onsite(str(event_id), values, staff, db, config)


@tickets.get("/{public_id}/{signature}")
def ticket(
    public_id: UUID,
    signature: str,
    request: Request,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    request.app.state.rate_limiter.consume(
        "public-ticket", request.client.host if request.client else "unknown"
    )
    if not verify_registration(str(public_id), signature, config.qr_signing_secret):
        raise ApiError(404, "INVALID_QR", "Ticket is not valid")
    with db.connect() as connection:
        item = row(
            connection,
            """SELECT e.title,COALESCE(s.start_at,e.start_at) AS start_at,
            COALESCE(s.end_at,e.end_at) AS end_at,e.timezone,e.location,s.title AS stream_title,
            r.last_name,r.first_name,r.middle_name FROM registrations r JOIN events e ON e.id=r.event_id
            LEFT JOIN event_streams s ON s.id=r.stream_id
            WHERE r.public_id=:public AND r.status='ACTIVE'""",
            {"public": str(public_id)},
        )
    if not item:
        raise ApiError(404, "INVALID_QR", "Ticket is not valid")
    return {
        "event": {
            "title": item["title"],
            "streamTitle": item["stream_title"],
            "startAt": utc_iso(item["start_at"]),
            "endAt": utc_iso(item["end_at"]),
            "timezone": item["timezone"],
            "location": item["location"],
        },
        "participantName": {
            "lastName": item["last_name"],
            "firstName": item["first_name"],
            "middleName": item["middle_name"],
        },
        "qrPayload": registration_qr(str(public_id), config.qr_signing_secret),
    }
