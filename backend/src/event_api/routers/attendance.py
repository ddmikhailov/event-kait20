import hashlib
import json
from datetime import timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError

from ..config import Settings
from ..database import Database, execute, row, rows
from ..dependencies import Staff, csrf_staff, current_staff, database, settings
from ..errors import ApiError
from ..registration_service import qr_hash
from ..schemas import AttendanceItem, AttendanceSyncRequest, ResolveQrRequest
from ..security import utc_iso, verify_registration

router = APIRouter(prefix="/scanner/events", tags=["attendance"])
MAX_BUNDLE_ROWS = 5_000


def event_context(db: Database, event_id: str, staff: Staff) -> Any:
    with db.connect() as connection:
        event = row(
            connection,
            "SELECT id,start_at,end_at,offline_data_version FROM events WHERE id=:id",
            {"id": event_id},
        )
        if not event:
            raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
        if staff.role == "SCANNER" and not row(
            connection,
            "SELECT 1 FROM event_access WHERE event_id=:event AND user_id=:user",
            {"event": event_id, "user": staff.id},
        ):
            raise ApiError(403, "FORBIDDEN", "Event access is required")
        return event


def scanner_item(item: Any) -> dict[str, Any]:
    return {
        "registrationId": item["id"],
        "lastName": item["last_name"],
        "firstName": item["first_name"],
        "middleName": item["middle_name"],
        "phone": item["phone"],
        "studyGroup": item["study_group"],
        "personType": item["person_type"],
        "organization": item["organization"],
        "firstAttendedAt": utc_iso(item["first_attended_at"])
        if item["first_attended_at"]
        else None,
    }


