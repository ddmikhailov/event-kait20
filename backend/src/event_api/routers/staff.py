from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends

from ..config import Settings
from ..database import Database, execute, row, rows
from ..dependencies import Staff, administrator, csrf_administrator, database, settings
from ..errors import ApiError
from ..schemas import (
    EventAccessRequest,
    InvitationResendRequest,
    StaffInvitationRequest,
)
from ..security import auth_link_token, mysql_millis, token_hash, utc_iso
from ..service_utils import audit

router = APIRouter(prefix="/admin", tags=["staff"])


def invitation_delivery(connection: Any, invitation_id: str) -> Any:
    return row(
        connection,
        """SELECT status,updated_at FROM email_deliveries
        WHERE staff_invitation_id=:id ORDER BY queued_at DESC,id DESC LIMIT 1""",
        {"id": invitation_id},
    )


@router.get("/staff/invitations")
def list_invitations(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT i.id,i.email_normalized,i.role,i.expires_at,i.accepted_at,
                d.status,d.attempts,d.last_error_code,d.next_attempt_at
            FROM staff_invitations i
            LEFT JOIN email_deliveries d ON d.id=(
                SELECT latest.id FROM email_deliveries latest
                WHERE latest.staff_invitation_id=i.id
                ORDER BY latest.queued_at DESC,latest.id DESC LIMIT 1)
            WHERE i.tenant_id=:tenant AND (:super=true OR i.role='SCANNER')
            ORDER BY i.created_at DESC,i.id DESC LIMIT 100""",
            {"tenant": staff.tenant_id, "super": staff.role == "SUPER_ADMIN"},
        )
    return {
        "items": [
            {
                "id": item["id"],
                "email": item["email_normalized"],
                "role": item["role"],
                "expiresAt": utc_iso(item["expires_at"]),
                "acceptedAt": utc_iso(item["accepted_at"])
                if item["accepted_at"]
                else None,
                "deliveryStatus": item["status"] or "MISSING",
                "attempts": int(item["attempts"] or 0),
                "lastErrorCode": item["last_error_code"],
                "nextAttemptAt": utc_iso(item["next_attempt_at"])
                if item["next_attempt_at"]
                else None,
            }
            for item in items
        ]
    }


@router.post("/staff/invitations/{invitation_id}/resend")
def resend_invitation(
    invitation_id: UUID,
    values: InvitationResendRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    target = str(invitation_id)
    key = f"invitation-resend:{target}:{values.request_id}"
    with db.transaction() as connection:
        invitation = row(
            connection,
            "SELECT * FROM staff_invitations WHERE id=:id AND tenant_id=:tenant FOR UPDATE",
            {"id": target, "tenant": staff.tenant_id},
        )
        if not invitation:
            raise ApiError(404, "NOT_FOUND", "Invitation not found")
        if staff.role == "ORGANIZER" and invitation["role"] != "SCANNER":
            raise ApiError(
                403, "FORBIDDEN", "Organizer may resend scanner invitations only"
            )
        if invitation["accepted_at"] or invitation["expires_at"] <= datetime.now(
            UTC
        ).replace(tzinfo=None):
            raise ApiError(409, "AUTH_LINK_INVALID", "Invitation accepted or expired")
        repeated = row(
            connection,
            "SELECT status FROM email_deliveries WHERE idempotency_key=:key",
            {"key": key},
        )
        latest = invitation_delivery(connection, target)
        if repeated or (latest and latest["status"] in {"QUEUED", "SENDING"}):
            delivery = repeated or latest
            return {
                "id": target,
                "expiresAt": utc_iso(invitation["expires_at"]),
                "status": delivery["status"].lower(),
            }
        if latest and latest["updated_at"] > datetime.now(UTC).replace(
            tzinfo=None
        ) - timedelta(seconds=60):
            raise ApiError(429, "RATE_LIMITED", "Wait before resending invitation")
        execute(
            connection,
            """INSERT INTO email_deliveries
            (id,idempotency_key,type,recipient_email,event_id,staff_invitation_id,
             status,attempts,queued_at,created_at,updated_at)
            VALUES (:id,:key,'STAFF_INVITATION',:email,:event,:invitation,
                    'QUEUED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": str(uuid4()),
                "key": key,
                "email": invitation["email_normalized"],
                "event": invitation["event_id"],
                "invitation": target,
            },
        )
        audit(
            connection, staff.id, "STAFF_INVITATION_RESENT", "StaffInvitation", target
        )
    return {
        "id": target,
        "expiresAt": utc_iso(invitation["expires_at"]),
        "status": "queued",
    }


