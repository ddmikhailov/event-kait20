"""Durable handoff of rejected Scanner marks; never changes attendance or score."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import StringConstraints

from ..database import Database, execute, row, rows
from ..dependencies import (
    Staff,
    administrator,
    csrf_administrator,
    csrf_staff,
    database,
)
from ..errors import ApiError
from ..schemas import AttendanceItem, Contract
from ..security import utc_iso
from ..service_utils import audit
from ..tenant_scope import require_event_for_staff
from .attendance import mysql_millisecond

scanner = APIRouter(prefix="/scanner/events", tags=["attendance handoff"])
admin = APIRouter(prefix="/admin/events", tags=["attendance handoff"])

RejectionCode = Literal[
    "INVALID_REGISTRATION",
    "REGISTRATION_ANNULLED",
    "INVALID_TIMESTAMP",
    "CLIENT_EVENT_CONFLICT",
]


class HandoffRequest(Contract):
    device_id: UUID
    item: AttendanceItem
    rejection_status: RejectionCode


class ResolveRequest(Contract):
    reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)
    ]


def handoff_matches(
    existing: Any, values: HandoffRequest, staff: Staff, event_id: str
) -> bool:
    item = values.item
    return all(
        (
            existing["event_id"] == event_id,
            existing["registration_id"] == str(item.registration_id),
            existing["scanner_user_id"] == staff.id,
            existing["device_id"] == str(values.device_id),
            existing["mode"] == item.mode,
            existing["source"] == item.source,
            existing["device_scanned_at"] == mysql_millisecond(item.device_scanned_at),
            existing["estimated_scanned_at"]
            == mysql_millisecond(item.estimated_scanned_at),
            existing["rejection_status"] == values.rejection_status,
        )
    )


@scanner.post("/{event_id}/attendance/rejections", status_code=201)
def handoff_rejection(
    event_id: UUID,
    values: HandoffRequest,
    staff: Annotated[Staff, Depends(csrf_staff)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        # Event row serializes the open-case limit and checks tenant/organization.
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id, lock=True
        )
        if staff.role == "SCANNER" and not row(
            connection,
            "SELECT 1 FROM event_access WHERE event_id=:event AND user_id=:user",
            {"event": str(event_id), "user": staff.id},
        ):
            raise ApiError(403, "FORBIDDEN", "Event access is required")
        item = values.item
        existing = row(
            connection,
            "SELECT * FROM scanner_rejected_attendance WHERE client_event_id=:client FOR UPDATE",
            {"client": str(item.client_event_id)},
        )
        if existing:
            if not handoff_matches(existing, values, staff, str(event_id)):
                raise ApiError(409, "HANDOFF_CONFLICT", "Handoff payload has changed")
            return {
                "clientEventId": str(item.client_event_id),
                "status": existing["status"],
            }
        open_count = row(
            connection,
            "SELECT COUNT(*) AS total FROM scanner_rejected_attendance WHERE event_id=:event AND status='OPEN'",
            {"event": str(event_id)},
        )
        if open_count and open_count["total"] >= 5_000:
            raise ApiError(409, "HANDOFF_LIMIT", "Too many open handoffs")
        execute(
            connection,
            """INSERT INTO scanner_rejected_attendance
            (client_event_id,event_id,registration_id,scanner_user_id,device_id,
             mode,source,device_scanned_at,estimated_scanned_at,rejection_status,
             status,created_at)
            VALUES (:client,:event,:registration,:scanner,:device,:mode,:source,
                    :scanned,:estimated,:reason,'OPEN',UTC_TIMESTAMP(3))""",
            {
                "client": str(item.client_event_id),
                "event": str(event_id),
                "registration": str(item.registration_id),
                "scanner": staff.id,
                "device": str(values.device_id),
                "mode": item.mode,
                "source": item.source,
                "scanned": mysql_millisecond(item.device_scanned_at),
                "estimated": mysql_millisecond(item.estimated_scanned_at),
                "reason": values.rejection_status,
            },
        )
        audit(
            connection,
            staff.id,
            "ATTENDANCE_REJECTION_HANDED_OFF",
            "ScannerRejectedAttendance",
            str(item.client_event_id),
            {"eventId": str(event_id), "rejectionStatus": values.rejection_status},
        )
    return {"clientEventId": str(item.client_event_id), "status": "OPEN"}


@admin.get("/{event_id}/attendance/rejections")
def list_rejections(
    event_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=10_000),
) -> dict[str, Any]:
    with db.connect() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id
        )
        cases = rows(
            connection,
            """SELECT x.client_event_id,x.registration_id,x.rejection_status,
              x.status,x.created_at,r.last_name,r.first_name,r.middle_name,r.study_group
            FROM scanner_rejected_attendance x
            LEFT JOIN registrations r ON r.id=x.registration_id AND r.event_id=x.event_id
            WHERE x.event_id=:event AND x.status='OPEN'
            ORDER BY x.created_at,x.client_event_id LIMIT :limit OFFSET :offset""",
            {"event": str(event_id), "limit": limit + 1, "offset": offset},
        )
    return {
        "items": [
            {
                "clientEventId": case["client_event_id"],
                "registrationId": case["registration_id"],
                "rejectionStatus": case["rejection_status"],
                "status": case["status"],
                "createdAt": utc_iso(case["created_at"]),
                "lastName": case["last_name"],
                "firstName": case["first_name"],
                "middleName": case["middle_name"],
                "studyGroup": case["study_group"],
            }
            for case in cases[:limit]
        ],
        "hasNext": len(cases) > limit,
    }


@admin.patch("/{event_id}/attendance/rejections/{client_event_id}")
def resolve_rejection(
    event_id: UUID,
    client_event_id: UUID,
    values: ResolveRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id
        )
        case = row(
            connection,
            """SELECT status FROM scanner_rejected_attendance
            WHERE client_event_id=:client AND event_id=:event FOR UPDATE""",
            {"client": str(client_event_id), "event": str(event_id)},
        )
        if not case:
            raise ApiError(404, "HANDOFF_NOT_FOUND", "Handoff not found")
        if case["status"] != "OPEN":
            raise ApiError(409, "HANDOFF_ALREADY_RESOLVED", "Handoff already resolved")
        execute(
            connection,
            """UPDATE scanner_rejected_attendance SET status='RESOLVED',
               resolved_by=:actor,resolution_reason=:reason,resolved_at=UTC_TIMESTAMP(3)
            WHERE client_event_id=:client""",
            {
                "client": str(client_event_id),
                "actor": staff.id,
                "reason": values.reason,
            },
        )
        audit(
            connection,
            staff.id,
            "ATTENDANCE_REJECTION_RESOLVED",
            "ScannerRejectedAttendance",
            str(client_event_id),
            {"eventId": str(event_id)},
        )
    return {"clientEventId": str(client_event_id), "status": "RESOLVED"}
