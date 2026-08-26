from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import text

from .config import get_settings
from .database import Database
from .security import hash_password


def stable_id(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"event-registration-demo:{name}"))


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required for demo seed")
    return value


def main() -> None:
    if get_settings().node_env != "development":
        raise RuntimeError("Demo seed is disabled outside development")
    admin_email = required("DEMO_ADMIN_EMAIL").strip().lower()
    admin_password = required("DEMO_ADMIN_PASSWORD")
    scanner_email = required("DEMO_SCANNER_EMAIL").strip().lower()
    scanner_password = required("DEMO_SCANNER_PASSWORD")
    if min(len(admin_password), len(scanner_password)) < 12:
        raise RuntimeError("Demo passwords must contain at least 12 characters")
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    admin_id = stable_id("admin")
    scanner_id = stable_id("scanner")
    event_id = stable_id("event")
    field_id = stable_id("field")
    database = Database(get_settings())
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO staff_users
            (id,email,email_normalized,password_hash,system_role,active,
             password_changed_at,created_at,updated_at)
            VALUES (:id,:email,:email,:password,:role,TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),active=TRUE,updated_at=UTC_TIMESTAMP(3)"""),
            [
                {
                    "id": admin_id,
                    "email": admin_email,
                    "password": hash_password(admin_password),
                    "role": "SUPER_ADMIN",
                },
                {
                    "id": scanner_id,
                    "email": scanner_email,
                    "password": hash_password(scanner_password),
                    "role": "SCANNER",
                },
            ],
        )
        connection.execute(
            text("""INSERT INTO events
            (id,title,slug,description,start_at,end_at,timezone,location,
             registration_deadline,capacity,status,created_by,offline_data_version,created_at,updated_at)
            VALUES (:id,'Демонстрационное мероприятие','demo-event',
                    'Локальный контур со всеми возможностями MVP',:start,:end,
                    'Europe/Moscow','КАИТ №20',:deadline,100,'REGISTRATION_OPEN',
                    :admin,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE start_at=VALUES(start_at),end_at=VALUES(end_at),
              registration_deadline=VALUES(registration_deadline),
              status='REGISTRATION_OPEN',updated_at=UTC_TIMESTAMP(3)"""),
            {
                "id": event_id,
                "start": now + timedelta(hours=1),
                "end": now + timedelta(hours=5),
                "deadline": now + timedelta(minutes=30),
                "admin": admin_id,
            },
        )
        connection.execute(
            text("""INSERT INTO event_form_fields
            (id,event_id,type,label,required,sort_order,options,active,created_at,updated_at)
            VALUES (:id,:event,'SINGLE_CHOICE','Направление участия',TRUE,10,
                    JSON_ARRAY('Участник','Организатор','Гость'),TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE active=TRUE,updated_at=UTC_TIMESTAMP(3)"""),
            {"id": field_id, "event": event_id},
        )
        connection.execute(
            text("""INSERT INTO event_access(id,event_id,user_id,role,created_by,created_at)
            VALUES (:id,:event,:scanner,'SCANNER',:admin,UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE role='SCANNER'"""),
            {
                "id": stable_id("access"),
                "event": event_id,
                "scanner": scanner_id,
                "admin": admin_id,
            },
        )
    database.dispose()
    print("Demo data is ready")


if __name__ == "__main__":
    main()
