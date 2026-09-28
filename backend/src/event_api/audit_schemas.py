from datetime import datetime
from uuid import UUID

from .schemas import Contract


class AuditEntry(Contract):
    id: UUID
    action: str
    entity_type: str
    entity_id: str | None
    request_id: str | None
    actor_email: str
    created_at: datetime


class AuditList(Contract):
    page: int
    has_next: bool
    items: list[AuditEntry]
