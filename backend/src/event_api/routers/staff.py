from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends

from ..config import Settings
from ..database import Database, execute, row, rows
from ..dependencies import Staff, csrf_super_admin, database, settings, super_admin
from ..errors import ApiError
from ..schemas import EventAccessRequest, StaffInvitationRequest
from ..security import auth_link_token, mysql_millis, token_hash, utc_iso
from ..service_utils import audit

router = APIRouter(prefix="/admin", tags=["staff"])


@router.get("/staff")
def list_staff(
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            "SELECT id,email,system_role,active,created_at FROM staff_users ORDER BY created_at DESC",
        )
    return {
        "items": [
            {
                "id": item["id"],
                "email": item["email"],
                "role": item["system_role"],
                "active": bool(item["active"]),
                "createdAt": utc_iso(item["created_at"]),
            }
            for item in items
        ]
    }


def assert_event(connection: Any, event_id: str, assignable: bool = False) -> None:
    event = row(connection, "SELECT status FROM events WHERE id=:id", {"id": event_id})
    if not event:
        raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
    if assignable and event["status"] == "ARCHIVED":
        raise ApiError(
            409,
            "INVALID_EVENT_STATE",
            "Archived Event cannot receive access assignments",
        )


@router.post("/staff/invitations", status_code=201)
def invite(
    values: StaffInvitationRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    email = str(values.email).lower()
    with db.transaction() as connection:
        if row(
            connection,
            "SELECT id FROM staff_users WHERE email_normalized=:email",
            {"email": email},
        ):
            raise ApiError(409, "CONFLICT", "Staff account already exists")
        event_id = str(values.event_id) if values.event_id else None
        if event_id:
            assert_event(connection, event_id, True)
        existing = row(
            connection,
            """SELECT id,expires_at FROM staff_invitations
            WHERE email_normalized=:email AND event_id <=> :event
              AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
            {"email": email, "event": event_id},
        )
        if existing:
            return {
                "id": existing["id"],
                "expiresAt": utc_iso(existing["expires_at"]),
                "status": "queued",
            }
        invitation_id = str(uuid4())
        expires = mysql_millis(
            datetime.now(UTC).replace(tzinfo=None)
            + timedelta(seconds=config.invitation_ttl_seconds)
        )
        token = auth_link_token(
            "invitation", invitation_id, expires, config.auth_link_secret
        )
        execute(
            connection,
            """INSERT INTO staff_invitations
            (id,email_normalized,token_hash,invited_by,event_id,role,expires_at,created_at)
            VALUES (:id,:email,:hash,:actor,:event,'SCANNER',:expires,UTC_TIMESTAMP(3))""",
            {
                "id": invitation_id,
                "email": email,
                "hash": token_hash(token),
                "actor": staff.id,
                "event": event_id,
                "expires": expires,
            },
        )
        execute(
            connection,
            """INSERT INTO email_deliveries
            (id,idempotency_key,type,recipient_email,event_id,staff_invitation_id,
             status,attempts,queued_at,created_at,updated_at)
            VALUES (:id,:key,'STAFF_INVITATION',:email,:event,:invitation,
                    'QUEUED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": str(uuid4()),
                "key": f"staff-invitation:{invitation_id}",
                "email": email,
                "event": event_id,
                "invitation": invitation_id,
            },
        )
        audit(
            connection,
            staff.id,
            "STAFF_INVITATION_CREATED",
            "StaffInvitation",
            invitation_id,
            {"eventAssigned": bool(event_id)},
        )
    return {"id": invitation_id, "expiresAt": utc_iso(expires), "status": "queued"}


@router.post("/staff/{user_id}/deactivate")
def deactivate(
    user_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    target = str(user_id)
    if target == staff.id:
        raise ApiError(409, "CONFLICT", "Self-deactivation is not allowed")
    with db.transaction() as connection:
        user = row(
            connection,
            "SELECT active,system_role FROM staff_users WHERE id=:id FOR UPDATE",
            {"id": target},
        )
        if not user:
            raise ApiError(404, "NOT_FOUND", "Staff user not found")
        if not user["active"]:
            return {"status": "accepted"}
        if user["system_role"] == "SUPER_ADMIN":
            count = row(
                connection,
                "SELECT count(*) AS count FROM staff_users WHERE system_role='SUPER_ADMIN' AND active=true",
            )
            if int(count["count"] if count else 0) <= 1:
                raise ApiError(
                    409, "CONFLICT", "The last active SUPER_ADMIN cannot be deactivated"
                )
        execute(
            connection,
            "UPDATE staff_users SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": target},
        )
        execute(
            connection,
            "UPDATE sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=:id AND revoked_at IS NULL",
            {"id": target},
        )
        audit(connection, staff.id, "STAFF_USER_DEACTIVATED", "StaffUser", target)
    return {"status": "accepted"}


@router.get("/events/{event_id}/access")
def list_access(
    event_id: UUID,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        assert_event(connection, str(event_id))
        items = rows(
            connection,
            """SELECT a.user_id,u.email,a.role,a.created_at FROM event_access a
            JOIN staff_users u ON u.id=a.user_id WHERE a.event_id=:event ORDER BY a.created_at""",
            {"event": str(event_id)},
        )
    return {
        "items": [
            {
                "userId": item["user_id"],
                "email": item["email"],
                "role": "SCANNER",
                "createdAt": utc_iso(item["created_at"]),
            }
            for item in items
        ]
    }


@router.post("/events/{event_id}/access")
def assign_access(
    event_id: UUID,
    values: EventAccessRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    with db.transaction() as connection:
        assert_event(connection, str(event_id), True)
        user = row(
            connection,
            "SELECT active,system_role FROM staff_users WHERE id=:id",
            {"id": str(values.user_id)},
        )
        if not user:
            raise ApiError(404, "NOT_FOUND", "Staff user not found")
        if not user["active"] or user["system_role"] != "SCANNER":
            raise ApiError(409, "CONFLICT", "Event access requires an active SCANNER")
        execute(
            connection,
            """INSERT IGNORE INTO event_access
            (id,event_id,user_id,role,created_by,created_at)
            VALUES (:id,:event,:user,'SCANNER',:actor,UTC_TIMESTAMP(3))""",
            {
                "id": str(uuid4()),
                "event": str(event_id),
                "user": str(values.user_id),
                "actor": staff.id,
            },
        )
        audit(
            connection,
            staff.id,
            "EVENT_ACCESS_ASSIGNED",
            "Event",
            str(event_id),
            {"userId": str(values.user_id)},
        )
    return {"status": "accepted"}


@router.delete("/events/{event_id}/access/{user_id}")
def remove_access(
    event_id: UUID,
    user_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    with db.transaction() as connection:
        assert_event(connection, str(event_id))
        execute(
            connection,
            "DELETE FROM event_access WHERE event_id=:event AND user_id=:user",
            {"event": str(event_id), "user": str(user_id)},
        )
        audit(
            connection,
            staff.id,
            "EVENT_ACCESS_REMOVED",
            "Event",
            str(event_id),
            {"userId": str(user_id)},
        )
    return {"status": "accepted"}