@router.get("/{event_id}/offline-bundle")
def bundle(
    event_id: UUID,
    staff: Annotated[Staff, Depends(current_staff)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    event = event_context(db, str(event_id), staff)
    with db.connect() as connection:
        registrations = rows(
            connection,
            """SELECT id,public_id,last_name,first_name,middle_name,phone,study_group,
            person_type,organization,first_attended_at FROM registrations
            WHERE event_id=:event AND status='ACTIVE' ORDER BY last_name,first_name,middle_name,id LIMIT :limit""",
            {"event": str(event_id), "limit": MAX_BUNDLE_ROWS + 1},
        )
    if len(registrations) > MAX_BUNDLE_ROWS:
        raise ApiError(409, "CONFLICT", "Offline bundle exceeds the reviewed limit")
    items = [
        {**scanner_item(item), "qrPayloadHash": qr_hash(item["public_id"], config)}
        for item in registrations
    ]
    encoded = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    now = __import__("datetime").datetime.utcnow()
    expires = event["end_at"] + timedelta(hours=24)
    return {
        "eventId": str(event_id),
        "version": str(event["offline_data_version"]),
        "generatedAt": utc_iso(now),
        "serverTime": utc_iso(now),
        "expiresAt": utc_iso(expires),
        "registrationCount": len(items),
        "checksum": hashlib.sha256(encoded.encode()).hexdigest(),
        "registrations": items,
    }


def resolve_payload(payload: str, config: Settings) -> tuple[str, str]:
    parts = payload.split(".")
    if len(parts) != 2:
        raise ApiError(404, "INVALID_QR", "QR is not valid")
    public_id, signature = parts
    try:
        UUID(public_id)
    except ValueError as error:
        raise ApiError(404, "INVALID_QR", "QR is not valid") from error
    if not verify_registration(public_id, signature, config.qr_signing_secret):
        raise ApiError(404, "INVALID_QR", "QR is not valid")
    return public_id, signature


@router.post("/{event_id}/resolve-qr")
def resolve_qr(
    event_id: UUID,
    values: ResolveQrRequest,
    staff: Annotated[Staff, Depends(csrf_staff)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    event_context(db, str(event_id), staff)
    public_id, _ = resolve_payload(values.qr_payload, config)
    with db.connect() as connection:
        item = row(
            connection,
            "SELECT * FROM registrations WHERE public_id=:public AND event_id=:event",
            {"public": public_id, "event": str(event_id)},
        )
    if not item:
        raise ApiError(404, "INVALID_QR", "QR is not valid")
    if item["status"] == "ANNULLED":
        raise ApiError(409, "REGISTRATION_ANNULLED", "Registration is annulled")
    return scanner_item(item)


def sync_result(item: AttendanceItem, status: str, first: Any = None) -> dict[str, Any]:
    return {
        "clientEventId": str(item.client_event_id),
        "status": status,
        "firstAttendedAt": utc_iso(first) if first else None,
    }


def process_item(
    db: Database, event: Any, item: AttendanceItem, device_id: str, staff: Staff
) -> dict[str, Any]:
    with db.connect() as connection:
        transaction = connection.begin()
        try:
            existing = row(
                connection,
                """SELECT r.first_attended_at FROM attendance_events a
                JOIN registrations r ON r.id=a.registration_id WHERE a.client_event_id=:client AND a.event_id=:event""",
                {"client": str(item.client_event_id), "event": event["id"]},
            )
            if existing:
                transaction.commit()
                return sync_result(
                    item, "ALREADY_PROCESSED", existing["first_attended_at"]
                )
            registration = row(
                connection,
                "SELECT status,first_attended_at FROM registrations WHERE id=:id AND event_id=:event FOR UPDATE",
                {"id": str(item.registration_id), "event": event["id"]},
            )
            if not registration:
                transaction.commit()
                return sync_result(item, "INVALID_REGISTRATION")
            if registration["status"] == "ANNULLED":
                transaction.commit()
                return sync_result(item, "REGISTRATION_ANNULLED")
            estimated = item.estimated_scanned_at.replace(tzinfo=None)
            if estimated < event["start_at"] - timedelta(hours=24) or estimated > event[
                "end_at"
            ] + timedelta(hours=24):
                transaction.commit()
                return sync_result(item, "INVALID_TIMESTAMP")
            duplicate = registration["first_attended_at"] is not None
            execute(
                connection,
                """INSERT INTO attendance_events
                (id,client_event_id,event_id,registration_id,scanner_user_id,device_id,mode,source,
                 device_scanned_at,estimated_scanned_at,received_at,duplicate,created_at)
                VALUES (:id,:client,:event,:registration,:scanner,:device,:mode,:source,:scanned,:estimated,
                        UTC_TIMESTAMP(3),:duplicate,UTC_TIMESTAMP(3))""",
                {
                    "id": str(uuid4()),
                    "client": str(item.client_event_id),
                    "event": event["id"],
                    "registration": str(item.registration_id),
                    "scanner": staff.id,
                    "device": device_id,
                    "mode": item.mode,
                    "source": item.source,
                    "scanned": item.device_scanned_at.replace(tzinfo=None),
                    "estimated": estimated,
                    "duplicate": duplicate,
                },
            )
            if not duplicate:
                execute(
                    connection,
                    "UPDATE registrations SET first_attended_at=:at,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
                    {"at": estimated, "id": str(item.registration_id)},
                )
                execute(
                    connection,
                    "UPDATE events SET offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
                    {"id": event["id"]},
                )
            transaction.commit()
            return sync_result(
                item,
                "REGISTRATION_ALREADY_ATTENDED" if duplicate else "ACCEPTED",
                registration["first_attended_at"] or estimated,
            )
        except IntegrityError:
            transaction.rollback()
            existing = row(
                connection,
                """SELECT r.first_attended_at FROM attendance_events a
                JOIN registrations r ON r.id=a.registration_id WHERE a.client_event_id=:client AND a.event_id=:event""",
                {"client": str(item.client_event_id), "event": event["id"]},
            )
            return sync_result(
                item,
                "ALREADY_PROCESSED",
                existing["first_attended_at"] if existing else None,
            )


@router.post("/{event_id}/attendance/sync", status_code=201)
def sync(
    event_id: UUID,
    values: AttendanceSyncRequest,
    staff: Annotated[Staff, Depends(csrf_staff)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    event = event_context(db, str(event_id), staff)
    results = [
        process_item(db, event, item, str(values.device_id), staff)
        for item in values.events
    ]
    with db.connect() as connection:
        version = row(
            connection,
            "SELECT offline_data_version FROM events WHERE id=:id",
            {"id": str(event_id)},
        )
    return {
        "results": results,
        "offlineDataVersion": str(
            version["offline_data_version"]
            if version
            else event["offline_data_version"]
        ),
    }
