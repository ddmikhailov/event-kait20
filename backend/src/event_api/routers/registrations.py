from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from ..config import Settings
from ..database import Database, row
from ..dependencies import Staff, csrf_staff, database, settings
from ..errors import ApiError
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

public = APIRouter(prefix="/public/events", tags=["public-registration"])
tickets = APIRouter(prefix="/tickets", tags=["tickets"])
scanner = APIRouter(prefix="/scanner/events", tags=["scanner-registration"])
admin = APIRouter(prefix="/admin/events", tags=["admin-registration"])


@public.get("/{slug}")
def public_event(
    slug: str,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    with db.connect() as connection:
        event = row(
            connection,
            """SELECT id,title,slug,description,cover_object_key,start_at,end_at,
            timezone,location,registration_deadline,capacity,status FROM events WHERE slug=:slug""",
            {"slug": slug},
        )
        if not event:
            raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
        fields = form_fields(connection, event["id"])
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
    return {
        "id": event["id"],
        "title": event["title"],
        "slug": event["slug"],
        "description": event["description"],
        "coverObjectKey": event["cover_object_key"],
        "startAt": utc_iso(event["start_at"]),
        "endAt": utc_iso(event["end_at"]),
        "timezone": event["timezone"],
        "location": event["location"],
        "availability": availability,
        "consentUrl": str(config.consent_url),
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
    if values.capacity_override and staff.role != "SUPER_ADMIN":
        raise ApiError(403, "FORBIDDEN", "Capacity override is not permitted")
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
                False,
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
    if staff.role != "SUPER_ADMIN":
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
    if staff.role == "SCANNER" and values.capacity_override:
        raise ApiError(400, "VALIDATION_ERROR", "capacityOverride is not allowed")
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
            """SELECT e.title,e.start_at,e.end_at,e.timezone,e.location,
            r.last_name,r.first_name,r.middle_name FROM registrations r JOIN events e ON e.id=r.event_id
            WHERE r.public_id=:public AND r.status='ACTIVE'""",
            {"public": str(public_id)},
        )
    if not item:
        raise ApiError(404, "INVALID_QR", "Ticket is not valid")
    return {
        "event": {
            "title": item["title"],
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