@router.get("/staff")
def list_staff(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT id,email,system_role,active,created_at FROM staff_users
            WHERE tenant_id=:tenant ORDER BY created_at DESC""",
            {"tenant": staff.tenant_id},
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


def assert_event(
    connection: Any, event_id: str, tenant_id: str, assignable: bool = False
) -> None:
    event = row(
        connection,
        """SELECT e.status FROM events e JOIN organizations o ON o.id=e.organization_id
        WHERE e.id=:id AND o.tenant_id=:tenant""",
        {"id": event_id, "tenant": tenant_id},
    )
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
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    email = str(values.email).lower()
    role = str(values.role)
    if staff.role == "ORGANIZER" and role != "SCANNER":
        raise ApiError(403, "FORBIDDEN", "Organizer may invite scanners only")
    with db.transaction() as connection:
        if row(
            connection,
            "SELECT id FROM staff_users WHERE email_normalized=:email",
            {"email": email},
        ):
            raise ApiError(409, "CONFLICT", "Staff account already exists")
        event_id = str(values.event_id) if values.event_id else None
        if event_id:
            assert_event(connection, event_id, staff.tenant_id, True)
        existing = row(
            connection,
            """SELECT id,expires_at,event_id,role FROM staff_invitations
            WHERE tenant_id=:tenant AND email_normalized=:email
              AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
            {"tenant": staff.tenant_id, "email": email},
        )
        if existing:
            if existing["role"] != role or existing["event_id"] != event_id:
                raise ApiError(
                    409,
                    "CONFLICT",
                    "A different active invitation already exists for this email",
                )
            delivery = invitation_delivery(connection, existing["id"])
            return {
                "id": existing["id"],
                "expiresAt": utc_iso(existing["expires_at"]),
                "status": delivery["status"].lower() if delivery else "missing",
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
            (id,tenant_id,organization_id,email_normalized,token_hash,invited_by,event_id,role,expires_at,created_at)
            VALUES (:id,:tenant,:organization,:email,:hash,:actor,:event,:role,:expires,UTC_TIMESTAMP(3))""",
            {
                "id": invitation_id,
                "tenant": staff.tenant_id,
                "organization": staff.organization_id,
                "email": email,
                "hash": token_hash(token),
                "actor": staff.id,
                "event": event_id,
                "role": role,
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
            {"eventAssigned": bool(event_id), "role": role},
        )
    return {"id": invitation_id, "expiresAt": utc_iso(expires), "status": "queued"}


@router.post("/staff/{user_id}/deactivate")
def deactivate(
    user_id: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    target = str(user_id)
    if target == staff.id:
        raise ApiError(409, "CONFLICT", "Self-deactivation is not allowed")
    with db.transaction() as connection:
        user = row(
            connection,
            """SELECT active,system_role FROM staff_users
            WHERE id=:id AND tenant_id=:tenant FOR UPDATE""",
            {"id": target, "tenant": staff.tenant_id},
        )
        if not user:
            raise ApiError(404, "NOT_FOUND", "Staff user not found")
        if staff.role == "ORGANIZER" and user["system_role"] != "SCANNER":
            raise ApiError(403, "FORBIDDEN", "Organizer may deactivate scanners only")
        if not user["active"]:
            return {"status": "accepted"}
        if user["system_role"] == "SUPER_ADMIN":
            count = row(
                connection,
                """SELECT count(*) AS count FROM staff_users
                WHERE tenant_id=:tenant AND system_role='SUPER_ADMIN' AND active=true""",
                {"tenant": staff.tenant_id},
            )
            if int(count["count"] if count else 0) <= 1:
                raise ApiError(
                    409, "CONFLICT", "The last active SUPER_ADMIN cannot be deactivated"
                )
        execute(
            connection,
            """UPDATE staff_users SET active=false,updated_at=UTC_TIMESTAMP(3)
            WHERE id=:id AND tenant_id=:tenant""",
            {"id": target, "tenant": staff.tenant_id},
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
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        assert_event(connection, str(event_id), staff.tenant_id)
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
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    with db.transaction() as connection:
        assert_event(connection, str(event_id), staff.tenant_id, True)
        user = row(
            connection,
            """SELECT active,system_role FROM staff_users
            WHERE id=:id AND tenant_id=:tenant""",
            {"id": str(values.user_id), "tenant": staff.tenant_id},
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
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    with db.transaction() as connection:
        assert_event(connection, str(event_id), staff.tenant_id)
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
