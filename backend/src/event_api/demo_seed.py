from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import text

from .config import get_settings
from .database import Database
from .security import hash_password
from .tenant_scope import default_tenant_scope


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
    season_id = stable_id("activity-season")
    scoring_rule_id = stable_id("activity-participant-rule")
    volunteer_rule_id = stable_id("activity-volunteer-rule")
    winner_rule_id = stable_id("activity-winner-rule")
    removed_field_id = stable_id("field")
    database = Database(get_settings())
    with database.transaction() as connection:
        scope = default_tenant_scope(connection)
        connection.execute(
            text("""INSERT INTO staff_users
            (id,tenant_id,organization_id,email,email_normalized,password_hash,system_role,active,
             password_changed_at,created_at,updated_at)
            VALUES (:id,:tenant,:organization,:email,:email,:password,:role,TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),active=TRUE,updated_at=UTC_TIMESTAMP(3)"""),
            [
                {
                    "id": admin_id,
                    "tenant": scope.tenant_id,
                    "organization": scope.organization_id,
                    "email": admin_email,
                    "password": hash_password(admin_password),
                    "role": "SUPER_ADMIN",
                },
                {
                    "id": scanner_id,
                    "tenant": scope.tenant_id,
                    "organization": scope.organization_id,
                    "email": scanner_email,
                    "password": hash_password(scanner_password),
                    "role": "SCANNER",
                },
            ],
        )
        connection.execute(
            text(
                "UPDATE seasons SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE active=true AND id<>:id"
            ),
            {"id": season_id},
        )
        connection.execute(
            text("""INSERT INTO seasons
            (id,code,name,starts_at,ends_at,active,created_at,updated_at)
            VALUES (:id,'DEMO_SEASON','Демонстрационный сезон',:starts,:ends,true,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE name=VALUES(name),starts_at=VALUES(starts_at),
              ends_at=VALUES(ends_at),active=true,updated_at=UTC_TIMESTAMP(3)"""),
            {
                "id": season_id,
                "starts": now - timedelta(days=30),
                "ends": now + timedelta(days=365),
            },
        )
        connection.execute(
            text("""INSERT INTO events
            (id,organization_id,title,slug,description,direction,start_at,end_at,timezone,location,
             registration_deadline,capacity,status,created_by,offline_data_version,created_at,updated_at)
            VALUES (:id,:organization,:title,:slug,:description,:direction,:start,:end,
                    'Europe/Moscow',:location,:deadline,:capacity,'REGISTRATION_OPEN',
                    :admin,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),
              direction=VALUES(direction),location=VALUES(location),capacity=VALUES(capacity),
              start_at=VALUES(start_at),end_at=VALUES(end_at),
              registration_deadline=VALUES(registration_deadline),
              status='REGISTRATION_OPEN',updated_at=UTC_TIMESTAMP(3)"""),
            [
                {
                    "id": event_id,
                    "organization": scope.organization_id,
                    "title": "Демонстрационное мероприятие",
                    "slug": "demo-event",
                    "description": "Локальный контур со всеми возможностями MVP",
                    "direction": "Знакомство с колледжем",
                    "location": "КАИТ №20",
                    "capacity": 100,
                    "start": now + timedelta(hours=1),
                    "end": now + timedelta(hours=5),
                    "deadline": now + timedelta(minutes=30),
                    "admin": admin_id,
                },
                {
                    "id": stable_id("open-day"),
                    "title": "День открытых дверей",
                    "slug": "open-day",
                    "description": "Экскурсия по колледжу, знакомство с программами и ответы на вопросы.",
                    "direction": "Профориентация",
                    "location": "Главный корпус",
                    "capacity": 180,
                    "start": now + timedelta(days=2),
                    "end": now + timedelta(days=2, hours=4),
                    "deadline": now + timedelta(days=1, hours=20),
                    "admin": admin_id,
                },
                {
                    "id": stable_id("web-workshop"),
                    "title": "Мастер-класс по веб-разработке",
                    "slug": "web-workshop",
                    "description": "Практическое занятие для тех, кто хочет попробовать себя в разработке.",
                    "direction": "Информационные технологии",
                    "location": "IT-полигон",
                    "capacity": 40,
                    "start": now + timedelta(days=8),
                    "end": now + timedelta(days=8, hours=2),
                    "deadline": now + timedelta(days=7),
                    "admin": admin_id,
                },
                {
                    "id": stable_id("design-workshop"),
                    "title": "Практикум по графическому дизайну",
                    "slug": "design-workshop",
                    "description": "Знакомство с композицией, типографикой и созданием визуальных материалов.",
                    "direction": "Дизайн и медиа",
                    "location": "Медиацентр",
                    "capacity": 35,
                    "start": now + timedelta(days=35),
                    "end": now + timedelta(days=35, hours=2),
                    "deadline": now + timedelta(days=34),
                    "admin": admin_id,
                },
            ],
        )
        connection.execute(
            text("DELETE FROM registration_answers WHERE field_id=:field"),
            {"field": removed_field_id},
        )
        connection.execute(
            text("DELETE FROM event_form_fields WHERE id=:field"),
            {"field": removed_field_id},
        )
        connection.execute(
            text("""UPDATE events SET season_id=:season,
            category_id='10000000-0000-4000-8000-000000000001',
            level_id='20000000-0000-4000-8000-000000000001'
            WHERE id IN (:event,:open_day,:web_workshop,:design_workshop)"""),
            {
                "season": season_id,
                "event": event_id,
                "open_day": stable_id("open-day"),
                "web_workshop": stable_id("web-workshop"),
                "design_workshop": stable_id("design-workshop"),
            },
        )
        connection.execute(
            text("""INSERT INTO scoring_rules
            (id,season_id,event_category_id,event_level_id,participation_role_id,
             participation_result_id,points,priority,active,version,created_at,updated_at,
             created_by,updated_by)
            VALUES (:id,:season,'10000000-0000-4000-8000-000000000001',
                    '20000000-0000-4000-8000-000000000001',
                    :role,:result,:points,:priority,true,1,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),:admin,:admin)
            ON DUPLICATE KEY UPDATE points=VALUES(points),active=true,
              updated_at=UTC_TIMESTAMP(3),updated_by=VALUES(updated_by)"""),
            [
                {
                    "id": scoring_rule_id,
                    "season": season_id,
                    "role": "30000000-0000-4000-8000-000000000001",
                    "result": None,
                    "points": 10,
                    "priority": 100,
                    "admin": admin_id,
                },
                {
                    "id": volunteer_rule_id,
                    "season": season_id,
                    "role": "30000000-0000-4000-8000-000000000003",
                    "result": None,
                    "points": 20,
                    "priority": 100,
                    "admin": admin_id,
                },
                {
                    "id": winner_rule_id,
                    "season": season_id,
                    "role": "30000000-0000-4000-8000-000000000002",
                    "result": "40000000-0000-4000-8000-000000000001",
                    "points": 50,
                    "priority": 200,
                    "admin": admin_id,
                },
            ],
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
