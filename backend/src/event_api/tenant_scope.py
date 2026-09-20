from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Connection, RowMapping

from .database import row
from .errors import ApiError


@dataclass(frozen=True)
class TenantScope:
    tenant_id: str
    organization_id: str


def default_tenant_scope(connection: Connection) -> TenantScope:
    item = row(
        connection,
        """SELECT o.tenant_id,o.id AS organization_id
        FROM organizations o JOIN tenants t ON t.id=o.tenant_id
        WHERE t.active=true AND o.active=true
        ORDER BY t.created_at,t.id,o.created_at,o.id LIMIT 1""",
    )
    if not item:
        raise RuntimeError("No active Tenant/Organization is configured")
    return TenantScope(str(item["tenant_id"]), str(item["organization_id"]))


def organization_in_tenant(
    connection: Connection,
    tenant_id: str,
    organization_id: str,
    *,
    active: bool = True,
) -> RowMapping:
    item = row(
        connection,
        """SELECT * FROM organizations
        WHERE id=:organization AND tenant_id=:tenant
          AND (:active=false OR active=true)""",
        {
            "organization": organization_id,
            "tenant": tenant_id,
            "active": active,
        },
    )
    if not item:
        raise ApiError(
            404,
            "ORGANIZATION_NOT_FOUND",
            "Organization is unavailable in the current tenant",
        )
    return item


def require_person_in_tenant(
    connection: Connection, person_id: str, tenant_id: str, *, lock: bool = False
) -> RowMapping:
    item = row(
        connection,
        f"""SELECT * FROM persons WHERE id=:person AND tenant_id=:tenant
        AND merged_into_id IS NULL{" FOR UPDATE" if lock else ""}""",
        {"person": person_id, "tenant": tenant_id},
    )
    if not item:
        raise ApiError(404, "PERSON_NOT_FOUND", "Person not found")
    return item


def require_event_in_tenant(
    connection: Connection, event_id: str, tenant_id: str, *, lock: bool = False
) -> RowMapping:
    item = row(
        connection,
        f"""SELECT e.* FROM events e
        JOIN organizations o ON o.id=e.organization_id
        WHERE e.id=:event AND o.tenant_id=:tenant{" FOR UPDATE" if lock else ""}""",
        {"event": event_id, "tenant": tenant_id},
    )
    if not item:
        raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
    return item
