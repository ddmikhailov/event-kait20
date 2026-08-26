import json
from datetime import UTC, date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.engine import Connection, RowMapping

from .database import execute
from .security import utc_iso


def json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def db_json(value: Any) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False)


def serial(value: Any) -> Any:
    if isinstance(value, datetime):
        return utc_iso(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def event_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "title": item["title"],
        "slug": item["slug"],
        "description": item["description"],
        "coverObjectKey": item["cover_object_key"],
        "startAt": serial(item["start_at"]),
        "endAt": serial(item["end_at"]),
        "timezone": item["timezone"],
        "location": item["location"],
        "registrationDeadline": serial(item["registration_deadline"]),
        "capacity": item["capacity"],
        "status": item["status"],
        "archivedAt": serial(item["archived_at"]) if item["archived_at"] else None,
        "createdAt": serial(item["created_at"]),
        "updatedAt": serial(item["updated_at"]),
    }


def field_response(item: RowMapping) -> dict[str, Any]:
    options = json_value(item["options"])
    return {
        "id": item["id"],
        "eventId": item["event_id"],
        "type": item["type"],
        "label": item["label"],
        "required": bool(item["required"]),
        "sortOrder": item["sort_order"],
        "options": options if isinstance(options, list) else None,
        "active": bool(item["active"]),
        "createdAt": serial(item["created_at"]),
        "updatedAt": serial(item["updated_at"]),
    }


def audit(
    connection: Connection,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None,
    metadata: dict[str, Any] | None = None,
) -> None:
    execute(
        connection,
        """INSERT INTO audit_log
           (id,actor_user_id,action,entity_type,entity_id,metadata,created_at)
           VALUES (:id,:actor,:action,:entity,:entity_id,:metadata,UTC_TIMESTAMP(3))""",
        {
            "id": str(uuid4()),
            "actor": actor_id,
            "action": action,
            "entity": entity_type,
            "entity_id": entity_id,
            "metadata": db_json(metadata),
        },
    )


def naive_utc(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value
