"""Compact audit timeline for the chief administrator."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from ..audit_schemas import AuditList
from ..database import Database, rows
from ..dependencies import Staff, database, super_admin
from ..service_utils import utc_iso

router = APIRouter(prefix="/admin/audit", tags=["audit"])


@router.get("", response_model=AuditList)
def list_audit(
    response: Response,
    staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1, le=1000),
    action: str | None = Query(
        None, min_length=1, max_length=64, pattern=r"^[A-Z0-9_]+$"
    ),
    request_id: str | None = Query(
        None,
        alias="requestId",
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "private, no-store"
    page_size = 25
    with db.connect() as connection:
        entries = rows(
            connection,
            """SELECT a.id,a.action,a.entity_type,a.entity_id,a.request_id,
                      a.created_at,u.email AS actor_email
               FROM audit_log a JOIN staff_users u ON u.id=a.actor_user_id
               WHERE u.tenant_id=:tenant
                 AND (:action IS NULL OR a.action=:action)
                 AND (:request_id IS NULL OR a.request_id=:request_id)
               ORDER BY a.created_at DESC,a.id DESC
               LIMIT :limit OFFSET :offset""",
            {
                "tenant": staff.tenant_id,
                "action": action,
                "request_id": request_id,
                "limit": page_size + 1,
                "offset": (page - 1) * page_size,
            },
        )
    return {
        "page": page,
        "hasNext": len(entries) > page_size,
        "items": [
            {
                "id": entry["id"],
                "action": entry["action"],
                "entityType": entry["entity_type"],
                "entityId": entry["entity_id"],
                "requestId": entry["request_id"],
                "actorEmail": entry["actor_email"],
                "createdAt": utc_iso(entry["created_at"]),
            }
            for entry in entries[:page_size]
        ],
    }
