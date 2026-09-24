from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from event_api.database import Database
from event_api.security import hash_password

ORIGIN = {"Origin": "http://localhost:5173"}


def login(client: TestClient) -> dict[str, str]:
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def create_registration(database: Database, event_id: str, suffix: str = "one") -> str:
    person_id, registration_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO persons
            (id,tenant_id,last_name,first_name,email,email_normalized,phone,phone_normalized,person_type,
             organization,study_group,dedup_review_required,created_at,updated_at)
            VALUES (:person,'50000000-0000-4000-8000-000000000001','Тестов',:first,:email,:email,'+79990000001','+79990000001',
                    'KAIT_STUDENT','КАИТ №20','ИС-21',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "person": person_id,
                "first": f"Участник {suffix}",
                "email": f"active-{suffix}-{person_id}@example.test",
            },
        )
        connection.execute(
            text("""INSERT INTO registrations
            (id,public_id,event_id,person_id,source,status,last_name,first_name,email,phone,
             study_group,person_type,organization,consent_accepted,registered_at,first_attended_at,
             created_at,updated_at)
            VALUES (:id,:public,:event,:person,'ADMIN_MANUAL','ACTIVE','Тестов',:first,:email,
                    '+79990000001','ИС-21','KAIT_STUDENT','КАИТ №20',true,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "id": registration_id,
                "public": str(uuid4()),
                "event": event_id,
                "person": person_id,
                "first": f"Участник {suffix}",
                "email": f"active-{suffix}-{person_id}@example.test",
            },
        )
    return registration_id


def create_event(
    client: TestClient,
    headers: dict[str, str],
    *,
    title: str,
    start_at: str = "2026-10-01T10:00:00Z",
    end_at: str = "2026-10-01T12:00:00Z",
    season_id: str | None = None,
) -> tuple[str, str]:
    slug = f"activity-{uuid4().hex[:12]}"
    response = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": title,
            "slug": slug,
            "description": "Activity correction test",
            "startAt": start_at,
            "endAt": end_at,
            "registrationDeadline": start_at,
            "timezone": "Europe/Moscow",
            "location": "КАИТ №20",
            "capacity": 20,
            "status": "DRAFT",
            "seasonId": season_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"], slug


def create_study_group(
    client: TestClient,
    headers: dict[str, str],
    name: str,
    department_name: str,
    course: int,
) -> str:
    suffix = uuid4().hex[:8].upper()
    department = client.post(
        "/admin/structure/departments",
        headers=headers,
        json={"code": f"D_{suffix}", "name": department_name},
    )
    assert department.status_code == 201, department.text
    group = client.post(
        "/admin/structure/groups",
        headers=headers,
        json={
            "departmentId": department.json()["id"],
            "name": name,
            "code": f"G_{suffix}",
            "course": course,
        },
    )
    assert group.status_code == 201, group.text
    return group.json()["id"]


def create_registration_for_person(
    database: Database,
    event_id: str,
    suffix: str,
    person_id: str | None = None,
) -> tuple[str, str]:
    registration_id = str(uuid4())
    resolved_person_id = person_id or str(uuid4())
    with database.transaction() as connection:
        if person_id is None:
            connection.execute(
                text("""INSERT INTO persons
                (id,tenant_id,last_name,first_name,email,email_normalized,person_type,organization,
                 study_group,dedup_review_required,created_at,updated_at)
                VALUES (:person,'50000000-0000-4000-8000-000000000001','Исторический',:first,:email,:email,'KAIT_STUDENT',
                        'КАИТ №20','TEST',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
                {
                    "person": resolved_person_id,
                    "first": suffix,
                    "email": f"history-{suffix}-{resolved_person_id}@example.test",
                },
            )
        connection.execute(
            text("""INSERT INTO registrations
            (id,public_id,event_id,person_id,source,status,last_name,first_name,email,
             study_group,person_type,organization,consent_accepted,registered_at,
             first_attended_at,created_at,updated_at)
            VALUES (:id,:public,:event,:person,'ADMIN_MANUAL','ACTIVE','Исторический',
                    :first,:email,'TEST','KAIT_STUDENT','КАИТ №20',true,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "id": registration_id,
                "public": str(uuid4()),
                "event": event_id,
                "person": resolved_person_id,
                "first": suffix,
                "email": f"history-{suffix}-{resolved_person_id}@example.test",
            },
        )
    return registration_id, resolved_person_id


def test_participation_scoring_privacy_and_idempotency(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database

    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": "TEST_2026",
            "name": "Тестовый сезон 2026",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": True,
        },
    )
    assert season.status_code == 201, season.text
    roles = client.get("/admin/activity/roles").json()["items"]
    volunteer = next(item for item in roles if item["code"] == "VOLUNTEER")
    participant = next(item for item in roles if item["code"] == "PARTICIPANT")
    winner = next(
        item
        for item in client.get("/admin/activity/results").json()["items"]
        if item["code"] == "WINNER"
    )
    category = client.get("/admin/activity/categories").json()["items"][0]
    level = next(
        item
        for item in client.get("/admin/activity/levels").json()["items"]
        if item["code"] == "CITY"
    )

    event = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Activity integration",
            "slug": f"activity-{uuid4().hex[:8]}",
            "description": "Activity integration test",
            "startAt": "2026-02-01T10:00:00Z",
            "endAt": "2026-02-01T12:00:00Z",
            "registrationDeadline": "2026-01-31T10:00:00Z",
            "timezone": "Europe/Moscow",
            "location": "КАИТ №20",
            "capacity": 20,
            "status": "DRAFT",
            "seasonId": season.json()["id"],
            "categoryId": category["id"],
            "levelId": level["id"],
        },
    )
    assert event.status_code == 201, event.text
    event_id = event.json()["id"]
    assert event.json()["seasonId"] == season.json()["id"]

    rule_payload = {
        "seasonId": season.json()["id"],
        "eventCategoryId": category["id"],
        "eventLevelId": level["id"],
        "participationRoleId": volunteer["id"],
        "participationResultId": None,
        "points": 30,
        "priority": 100,
        "active": True,
        "validFrom": None,
        "validTo": None,
    }
    rule = client.post(
        "/admin/activity/scoring-rules", headers=headers, json=rule_payload
    )
    assert rule.status_code == 201, rule.text
    conflict = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            **rule_payload,
            "eventCategoryId": None,
            "participationResultId": winner["id"],
        },
    )
    assert (conflict.status_code, conflict.json()["error"]["code"]) == (
        409,
        "SCORING_RULE_CONFLICT",
    )

    registration_id = create_registration(database, event_id)
    listed = client.get(f"/admin/events/{event_id}/participations")
    assert listed.status_code == 200, listed.text
    draft = next(
        item
        for item in listed.json()["items"]
        if item["registrationId"] == registration_id
    )
    assert draft["status"] == "DRAFT" and draft["id"] is None

    with database.transaction() as connection:
        connection.execute(
            text("UPDATE registrations SET first_attended_at=NULL WHERE id=:id"),
            {"id": registration_id},
        )
    rejected = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={"registrationIds": [registration_id], "roleId": volunteer["id"]},
    )
    assert (rejected.status_code, rejected.json()["error"]["code"]) == (
        409,
        "ATTENDANCE_REQUIRED",
    )
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": volunteer["id"],
            "confirmWithoutAttendance": True,
            "overrideReason": "Участие подтверждено организатором по ведомости",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    participation_id = confirmed.json()["participationIds"][0]
    repeated = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": volunteer["id"],
            "confirmWithoutAttendance": True,
            "overrideReason": "Повторный безопасный запрос",
        },
    )
    assert repeated.json()["participationIds"] == [participation_id]
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM score_transactions WHERE participation_id=:id AND transaction_type='AWARD'"
                ),
                {"id": participation_id},
            ).scalar_one()
            == 1
        )
        audit_metadata = connection.execute(
            text(
                "SELECT metadata FROM audit_log WHERE action='PARTICIPATION_CONFIRMED' AND entity_id=:id"
            ),
            {"id": participation_id},
        ).scalar_one()
        assert "по ведомости" in str(audit_metadata)

    replaced = client.patch(
        f"/admin/activity/scoring-rules/{rule.json()['id']}",
        headers=headers,
        json={**rule_payload, "points": 20},
    )
    assert replaced.status_code == 201, replaced.text
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT points FROM score_transactions WHERE participation_id=:id AND transaction_type='AWARD'"
                ),
                {"id": participation_id},
            ).scalar_one()
            == 30
        )

    cancelled = client.post(
        f"/admin/events/{event_id}/participations/cancel",
        headers=headers,
        json={
            "participationIds": [participation_id],
            "reason": "Ошибочное подтверждение",
        },
    )
    assert cancelled.status_code == 200, cancelled.text
    assert (
        client.post(
            f"/admin/events/{event_id}/participations/cancel",
            headers=headers,
            json={"participationIds": [participation_id], "reason": "Повтор отмены"},
        ).status_code
        == 200
    )
    restored = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": volunteer["id"],
            "confirmWithoutAttendance": True,
            "overrideReason": "Восстановлено после проверки",
        },
    )
    assert restored.status_code == 200, restored.text
    with database.connect() as connection:
        transactions = connection.execute(
            text(
                "SELECT transaction_type,points FROM score_transactions WHERE participation_id=:id ORDER BY created_at,id"
            ),
            {"id": participation_id},
        ).all()
        # The Event happened before the replacement boundary, so delayed rescoring
        # keeps using the historical rule version.
        assert sum(item[1] for item in transactions) == 30
        assert [item[0] for item in transactions].count("AWARD") == 2
        assert [item[0] for item in transactions].count("REVERSAL") == 1

    changed = client.patch(
        f"/admin/events/{event_id}/participations/{participation_id}",
        headers=headers,
        json={
            "roleId": participant["id"],
            "resultId": winner["id"],
            "reason": "Уточнение фактической роли",
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["role"]["code"] == "PARTICIPANT"
    assert changed.json()["result"]["code"] == "WINNER"
    assert changed.json()["scoringState"] == "NO_RULE"

    with database.connect() as connection:
        person_id = connection.execute(
            text("SELECT person_id FROM registrations WHERE id=:id"),
            {"id": registration_id},
        ).scalar_one()
    adjustment_id = str(uuid4())
    adjustment_payload = {
        "requestId": adjustment_id,
        "personId": person_id,
        "seasonId": season.json()["id"],
        "points": 5,
        "reason": "Проверенная ручная корректировка",
    }
    adjustment = client.post(
        "/admin/activity/score-adjustments",
        headers=headers,
        json=adjustment_payload,
    )
    assert adjustment.status_code == 201, adjustment.text
    repeated_adjustment = client.post(
        "/admin/activity/score-adjustments",
        headers=headers,
        json=adjustment_payload,
    )
    assert repeated_adjustment.json()["id"] == adjustment.json()["id"]
    changed_adjustment = client.post(
        "/admin/activity/score-adjustments",
        headers=headers,
        json={**adjustment_payload, "points": 6},
    )
    assert (
        changed_adjustment.status_code,
        changed_adjustment.json()["error"]["code"],
    ) == (409, "IDEMPOTENCY_KEY_REUSED")
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM score_transactions WHERE idempotency_key=:key"
                ),
                {"key": f"manual:{adjustment_id}"},
            ).scalar_one()
            == 1
        )
    seasonal_achievement = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "eventId": event_id,
            "participationId": participation_id,
            "title": "Сезонное достижение",
            "achievementType": "CERTIFICATE",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-02-01T10:00:00Z",
        },
    )
    lifetime_achievement = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Достижение без сезона",
            "achievementType": "CERTIFICATE",
            "source": "MANUAL",
            "occurredAt": "2025-12-01T10:00:00Z",
        },
    )
    for achievement in (seasonal_achievement, lifetime_achievement):
        assert achievement.status_code == 201, achievement.text
        decided = client.patch(
            f"/admin/people/{person_id}/achievements/{achievement.json()['id']}",
            headers=headers,
            json={"status": "VERIFIED", "reason": "Проверено для рейтинга"},
        )
        assert decided.status_code == 200, decided.text
    profile = client.get(f"/admin/people/{person_id}/profile")
    assert profile.json()["visibility"] == "PRIVATE"
    assert client.get("/public/profiles/not-a-real-profile").status_code == 404
    consent = client.post(
        f"/admin/people/{person_id}/profile/consent",
        headers=headers,
        json={
            "consentVersion": "active-test-v1",
            "allowedFields": ["NAME", "SCORES"],
            "source": "ADMIN",
        },
    )
    assert consent.status_code == 201, consent.text
    published = client.patch(
        f"/admin/people/{person_id}/profile",
        headers=headers,
        json={"visibility": "PUBLIC"},
    )
    assert published.status_code == 200, published.text
    slug = published.json()["publicSlug"]
    public_profile = client.get(f"/public/profiles/{slug}")
    assert public_profile.status_code == 200
    assert "email" not in public_profile.json() and "phone" not in public_profile.json()
    leaderboard = client.get(
        "/public/leaderboard",
        params={"seasonId": season.json()["id"]},
    )
    assert leaderboard.status_code == 200, leaderboard.text
    assert all("personId" not in item for item in leaderboard.json()["items"])
    leaderboard_item = next(
        item for item in leaderboard.json()["items"] if item["publicSlug"] == slug
    )
    assert "confirmedParticipations" not in leaderboard_item
    assert "achievements" not in leaderboard_item

    participation_consent = client.post(
        f"/admin/people/{person_id}/profile/consent",
        headers=headers,
        json={
            "consentVersion": "active-test-v2",
            "allowedFields": ["NAME", "SCORES", "PARTICIPATIONS"],
            "source": "ADMIN",
        },
    )
    assert participation_consent.status_code == 201, participation_consent.text
    participation_item = next(
        item
        for item in client.get(
            "/public/leaderboard", params={"seasonId": season.json()["id"]}
        ).json()["items"]
        if item["publicSlug"] == slug
    )
    assert "confirmedParticipations" in participation_item
    assert "achievements" not in participation_item

    achievement_consent = client.post(
        f"/admin/people/{person_id}/profile/consent",
        headers=headers,
        json={
            "consentVersion": "active-test-v3",
            "allowedFields": ["NAME", "SCORES", "ACHIEVEMENTS"],
            "source": "ADMIN",
        },
    )
    assert achievement_consent.status_code == 201, achievement_consent.text
    achievement_item = next(
        item
        for item in client.get(
            "/public/leaderboard", params={"seasonId": season.json()["id"]}
        ).json()["items"]
        if item["publicSlug"] == slug
    )
    assert "achievements" in achievement_item
    assert achievement_item["achievements"] == 1
    assert "confirmedParticipations" not in achievement_item
    assert (
        client.delete(
            f"/admin/people/{person_id}/profile/consent", headers=headers
        ).status_code
        == 200
    )
    assert client.get(f"/public/profiles/{slug}").status_code == 404
    assert all(
        item["publicSlug"] != slug
        for item in client.get(
            "/public/leaderboard", params={"seasonId": season.json()["id"]}
        ).json()["items"]
    )


def test_parallel_participation_confirmation_creates_one_award(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    with database.connect() as connection:
        event = connection.execute(
            text(
                "SELECT id FROM events WHERE title='Activity integration' ORDER BY created_at DESC LIMIT 1"
            )
        ).scalar_one()
        volunteer = connection.execute(
            text("SELECT id FROM participation_roles WHERE code='VOLUNTEER'")
        ).scalar_one()
    registration_id = create_registration(database, event, "parallel")

    def confirm() -> int:
        response = client.post(
            f"/admin/events/{event}/participations/confirm",
            headers=headers,
            json={"registrationIds": [registration_id], "roleId": volunteer},
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _index: confirm(), range(2)))
    assert statuses == [200, 200]
    with database.connect() as connection:
        counts = connection.execute(
            text("""SELECT COUNT(*) AS participations,
            (SELECT COUNT(*) FROM score_transactions st JOIN participations p2 ON p2.id=st.participation_id
             WHERE p2.registration_id=:registration AND st.transaction_type='AWARD') AS awards
            FROM participations WHERE registration_id=:registration"""),
            {"registration": registration_id},
        ).one()
    assert counts == (1, 1)


def test_scanner_cannot_access_activity_administration(client: TestClient) -> None:
    database: Database = client.app.state.database
    scanner_id = str(uuid4())
    email = f"activity-scanner-{scanner_id[:12]}@example.com"
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO staff_users
            (id,tenant_id,organization_id,email,email_normalized,password_hash,system_role,active,password_changed_at,created_at,updated_at)
            VALUES (:id,'50000000-0000-4000-8000-000000000001',
                    '51000000-0000-4000-8000-000000000001',:email,:email,:password,
                    'SCANNER',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "id": scanner_id,
                "email": email,
                "password": hash_password("scanner activity password"),
            },
        )
    client.cookies.clear()
    authenticated = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": email, "password": "scanner activity password"},
    )
    assert authenticated.status_code == 200, authenticated.text
    assert client.get("/admin/activity/roles").status_code == 403
    assert client.get("/admin/activity/seasons").status_code == 403

    organizer_id = str(uuid4())
    organizer_email = f"activity-organizer-{organizer_id[:12]}@example.com"
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO staff_users
            (id,tenant_id,organization_id,email,email_normalized,password_hash,system_role,active,password_changed_at,created_at,updated_at)
            VALUES (:id,'50000000-0000-4000-8000-000000000001',
                    '51000000-0000-4000-8000-000000000001',:email,:email,:password,
                    'ORGANIZER',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "id": organizer_id,
                "email": organizer_email,
                "password": hash_password("organizer activity password"),
            },
        )
    client.cookies.clear()
    organizer_login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": organizer_email, "password": "organizer activity password"},
    )
    assert organizer_login.status_code == 200, organizer_login.text
    organizer_headers = {
        **ORIGIN,
        "X-CSRF-Token": organizer_login.json()["csrfToken"],
    }
    assert client.get("/admin/activity/roles").status_code == 200
    assert (
        client.post(
            "/admin/activity/roles",
            headers=organizer_headers,
            json={"code": "FORBIDDEN_ROLE", "name": "Запрещённая роль"},
        ).status_code
        == 403
    )


def test_event_purge_rejects_confirmed_activity_and_preserves_history(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    with database.connect() as connection:
        event_id, slug = connection.execute(
            text("""SELECT id,slug FROM events WHERE title='Activity integration'
            ORDER BY created_at DESC LIMIT 1""")
        ).one()
        person_id = connection.execute(
            text("SELECT person_id FROM registrations WHERE event_id=:event LIMIT 1"),
            {"event": event_id},
        ).scalar_one()
    profile = client.get(f"/admin/people/{person_id}/profile")
    assert profile.status_code == 200, profile.text
    archived = client.post(f"/admin/events/{event_id}/archive", headers=headers)
    assert archived.status_code == 201, archived.text
    purged = client.post(
        f"/admin/events/{event_id}/purge",
        headers=headers,
        json={"confirmationSlug": slug},
    )
    assert (purged.status_code, purged.json()["error"]["code"]) == (
        409,
        "EVENT_HAS_ACTIVITY_HISTORY",
    )
    with database.connect() as connection:
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM events WHERE id=:id"), {"id": event_id}
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM persons WHERE id=:id"), {"id": person_id}
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM student_profiles WHERE person_id=:id"),
                {"id": person_id},
            ).scalar_one()
            == 1
        )


def test_event_purge_allows_no_activity_and_rejects_draft_or_achievement(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database

    empty_event, empty_slug = create_event(
        client, headers, title="Purge without Activity"
    )
    assert (
        client.post(f"/admin/events/{empty_event}/archive", headers=headers).status_code
        == 201
    )
    empty_purge = client.post(
        f"/admin/events/{empty_event}/purge",
        headers=headers,
        json={"confirmationSlug": empty_slug},
    )
    assert empty_purge.status_code == 200, empty_purge.text

    draft_event, draft_slug = create_event(client, headers, title="Draft Activity")
    draft_registration = create_registration(database, draft_event, "draft-purge")
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{draft_event}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [draft_registration],
            "roleId": role["id"],
            "reason": "Черновая историческая запись",
        },
    )
    assert assigned.status_code == 200, assigned.text
    assert (
        client.post(f"/admin/events/{draft_event}/archive", headers=headers).status_code
        == 201
    )
    draft_purge = client.post(
        f"/admin/events/{draft_event}/purge",
        headers=headers,
        json={"confirmationSlug": draft_slug},
    )
    assert (draft_purge.status_code, draft_purge.json()["error"]["code"]) == (
        409,
        "EVENT_HAS_ACTIVITY_HISTORY",
    )

    achievement_event, achievement_slug = create_event(
        client, headers, title="Achievement Activity"
    )
    _, person_id = create_registration_for_person(
        database, achievement_event, "achievement-purge"
    )
    achievement = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "eventId": achievement_event,
            "title": "Подтверждаемая история",
            "achievementType": "CERTIFICATE",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
        },
    )
    assert achievement.status_code == 201, achievement.text
    assert (
        client.post(
            f"/admin/events/{achievement_event}/archive", headers=headers
        ).status_code
        == 201
    )
    achievement_purge = client.post(
        f"/admin/events/{achievement_event}/purge",
        headers=headers,
        json={"confirmationSlug": achievement_slug},
    )
    assert (
        achievement_purge.status_code,
        achievement_purge.json()["error"]["code"],
    ) == (409, "EVENT_HAS_ACTIVITY_HISTORY")


def test_historical_membership_privacy_and_event_date_scoring(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    code = f"HISTORY_{uuid4().hex[:8].upper()}"
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": code,
            "name": "Исторический сезон",
            "startsAt": "2026-09-01T00:00:00Z",
            "endsAt": "2027-07-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "VOLUNTEER"
    )
    rule_base = {
        "seasonId": season_id,
        "eventCategoryId": None,
        "eventLevelId": None,
        "participationRoleId": role["id"],
        "participationResultId": None,
        "priority": 70,
        "active": True,
    }
    autumn_rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            **rule_base,
            "points": 10,
            "validFrom": "2026-09-01T00:00:00Z",
            "validTo": "2027-01-01T00:00:00Z",
        },
    )
    spring_rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            **rule_base,
            "points": 20,
            "validFrom": "2027-01-01T00:00:00Z",
            "validTo": "2027-07-01T00:00:00Z",
        },
    )
    assert autumn_rule.status_code == 201, autumn_rule.text
    assert spring_rule.status_code == 201, spring_rule.text

    october_event, _ = create_event(
        client,
        headers,
        title="October historical attribution",
        start_at="2026-10-10T10:00:00Z",
        end_at="2026-10-10T12:00:00Z",
        season_id=season_id,
    )
    march_event, _ = create_event(
        client,
        headers,
        title="March historical attribution",
        start_at="2027-03-10T10:00:00Z",
        end_at="2027-03-10T12:00:00Z",
        season_id=season_id,
    )
    october_registration, person_id = create_registration_for_person(
        database, october_event, "membership-history"
    )
    march_registration, _ = create_registration_for_person(
        database, march_event, "membership-history", person_id
    )
    group_a_id = create_study_group(client, headers, "GROUP_A", "DEPT_A", 3)
    group_b_id = create_study_group(client, headers, "GROUP_B", "DEPT_B", 4)
    group_a = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={
            "studyGroupId": group_a_id,
            "validFrom": "2026-09-01",
            "validTo": "2026-12-31",
        },
    )
    group_b = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={
            "studyGroupId": group_b_id,
            "validFrom": "2027-01-01",
            "validTo": "2027-06-30",
        },
    )
    assert group_a.status_code == 201, group_a.text
    assert group_b.status_code == 201, group_b.text
    overlap = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={
            "studyGroupId": group_a_id,
            "validFrom": "2026-12-01",
            "validTo": "2027-02-01",
        },
    )
    assert (overlap.status_code, overlap.json()["error"]["code"]) == (
        409,
        "MEMBERSHIP_PERIOD_OVERLAP",
    )

    for event_id, registration_id in (
        (october_event, october_registration),
        (march_event, march_registration),
    ):
        confirmed = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={"registrationIds": [registration_id], "roleId": role["id"]},
        )
        assert confirmed.status_code == 200, confirmed.text

    client.get(f"/admin/people/{person_id}/profile")
    consent = client.post(
        f"/admin/people/{person_id}/profile/consent",
        headers=headers,
        json={
            "consentVersion": "history-v1",
            "allowedFields": ["NAME", "SCORES"],
            "source": "ADMIN",
        },
    )
    assert consent.status_code == 201, consent.text
    published = client.patch(
        f"/admin/people/{person_id}/profile",
        headers=headers,
        json={"visibility": "PUBLIC"},
    )
    assert published.status_code == 200, published.text

    groups = client.get("/public/leaderboard/groups", params={"seasonId": season_id})
    assert groups.status_code == 200, groups.text
    group_points = {item["name"]: item["points"] for item in groups.json()["items"]}
    assert group_points == {"GROUP_B": "20.0000", "GROUP_A": "10.0000"}
    departments = client.get(
        "/public/leaderboard/departments", params={"seasonId": season_id}
    )
    department_points = {
        item["name"]: item["points"] for item in departments.json()["items"]
    }
    assert department_points == {"DEPT_B": "20.0000", "DEPT_A": "10.0000"}
    with database.connect() as connection:
        attributed = connection.execute(
            text("""SELECT sm.study_group,st.points FROM score_transactions st
            JOIN student_memberships sm ON sm.id=st.membership_id
            WHERE st.person_id=:person AND st.season_id=:season
            ORDER BY st.points"""),
            {"person": person_id, "season": season_id},
        ).all()
    assert attributed == [("GROUP_A", 10), ("GROUP_B", 20)]

    assert (
        client.delete(
            f"/admin/people/{person_id}/profile/consent", headers=headers
        ).status_code
        == 200
    )
    assert (
        client.get("/public/leaderboard/groups", params={"seasonId": season_id}).json()[
            "items"
        ]
        == []
    )


def test_manual_adjustment_rejects_changed_idempotency_payload(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Manual adjustment identities")
    _, first_person = create_registration_for_person(database, event_id, "manual-one")
    _, second_person = create_registration_for_person(database, event_id, "manual-two")

    def season(label: str) -> str:
        response = client.post(
            "/admin/activity/seasons",
            headers=headers,
            json={
                "code": f"{label}_{uuid4().hex[:8].upper()}",
                "name": label,
                "startsAt": "2026-01-01T00:00:00Z",
                "endsAt": "2026-12-31T23:59:59Z",
                "active": False,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    first_season, second_season = season("MANUAL_A"), season("MANUAL_B")
    request_id = str(uuid4())
    payload = {
        "requestId": request_id,
        "personId": first_person,
        "seasonId": first_season,
        "points": 5,
        "reason": "Проверенная корректировка",
    }
    created = client.post(
        "/admin/activity/score-adjustments", headers=headers, json=payload
    )
    retried = client.post(
        "/admin/activity/score-adjustments", headers=headers, json=payload
    )
    assert created.status_code == 201 and retried.status_code == 201
    assert created.json()["id"] == retried.json()["id"]
    variants = (
        {**payload, "points": 6},
        {**payload, "personId": second_person},
        {**payload, "seasonId": second_season},
    )
    for variant in variants:
        response = client.post(
            "/admin/activity/score-adjustments", headers=headers, json=variant
        )
        assert (response.status_code, response.json()["error"]["code"]) == (
            409,
            "IDEMPOTENCY_KEY_REUSED",
        )
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM audit_log WHERE action='SCORE_MANUAL_ADJUSTMENT' AND entity_id=:id"
                ),
                {"id": created.json()["id"]},
            ).scalar_one()
            == 1
        )


def test_profile_and_consent_concurrency_is_serialized(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Consent concurrency")
    _, person_id = create_registration_for_person(database, event_id, "consent-race")

    with ThreadPoolExecutor(max_workers=2) as pool:
        profile_statuses = list(
            pool.map(
                lambda _index: (
                    client.get(f"/admin/people/{person_id}/profile").status_code
                ),
                range(2),
            )
        )
    assert profile_statuses == [200, 200]

    def grant(index: int) -> int:
        return client.post(
            f"/admin/people/{person_id}/profile/consent",
            headers=headers,
            json={
                "consentVersion": f"concurrent-{index}",
                "allowedFields": ["NAME", "SCORES"],
                "source": "ADMIN",
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        consent_statuses = list(pool.map(grant, range(2)))
    assert consent_statuses == [201, 201]
    with database.connect() as connection:
        profile_count = connection.execute(
            text("SELECT COUNT(*) FROM student_profiles WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
        consent_count = connection.execute(
            text("""SELECT COUNT(*) FROM profile_publication_consents
            WHERE person_id=:person AND withdrawn_at IS NULL"""),
            {"person": person_id},
        ).scalar_one()
    assert (profile_count, consent_count) == (1, 1)


def test_achievement_reference_integrity(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    first_event, _ = create_event(client, headers, title="Achievement references A")
    second_event, _ = create_event(client, headers, title="Achievement references B")
    first_registration, first_person = create_registration_for_person(
        database, first_event, "achievement-one"
    )
    _, second_person = create_registration_for_person(
        database, second_event, "achievement-two"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{first_event}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [first_registration],
            "roleId": role["id"],
            "reason": "Проверка ссылочной целостности",
        },
    )
    participation_id = assigned.json()["participationIds"][0]
    base = {
        "title": "Проверяемое достижение",
        "achievementType": "CERTIFICATE",
        "source": "EVENT_KAIT20",
        "occurredAt": "2026-10-01T10:00:00Z",
    }
    mismatches = (
        (
            second_person,
            {**base, "personId": second_person, "participationId": participation_id},
        ),
        (
            first_person,
            {
                **base,
                "personId": first_person,
                "eventId": second_event,
                "participationId": participation_id,
            },
        ),
        (
            first_person,
            {**base, "personId": first_person, "eventId": str(uuid4())},
        ),
        (
            first_person,
            {
                **base,
                "personId": first_person,
                "eventId": first_event,
                "levelId": str(uuid4()),
            },
        ),
    )
    for route_person, payload in mismatches:
        response = client.post(
            f"/admin/people/{route_person}/achievements",
            headers=headers,
            json=payload,
        )
        assert response.status_code == 400, response.text


def test_parallel_scoring_rule_conflict_is_serialized(client: TestClient) -> None:
    headers = login(client)
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"RULE_RACE_{uuid4().hex[:8].upper()}",
            "name": "Конкурентные правила",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "VOLUNTEER"
    )
    payload = {
        "seasonId": season.json()["id"],
        "eventCategoryId": None,
        "eventLevelId": None,
        "participationRoleId": role["id"],
        "participationResultId": None,
        "points": 10,
        "priority": 99,
        "validFrom": "2026-01-01T00:00:00Z",
        "validTo": "2026-12-31T00:00:00Z",
        "active": True,
    }

    def create_rule(_index: int) -> tuple[int, str | None]:
        response = client.post(
            "/admin/activity/scoring-rules", headers=headers, json=payload
        )
        error = response.json().get("error")
        return response.status_code, error["code"] if error else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create_rule, range(2)))
    assert sorted(results) == [(201, None), (409, "SCORING_RULE_CONFLICT")]


def test_membership_uses_moscow_event_calendar_date(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"MOSCOW_DATE_{uuid4().hex[:8].upper()}",
            "name": "Московская дата membership",
            "startsAt": "2026-09-01T00:00:00Z",
            "endsAt": "2027-07-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season_id,
            "participationRoleId": role["id"],
            "points": 10,
            "priority": 301,
            "active": True,
            "validFrom": "2026-09-01T00:00:00Z",
            "validTo": "2027-07-01T00:00:00Z",
        },
    )
    assert rule.status_code == 201, rule.text
    late_december_event, _ = create_event(
        client,
        headers,
        title="Moscow 31 December",
        start_at="2026-12-31T23:30:00+03:00",
        end_at="2027-01-01T00:00:00+03:00",
        season_id=season_id,
    )
    early_january_event, _ = create_event(
        client,
        headers,
        title="Moscow 1 January",
        start_at="2027-01-01T00:30:00+03:00",
        end_at="2027-01-01T01:00:00+03:00",
        season_id=season_id,
    )
    december_registration, person_id = create_registration_for_person(
        database, late_december_event, "moscow-date"
    )
    january_registration, _ = create_registration_for_person(
        database, early_january_event, "moscow-date", person_id
    )
    group_a_id = create_study_group(client, headers, "GROUP_A", "DATE_DEPT_A", 3)
    group_b_id = create_study_group(client, headers, "GROUP_B", "DATE_DEPT_B", 4)
    for payload in (
        {
            "studyGroupId": group_a_id,
            "validFrom": "2026-09-01",
            "validTo": "2026-12-31",
        },
        {
            "studyGroupId": group_b_id,
            "validFrom": "2027-01-01",
            "validTo": None,
        },
    ):
        response = client.post(
            f"/admin/people/{person_id}/memberships", headers=headers, json=payload
        )
        assert response.status_code == 201, response.text
    for event_id, registration_id in (
        (late_december_event, december_registration),
        (early_january_event, january_registration),
    ):
        response = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={"registrationIds": [registration_id], "roleId": role["id"]},
        )
        assert response.status_code == 200, response.text
    with database.connect() as connection:
        attributed = connection.execute(
            text("""SELECT e.title,sm.study_group FROM score_transactions st
            JOIN participations p ON p.id=st.participation_id
            JOIN events e ON e.id=p.event_id
            JOIN student_memberships sm ON sm.id=st.membership_id
            WHERE st.person_id=:person AND st.transaction_type='AWARD'
            ORDER BY e.start_at"""),
            {"person": person_id},
        ).all()
    assert attributed == [
        ("Moscow 31 December", "GROUP_A"),
        ("Moscow 1 January", "GROUP_B"),
    ]


def test_retroactive_rule_boundary_respects_existing_awards(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"RETRO_{uuid4().hex[:8].upper()}",
            "name": "Границы версий scoring",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "VOLUNTEER"
    )

    def create_rule(priority: int) -> tuple[str, dict[str, object]]:
        payload: dict[str, object] = {
            "seasonId": season_id,
            "participationRoleId": role["id"],
            "points": 10,
            "priority": priority,
            "active": True,
            "validFrom": "2026-01-01T00:00:00Z",
            "validTo": None,
        }
        response = client.post(
            "/admin/activity/scoring-rules", headers=headers, json=payload
        )
        assert response.status_code == 201, response.text
        return response.json()["id"], payload

    no_award_rule, no_award_payload = create_rule(311)
    allowed_without_awards = client.patch(
        f"/admin/activity/scoring-rules/{no_award_rule}",
        headers=headers,
        json={
            **no_award_payload,
            "points": 20,
            "validFrom": "2026-06-15T00:00:00Z",
        },
    )
    assert allowed_without_awards.status_code == 201, allowed_without_awards.text

    conflicting_rule, conflicting_payload = create_rule(312)
    after_boundary_event, _ = create_event(
        client,
        headers,
        title="Award after retro boundary",
        start_at="2026-06-20T10:00:00Z",
        end_at="2026-06-20T12:00:00Z",
        season_id=season_id,
    )
    after_registration = create_registration(
        database, after_boundary_event, "retro-after"
    )
    confirmed_after = client.post(
        f"/admin/events/{after_boundary_event}/participations/confirm",
        headers=headers,
        json={"registrationIds": [after_registration], "roleId": role["id"]},
    )
    assert confirmed_after.status_code == 200, confirmed_after.text
    rejected = client.patch(
        f"/admin/activity/scoring-rules/{conflicting_rule}",
        headers=headers,
        json={
            **conflicting_payload,
            "points": 20,
            "validFrom": "2026-06-15T00:00:00Z",
        },
    )
    assert (rejected.status_code, rejected.json()["error"]["code"]) == (
        409,
        "SCORING_RULE_RETROACTIVE_CONFLICT",
    )

    historical_rule, historical_payload = create_rule(313)
    before_boundary_event, _ = create_event(
        client,
        headers,
        title="Award before retro boundary",
        start_at="2026-06-10T10:00:00Z",
        end_at="2026-06-10T12:00:00Z",
        season_id=season_id,
    )
    first_registration, _ = create_registration_for_person(
        database, before_boundary_event, "retro-before-one"
    )
    first_confirmation = client.post(
        f"/admin/events/{before_boundary_event}/participations/confirm",
        headers=headers,
        json={"registrationIds": [first_registration], "roleId": role["id"]},
    )
    assert first_confirmation.status_code == 200, first_confirmation.text
    allowed_before_award = client.patch(
        f"/admin/activity/scoring-rules/{historical_rule}",
        headers=headers,
        json={
            **historical_payload,
            "points": 20,
            "validFrom": "2026-06-15T00:00:00Z",
        },
    )
    assert allowed_before_award.status_code == 201, allowed_before_award.text
    delayed_registration, _ = create_registration_for_person(
        database, before_boundary_event, "retro-before-two"
    )
    delayed_confirmation = client.post(
        f"/admin/events/{before_boundary_event}/participations/confirm",
        headers=headers,
        json={"registrationIds": [delayed_registration], "roleId": role["id"]},
    )
    assert delayed_confirmation.status_code == 200, delayed_confirmation.text
    with database.connect() as connection:
        awards = connection.execute(
            text("""SELECT st.points,st.scoring_rule_id FROM score_transactions st
            JOIN participations p ON p.id=st.participation_id
            WHERE p.event_id=:event AND st.transaction_type='AWARD'
            ORDER BY st.created_at,st.id"""),
            {"event": before_boundary_event},
        ).all()
    assert awards == [(10, historical_rule), (10, historical_rule)]


def test_scoring_rule_mutations_use_consistent_lock_order(
    client: TestClient,
) -> None:
    headers = login(client)
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"LOCKS_{uuid4().hex[:8].upper()}",
            "name": "Lock order scoring rules",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2028-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    roles = {
        item["code"]: item["id"]
        for item in client.get("/admin/activity/roles").json()["items"]
    }

    def payload(role: str, priority: int, points: int = 10) -> dict[str, object]:
        return {
            "seasonId": season_id,
            "participationRoleId": roles[role],
            "points": points,
            "priority": priority,
            "active": True,
            "validFrom": "2026-01-01T00:00:00Z",
            "validTo": None,
        }

    def create_rule(values: dict[str, object]) -> str:
        response = client.post(
            "/admin/activity/scoring-rules", headers=headers, json=values
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    rule_a_payload = payload("PARTICIPANT", 401)
    rule_b_payload = payload("VOLUNTEER", 402)
    rule_a = create_rule(rule_a_payload)
    rule_b = create_rule(rule_b_payload)

    def patch_rule(target: tuple[str, dict[str, object]]) -> int:
        identity, values = target
        return client.patch(
            f"/admin/activity/scoring-rules/{identity}",
            headers=headers,
            json={
                **values,
                "points": 15,
                "validFrom": "2027-01-01T00:00:00Z",
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        patch_statuses = list(
            pool.map(patch_rule, ((rule_a, rule_a_payload), (rule_b, rule_b_payload)))
        )
    assert patch_statuses == [201, 201]

    patch_create_payload = payload("ORGANIZER", 403)
    patch_create_rule = create_rule(patch_create_payload)

    def patch_existing() -> tuple[int, str | None]:
        response = client.patch(
            f"/admin/activity/scoring-rules/{patch_create_rule}",
            headers=headers,
            json={
                **patch_create_payload,
                "points": 20,
                "validFrom": "2027-01-01T00:00:00Z",
            },
        )
        error = response.json().get("error")
        return response.status_code, error["code"] if error else None

    def create_conflict() -> tuple[int, str | None]:
        response = client.post(
            "/admin/activity/scoring-rules",
            headers=headers,
            json={
                **patch_create_payload,
                "points": 30,
                "validFrom": "2027-01-01T00:00:00Z",
            },
        )
        error = response.json().get("error")
        return response.status_code, error["code"] if error else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        patch_create_results = [
            future.result()
            for future in (
                pool.submit(patch_existing),
                pool.submit(create_conflict),
            )
        ]
    assert sorted(patch_create_results) == [
        (201, None),
        (409, "SCORING_RULE_CONFLICT"),
    ]

    deactivate_payload = payload("SPEAKER", 404)
    deactivate_rule = create_rule(deactivate_payload)

    def deactivate() -> int:
        return client.delete(
            f"/admin/activity/scoring-rules/{deactivate_rule}", headers=headers
        ).status_code

    def create_after_deactivate() -> int:
        return client.post(
            "/admin/activity/scoring-rules",
            headers=headers,
            json={**deactivate_payload, "points": 25},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        deactivate_status, create_status = [
            future.result()
            for future in (
                pool.submit(deactivate),
                pool.submit(create_after_deactivate),
            )
        ]
    assert deactivate_status == 200
    assert create_status in {201, 409}


def test_scoring_rule_retirement_preserves_historical_delayed_scoring(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"RETIRE_{uuid4().hex[:8].upper()}",
            "name": "Historical rule retirement",
            "startsAt": "2025-01-01T00:00:00Z",
            "endsAt": "2031-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "VOLUNTEER"
    )
    rule_payload = {
        "seasonId": season_id,
        "participationRoleId": role["id"],
        "points": 10,
        "priority": 501,
        "active": True,
        "validFrom": "2025-01-01T00:00:00Z",
        "validTo": None,
    }
    rule = client.post(
        "/admin/activity/scoring-rules", headers=headers, json=rule_payload
    )
    assert rule.status_code == 201, rule.text
    rule_id = rule.json()["id"]
    historical_event, _ = create_event(
        client,
        headers,
        title="Historical retirement event",
        start_at="2025-06-15T10:00:00Z",
        end_at="2025-06-15T12:00:00Z",
        season_id=season_id,
    )
    first_registration = create_registration(database, historical_event, "retire-a")
    delayed_registration = create_registration(database, historical_event, "retire-b")
    first_confirmation = client.post(
        f"/admin/events/{historical_event}/participations/confirm",
        headers=headers,
        json={"registrationIds": [first_registration], "roleId": role["id"]},
    )
    assert first_confirmation.status_code == 200, first_confirmation.text

    retired = client.delete(f"/admin/activity/scoring-rules/{rule_id}", headers=headers)
    assert retired.status_code == 200, retired.text
    with database.connect() as connection:
        retired_rule = (
            connection.execute(
                text("SELECT active,valid_to FROM scoring_rules WHERE id=:id"),
                {"id": rule_id},
            )
            .mappings()
            .one()
        )
        retired_audits = (
            connection.execute(
                text(
                    """SELECT metadata FROM audit_log
                WHERE action='SCORING_RULE_RETIRED' AND entity_id=:id"""
                ),
                {"id": rule_id},
            )
            .scalars()
            .all()
        )
    assert retired_rule["active"] == 1
    assert retired_rule["valid_to"] is not None
    assert len(retired_audits) == 1
    assert "historical" in str(retired_audits[0])

    delayed_confirmation = client.post(
        f"/admin/events/{historical_event}/participations/confirm",
        headers=headers,
        json={"registrationIds": [delayed_registration], "roleId": role["id"]},
    )
    assert delayed_confirmation.status_code == 200, delayed_confirmation.text
    with database.connect() as connection:
        historical_awards = connection.execute(
            text(
                """SELECT points,scoring_rule_id FROM score_transactions st
                JOIN participations p ON p.id=st.participation_id
                WHERE p.event_id=:event AND st.transaction_type='AWARD'
                ORDER BY st.created_at,st.id"""
            ),
            {"event": historical_event},
        ).all()
    assert historical_awards == [(10, rule_id), (10, rule_id)]

    post_retirement_event, _ = create_event(
        client,
        headers,
        title="Event after retirement",
        start_at="2030-06-15T10:00:00Z",
        end_at="2030-06-15T12:00:00Z",
        season_id=season_id,
    )
    post_retirement_registration = create_registration(
        database, post_retirement_event, "retire-future"
    )
    post_retirement_confirmation = client.post(
        f"/admin/events/{post_retirement_event}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [post_retirement_registration],
            "roleId": role["id"],
        },
    )
    assert post_retirement_confirmation.status_code == 200
    post_retirement_participation = post_retirement_confirmation.json()[
        "participationIds"
    ][0]
    with database.connect() as connection:
        assert (
            connection.execute(
                text("SELECT scoring_state FROM participations WHERE id=:id"),
                {"id": post_retirement_participation},
            ).scalar_one()
            == "NO_RULE"
        )

    repeated = client.delete(
        f"/admin/activity/scoring-rules/{rule_id}", headers=headers
    )
    assert repeated.status_code == 200, repeated.text
    with database.connect() as connection:
        repeated_rule = connection.execute(
            text("SELECT valid_to FROM scoring_rules WHERE id=:id"),
            {"id": rule_id},
        ).scalar_one()
        repeated_audit_count = connection.execute(
            text(
                """SELECT COUNT(*) FROM audit_log
                WHERE action='SCORING_RULE_RETIRED' AND entity_id=:id"""
            ),
            {"id": rule_id},
        ).scalar_one()
    assert repeated_rule == retired_rule["valid_to"]
    assert repeated_audit_count == 1


def test_future_scoring_rule_can_be_fully_deactivated(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"FUTURE_{uuid4().hex[:8].upper()}",
            "name": "Future rule cancellation",
            "startsAt": "2035-01-01T00:00:00Z",
            "endsAt": "2037-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season.json()["id"],
            "points": 10,
            "priority": 502,
            "active": True,
            "validFrom": "2035-01-01T00:00:00Z",
            "validTo": None,
        },
    )
    assert rule.status_code == 201, rule.text
    rule_id = rule.json()["id"]
    response = client.delete(
        f"/admin/activity/scoring-rules/{rule_id}", headers=headers
    )
    assert response.status_code == 200, response.text
    with database.connect() as connection:
        stored = connection.execute(
            text("SELECT active,valid_to FROM scoring_rules WHERE id=:id"),
            {"id": rule_id},
        ).one()
        actions = (
            connection.execute(
                text(
                    "SELECT action FROM audit_log WHERE entity_id=:id ORDER BY created_at"
                ),
                {"id": rule_id},
            )
            .scalars()
            .all()
        )
    assert stored == (0, None)
    assert actions[-1] == "SCORING_RULE_DEACTIVATED"
    assert "SCORING_RULE_RETIRED" not in actions


def test_future_scoring_rule_with_award_remains_historically_visible(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"FUTURE_AWARD_{uuid4().hex[:8].upper()}",
            "name": "Future rule with historical award",
            "startsAt": "2035-01-01T00:00:00Z",
            "endsAt": "2037-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "VOLUNTEER"
    )
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season_id,
            "participationRoleId": role["id"],
            "points": 10,
            "priority": 504,
            "active": True,
            "validFrom": "2035-01-01T00:00:00Z",
            "validTo": None,
        },
    )
    assert rule.status_code == 201, rule.text
    rule_id = rule.json()["id"]
    event_id, _ = create_event(
        client,
        headers,
        title="Future event confirmed early",
        start_at="2035-06-15T10:00:00Z",
        end_at="2035-06-15T12:00:00Z",
        season_id=season_id,
    )
    registration_id = create_registration(database, event_id, "future-award")
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={"registrationIds": [registration_id], "roleId": role["id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    rejected = client.delete(
        f"/admin/activity/scoring-rules/{rule_id}", headers=headers
    )
    assert (rejected.status_code, rejected.json()["error"]["code"]) == (
        409,
        "SCORING_RULE_RETROACTIVE_CONFLICT",
    )
    with database.connect() as connection:
        stored = connection.execute(
            text("SELECT active,valid_to FROM scoring_rules WHERE id=:id"),
            {"id": rule_id},
        ).one()
    assert stored == (1, None)


def test_patch_cannot_deactivate_scoring_rule(client: TestClient) -> None:
    headers = login(client)
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"PATCH_RETIRE_{uuid4().hex[:8].upper()}",
            "name": "PATCH retirement guard",
            "startsAt": "2025-01-01T00:00:00Z",
            "endsAt": "2031-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    payload = {
        "seasonId": season.json()["id"],
        "points": 10,
        "priority": 503,
        "active": True,
        "validFrom": "2025-01-01T00:00:00Z",
        "validTo": None,
    }
    rule = client.post("/admin/activity/scoring-rules", headers=headers, json=payload)
    assert rule.status_code == 201, rule.text
    rejected = client.patch(
        f"/admin/activity/scoring-rules/{rule.json()['id']}",
        headers=headers,
        json={**payload, "active": False},
    )
    assert (rejected.status_code, rejected.json()["error"]["code"]) == (
        409,
        "SCORING_RULE_RETIRE_REQUIRED",
    )


def test_search_participations_finds_by_name_with_full_context(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"SEARCH_{uuid4().hex[:8].upper()}",
            "name": "Поиск участий",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    direction = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={"code": f"DIR_{uuid4().hex[:8].upper()}", "name": "Профориентация"},
    )
    assert direction.status_code == 201, direction.text
    event = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Поиск участий: мероприятие",
            "slug": f"search-participations-{uuid4().hex[:8]}",
            "description": "Search test",
            "startAt": "2026-08-01T10:00:00Z",
            "endAt": "2026-08-01T12:00:00Z",
            "registrationDeadline": "2026-07-31T10:00:00Z",
            "timezone": "Europe/Moscow",
            "location": "КАИТ №20",
            "capacity": 20,
            "status": "DRAFT",
            "seasonId": season.json()["id"],
            "directionId": direction.json()["id"],
        },
    )
    assert event.status_code == 201, event.text
    event_id = event.json()["id"]
    create_registration(database, event_id, suffix="search-one")

    found = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": "Участник search-one"},
    )
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["pageSize"] == 25
    item = body["items"][0]
    assert item["eventId"] == event_id
    assert item["eventTitle"] == "Поиск участий: мероприятие"
    assert item["seasonId"] == season.json()["id"]
    assert item["seasonName"] == "Поиск участий"
    assert item["directionId"] == direction.json()["id"]
    assert item["directionName"] == "Профориентация"
    assert item["status"] == "DRAFT"

    none_found = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": "СовершенноНеТотЧеловек"},
    )
    assert none_found.status_code == 200, none_found.text
    assert none_found.json()["items"] == []


def test_search_participations_filters_by_status_and_scoring_state(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(
        client, headers, title="Фильтр по статусу", start_at="2026-08-02T10:00:00Z"
    )
    create_registration(database, event_id, suffix="filter-status")

    draft_only = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": "filter-status", "status": "DRAFT"},
    )
    assert draft_only.status_code == 200, draft_only.text
    assert len(draft_only.json()["items"]) == 1

    confirmed_only = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": "filter-status", "status": "CONFIRMED"},
    )
    assert confirmed_only.status_code == 200, confirmed_only.text
    assert confirmed_only.json()["items"] == []

    awarded_only = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": "filter-status", "scoringState": "AWARDED"},
    )
    assert awarded_only.status_code == 200, awarded_only.text
    assert awarded_only.json()["items"] == []

    not_scored_only = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": "filter-status", "scoringState": "NOT_SCORED"},
    )
    assert not_scored_only.status_code == 200, not_scored_only.text
    assert len(not_scored_only.json()["items"]) == 1


def test_search_participations_excludes_other_organization_in_same_tenant(
    client: TestClient,
) -> None:
    """Same-Tenant, different-Organization: the client's own tenant boundary
    alone is not enough. admin@example.com belongs to organization
    51000000-0000-4000-8000-000000000001; a Participation that lives under a
    second organization in that SAME tenant must never appear in the search,
    even though require_event_in_tenant's own tenant-only join would allow it.
    """
    headers = login(client)
    database: Database = client.app.state.database
    other_org = str(uuid4())
    other_event = str(uuid4())
    suffix = f"otherorg-{uuid4().hex[:8]}"
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO organizations
                (id,tenant_id,code,name,active,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001',:code,
                        'Другая организация того же tenant',true,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": other_org, "code": f"org-{uuid4().hex[:8]}"},
        )
        connection.execute(
            text(
                """INSERT INTO events
                (id,organization_id,title,slug,start_at,end_at,timezone,location,
                 registration_deadline,capacity,status,created_by,created_at,updated_at)
                VALUES (:id,:organization,'Мероприятие чужой организации',:slug,
                        '2026-08-03T10:00:00','2026-08-03T12:00:00','Europe/Moscow',
                        'КАИТ №20','2026-08-02T10:00:00',20,'DRAFT',
                        (SELECT id FROM staff_users LIMIT 1),
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": other_event,
                "organization": other_org,
                "slug": f"other-org-event-{uuid4().hex[:8]}",
            },
        )
    create_registration(database, other_event, suffix=suffix)

    response = client.get(
        "/admin/activity/participations",
        headers=headers,
        params={"query": f"Участник {suffix}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def create_cross_scope(database: Database) -> dict[str, str]:
    """Tenant A / Organization A1 (the seeded default, used by login()) /
    Organization A2 (same Tenant), plus Tenant B / Organization B1 (a
    different Tenant) - the two isolation classes the security gate needs to
    prove: same-Tenant/different-Organization, and a different Tenant
    entirely.
    """
    tenant_a = "50000000-0000-4000-8000-000000000001"
    organization_a1 = "51000000-0000-4000-8000-000000000001"
    organization_a2 = str(uuid4())
    tenant_b = str(uuid4())
    organization_b1 = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO organizations (id,tenant_id,code,name,active,created_at,updated_at)
                VALUES (:id,:tenant,:code,'Another organization, same tenant',true,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": organization_a2,
                "tenant": tenant_a,
                "code": f"org-{uuid4().hex[:8]}",
            },
        )
        connection.execute(
            text(
                """INSERT INTO tenants (id,code,name,active,created_at,updated_at)
                VALUES (:id,:code,'Another tenant',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": tenant_b, "code": f"tenant-{uuid4().hex[:8]}"},
        )
        connection.execute(
            text(
                """INSERT INTO organizations (id,tenant_id,code,name,active,created_at,updated_at)
                VALUES (:id,:tenant,:code,'Organization of another tenant',true,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": organization_b1,
                "tenant": tenant_b,
                "code": f"org-{uuid4().hex[:8]}",
            },
        )
    return {
        "tenant_a": tenant_a,
        "organization_a1": organization_a1,
        "organization_a2": organization_a2,
        "tenant_b": tenant_b,
        "organization_b1": organization_b1,
    }


def login_as_scope(
    database: Database,
    client: TestClient,
    tenant_id: str,
    organization_id: str,
    role: str = "SUPER_ADMIN",
) -> dict[str, str]:
    staff_id = str(uuid4())
    email = f"boundary-{staff_id[:12]}@example.com"
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO staff_users
                (id,tenant_id,organization_id,email,email_normalized,password_hash,system_role,
                 active,password_changed_at,created_at,updated_at)
                VALUES (:id,:tenant,:organization,:email,:email,:password,:role,true,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": staff_id,
                "tenant": tenant_id,
                "organization": organization_id,
                "email": email,
                "password": hash_password("boundary gate password"),
                "role": role,
            },
        )
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": email, "password": "boundary gate password"},
    )
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def test_participation_and_manual_adjustment_reject_other_organization(
    client: TestClient,
) -> None:
    """N03: Participation lifecycle mutations and manual score adjustment
    must resolve their Event/Season only within the caller's own Tenant AND
    Organization. Proves denial happens before any ledger mutation - no new
    score_transactions row, no participation status change.
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)

    event_id, _ = create_event(client, headers, title="Boundary participation event")
    registration_id, person_id = create_registration_for_person(
        database, event_id, "boundary-participation"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{event_id}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": role["id"],
            "reason": "Owner-assigned baseline",
        },
    )
    assert assigned.status_code == 200, assigned.text
    participation_id = assigned.json()["participationIds"][0]

    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"BOUNDARY_{uuid4().hex[:8].upper()}",
            "name": "Boundary season",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]

    with database.connect() as connection:
        awards_before = connection.execute(
            text("SELECT COUNT(*) FROM score_transactions WHERE participation_id=:id"),
            {"id": participation_id},
        ).scalar_one()
        status_before = connection.execute(
            text("SELECT status FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
        manual_before = connection.execute(
            text(
                "SELECT COUNT(*) FROM score_transactions WHERE person_id=:person AND season_id=:season"
            ),
            {"person": person_id, "season": season_id},
        ).scalar_one()

    for label, tenant_id, organization_id in (
        (
            "same tenant, other organization",
            scope["tenant_a"],
            scope["organization_a2"],
        ),
        ("other tenant entirely", scope["tenant_b"], scope["organization_b1"]),
    ):
        foreign_headers = login_as_scope(database, client, tenant_id, organization_id)

        assert (
            client.post(
                f"/admin/events/{event_id}/participations/assign",
                headers=foreign_headers,
                json={
                    "registrationIds": [registration_id],
                    "roleId": role["id"],
                    "reason": "Cross-organization reassignment attempt",
                },
            ).status_code
            == 404
        ), f"assign leaked across {label}"
        assert (
            client.post(
                f"/admin/events/{event_id}/participations/confirm",
                headers=foreign_headers,
                json={
                    "registrationIds": [registration_id],
                    "roleId": role["id"],
                    "confirmWithoutAttendance": True,
                    "overrideReason": "Cross-organization confirm attempt",
                },
            ).status_code
            == 404
        ), f"confirm leaked across {label}"
        assert (
            client.patch(
                f"/admin/events/{event_id}/participations/{participation_id}",
                headers=foreign_headers,
                json={
                    "roleId": role["id"],
                    "reason": "Cross-organization patch attempt",
                },
            ).status_code
            == 404
        ), f"patch leaked across {label}"
        assert (
            client.post(
                f"/admin/events/{event_id}/participations/cancel",
                headers=foreign_headers,
                json={
                    "participationIds": [participation_id],
                    "reason": "Cross-organization cancel attempt",
                },
            ).status_code
            == 404
        ), f"cancel leaked across {label}"

        manual = client.post(
            "/admin/activity/score-adjustments",
            headers=foreign_headers,
            json={
                "requestId": str(uuid4()),
                "personId": person_id,
                "seasonId": season_id,
                "points": 5,
                "reason": "Cross-organization manual adjustment attempt",
            },
        )
        assert manual.status_code in (400, 404), (
            f"manual adjustment leaked across {label}"
        )

    with database.connect() as connection:
        awards_after = connection.execute(
            text("SELECT COUNT(*) FROM score_transactions WHERE participation_id=:id"),
            {"id": participation_id},
        ).scalar_one()
        status_after = connection.execute(
            text("SELECT status FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
        manual_after = connection.execute(
            text(
                "SELECT COUNT(*) FROM score_transactions WHERE person_id=:person AND season_id=:season"
            ),
            {"person": person_id, "season": season_id},
        ).scalar_one()
    assert awards_after == awards_before, "denied confirm must not award a score"
    assert status_after == status_before, (
        "denied mutation must not change participation status"
    )
    assert manual_after == manual_before, (
        "denied manual adjustment must not write a score"
    )

    # Happy path: the owning Organization's own admin is unaffected.
    headers = login(client)
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": role["id"],
            "confirmWithoutAttendance": True,
            "overrideReason": "Owner confirms after boundary attempts",
        },
    )
    assert confirmed.status_code == 200, confirmed.text


def test_achievement_mutations_enforce_tenant_boundary_not_organization(
    client: TestClient,
) -> None:
    """N03: Person (and therefore Achievement, which is Person-anchored) is
    Tenant-canonical by design (see MOSACTIVE-STAGE1.md) - there is no
    Organization column on persons/achievements/student_profiles/
    person_status_assignments to scope by. The correct and complete boundary
    here is Tenant, already enforced by require_person_in_tenant. This test
    proves both halves: a different Tenant is correctly denied, while a
    same-Tenant/different-Organization admin - having no narrower boundary to
    check against in this domain - is not artificially blocked.
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)

    event_id, _ = create_event(client, headers, title="Boundary achievement event")
    _, person_id = create_registration_for_person(
        database, event_id, "boundary-achievement"
    )
    created = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Boundary achievement",
            "achievementType": "CERTIFICATE",
            "source": "MANUAL",
            "occurredAt": "2026-10-01T10:00:00Z",
        },
    )
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]

    same_tenant_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    same_tenant_decision = client.patch(
        f"/admin/people/{person_id}/achievements/{achievement_id}",
        headers=same_tenant_headers,
        json={"status": "VERIFIED", "reason": "Same-tenant decision"},
    )
    assert same_tenant_decision.status_code == 200, same_tenant_decision.text

    other_tenant_headers = login_as_scope(
        database, client, scope["tenant_b"], scope["organization_b1"]
    )
    other_tenant_decision = client.patch(
        f"/admin/people/{person_id}/achievements/{achievement_id}",
        headers=other_tenant_headers,
        json={"status": "REJECTED", "reason": "Other-tenant decision attempt"},
    )
    assert other_tenant_decision.status_code == 404, other_tenant_decision.text
    with database.connect() as connection:
        status = connection.execute(
            text("SELECT status FROM achievements WHERE id=:id"),
            {"id": achievement_id},
        ).scalar_one()
    assert status == "VERIFIED", (
        "the other-tenant attempt must not have changed anything"
    )

    # The Event cross-reference on create IS organization-scoped (Event
    # belongs to Organization, unlike Person) - a same-tenant/different
    # Organization admin cannot claim an achievement happened at an Event
    # that isn't theirs. The other_tenant_headers login above moved the
    # client's session cookie away from the same-tenant staff; log back in
    # as that staff before reusing its (session-cookie-authenticated) access.
    same_tenant_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    mismatched_event = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=same_tenant_headers,
        json={
            "personId": person_id,
            "title": "Cross-organization event reference",
            "achievementType": "CERTIFICATE",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
            "eventId": event_id,
        },
    )
    assert mismatched_event.status_code == 400, mismatched_event.text


def test_person_achievements_are_listed_readably(client: TestClient) -> None:
    """Stage 4.3: the person_activity dossier's achievements array is
    minimally extended (source, event title, participation role/result) so
    the admin list never has only a raw Event/Participation UUID to show -
    covers create of all three link shapes (manual, Event-linked,
    participation-linked) and proves the extended fields round-trip.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Achievement list event")
    registration_id, person_id = create_registration_for_person(
        database, event_id, "achievement-list"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{event_id}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": role["id"],
            "reason": "Achievement list readability fixture",
        },
    )
    assert assigned.status_code == 200, assigned.text
    participation_id = assigned.json()["participationIds"][0]

    manual = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Manual achievement",
            "achievementType": "CERTIFICATE",
            "source": "MANUAL",
            "occurredAt": "2026-10-01T10:00:00Z",
        },
    )
    assert manual.status_code == 201, manual.text
    event_linked = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Event-linked achievement",
            "achievementType": "MEDAL",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
            "eventId": event_id,
        },
    )
    assert event_linked.status_code == 201, event_linked.text
    participation_linked = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Participation-linked achievement",
            "achievementType": "DIPLOMA",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
            "eventId": event_id,
            "participationId": participation_id,
        },
    )
    assert participation_linked.status_code == 201, participation_linked.text

    activity = client.get(f"/admin/people/{person_id}/activity", headers=headers)
    assert activity.status_code == 200, activity.text
    items = {item["title"]: item for item in activity.json()["achievements"]}

    manual_item = items["Manual achievement"]
    assert manual_item["source"] == "MANUAL"
    assert manual_item["eventId"] is None
    assert manual_item["eventTitle"] is None
    assert manual_item["participationId"] is None
    assert manual_item["participationRole"] is None

    event_item = items["Event-linked achievement"]
    assert event_item["eventId"] == event_id
    assert event_item["eventTitle"] == "Achievement list event"
    assert event_item["participationId"] is None

    participation_item = items["Participation-linked achievement"]
    assert participation_item["eventTitle"] == "Achievement list event"
    assert participation_item["participationId"] == participation_id
    assert participation_item["participationRole"] == {
        "code": "PARTICIPANT",
        "name": role["name"],
    }


def test_achievement_mutations_require_super_admin(client: TestClient) -> None:
    """Stage 4.3: create/decide are csrf_super_admin (same convention as
    Membership lifecycle); the read (person_activity, which carries the
    achievements list) stays at the lower `administrator` bar. An ORGANIZER
    can read but not mutate.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Achievement authz event")
    _, person_id = create_registration_for_person(
        database, event_id, "achievement-authz"
    )
    scope = create_cross_scope(database)
    organizer_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a1"], role="ORGANIZER"
    )

    readable = client.get(
        f"/admin/people/{person_id}/activity", headers=organizer_headers
    )
    assert readable.status_code == 200, readable.text

    denied_create = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=organizer_headers,
        json={
            "personId": person_id,
            "title": "Should be denied",
            "achievementType": "CERTIFICATE",
            "source": "MANUAL",
            "occurredAt": "2026-10-01T10:00:00Z",
        },
    )
    assert denied_create.status_code == 403, denied_create.text

    # login_as_scope() above moved the client's session cookie to the
    # ORGANIZER staff; log back in as the original owner before reusing its
    # (session-cookie-authenticated) CSRF token.
    headers = login(client)
    created = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Owner-created achievement",
            "achievementType": "CERTIFICATE",
            "source": "MANUAL",
            "occurredAt": "2026-10-01T10:00:00Z",
        },
    )
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]

    # Same session-cookie lesson as above: get a fresh ORGANIZER session
    # (the earlier one's cookie was replaced by the owner re-login).
    organizer_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a1"], role="ORGANIZER"
    )
    denied_decision = client.patch(
        f"/admin/people/{person_id}/achievements/{achievement_id}",
        headers=organizer_headers,
        json={"status": "VERIFIED", "reason": "Should be denied"},
    )
    assert denied_decision.status_code == 403, denied_decision.text
    with database.connect() as connection:
        status = connection.execute(
            text("SELECT status FROM achievements WHERE id=:id"),
            {"id": achievement_id},
        ).scalar_one()
    assert status == "PENDING", "a denied decision must not change status"


def test_achievement_decision_allows_repeated_transition_per_current_domain(
    client: TestClient,
) -> None:
    """Stage 4.3: decide_achievement has no status-machine guard today (any
    existing row can be re-decided to any of VERIFIED/REJECTED/CANCELLED,
    regardless of its current status) - documenting this actual behavior
    rather than inventing a new restriction the backend doesn't have. The
    admin UI itself only offers decision controls while status is PENDING,
    but that is a frontend choice, not a backend rule.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Achievement redecision event")
    _, person_id = create_registration_for_person(
        database, event_id, "achievement-redecision"
    )
    created = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Redecided achievement",
            "achievementType": "CERTIFICATE",
            "source": "MANUAL",
            "occurredAt": "2026-10-01T10:00:00Z",
        },
    )
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]

    first = client.patch(
        f"/admin/people/{person_id}/achievements/{achievement_id}",
        headers=headers,
        json={"status": "VERIFIED", "reason": "Initial decision"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "VERIFIED"

    second = client.patch(
        f"/admin/people/{person_id}/achievements/{achievement_id}",
        headers=headers,
        json={"status": "REJECTED", "reason": "Reconsidered decision"},
    )
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "REJECTED"

    with database.connect() as connection:
        final_status = connection.execute(
            text("SELECT status FROM achievements WHERE id=:id"),
            {"id": achievement_id},
        ).scalar_one()
        decision_audit_count = connection.execute(
            text(
                """SELECT COUNT(*) FROM audit_log
                WHERE entity_id=:id AND action IN ('ACHIEVEMENT_VERIFIED','ACHIEVEMENT_UPDATED')"""
            ),
            {"id": achievement_id},
        ).scalar_one()
    assert final_status == "REJECTED"
    assert decision_audit_count == 2, "each decision must be independently audited"


def test_participation_search_is_scoped_to_the_personid_filter(
    client: TestClient,
) -> None:
    """Stage 4.3 correction: the Achievement admin's Participation picker
    must use `personId` as a server-side filter on the existing, already
    Organization+Tenant-scoped search - not a client-side filter over a
    page of results that could miss this Person's own Participation
    entirely. Also proves the `query` text search now matches Event title,
    which it did not before this correction.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Олимпиада по информатике")
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    registration_a, person_a = create_registration_for_person(
        database, event_id, "search-scope-a"
    )
    registration_b, person_b = create_registration_for_person(
        database, event_id, "search-scope-b"
    )
    assigned = client.post(
        f"/admin/events/{event_id}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_a, registration_b],
            "roleId": role["id"],
            "reason": "Participation search scope fixture",
        },
    )
    assert assigned.status_code == 200, assigned.text

    scoped = client.get(
        f"/admin/activity/participations?personId={person_a}&query=Олимпиада",
        headers=headers,
    )
    assert scoped.status_code == 200, scoped.text
    items = scoped.json()["items"]
    assert len(items) == 1
    assert items[0]["personId"] == person_a
    assert all(item["personId"] != person_b for item in items)


def test_achievement_participation_link_persists_canonical_event_id(
    client: TestClient,
) -> None:
    """Stage 4.3 correction: when participation_id is given, the persisted
    Achievement must always store the Participation's OWN event_id - never
    a client-supplied one that happened to be omitted or stale. The Person
    dossier must then show that Event's title for the caller's own
    Organization.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(
        client, headers, title="Canonical event id fixture event"
    )
    registration_id, person_id = create_registration_for_person(
        database, event_id, "canonical-event-id"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{event_id}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": role["id"],
            "reason": "Canonical event id fixture",
        },
    )
    assert assigned.status_code == 200, assigned.text
    participation_id = assigned.json()["participationIds"][0]

    created = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Participation-linked, no explicit eventId",
            "achievementType": "MEDAL",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
            "participationId": participation_id,
        },
    )
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]

    with database.connect() as connection:
        persisted_event_id = connection.execute(
            text("SELECT event_id FROM achievements WHERE id=:id"),
            {"id": achievement_id},
        ).scalar_one()
    assert persisted_event_id == event_id

    activity = client.get(f"/admin/people/{person_id}/activity", headers=headers)
    assert activity.status_code == 200, activity.text
    item = next(i for i in activity.json()["achievements"] if i["id"] == achievement_id)
    assert item["eventTitle"] == "Canonical event id fixture event"


def test_achievement_participation_event_mismatch_rejected(
    client: TestClient,
) -> None:
    """Stage 4.3 correction: a Participation that belongs to a DIFFERENT
    Event than the one explicitly requested must still be rejected -
    the correction makes the Participation's event_id canonical, but a
    client that names a conflicting eventId is still lying about the
    activity, not merely omitting a field.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_a, _ = create_event(client, headers, title="Mismatch event A")
    event_b, _ = create_event(client, headers, title="Mismatch event B")
    registration_id, person_id = create_registration_for_person(
        database, event_a, "event-mismatch"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{event_a}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": role["id"],
            "reason": "Event mismatch fixture",
        },
    )
    assert assigned.status_code == 200, assigned.text
    participation_id = assigned.json()["participationIds"][0]

    rejected = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Should be rejected",
            "achievementType": "MEDAL",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
            "participationId": participation_id,
            "eventId": event_b,
        },
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["error"]["code"] == "ACHIEVEMENT_REFERENCE_MISMATCH"
    with database.connect() as connection:
        total = connection.execute(
            text("SELECT COUNT(*) FROM achievements WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
    assert total == 0, "a rejected creation must not insert anything"


def test_achievement_creation_rejects_foreign_organization_participation(
    client: TestClient,
) -> None:
    """Stage 4.3 correction: Participation is not proven trustworthy merely
    by `participation.person_id == person_id` - it must also be proven to
    belong to the caller's own Organization, since Event (and therefore
    Participation) is Organization-owned, unlike Person. A same-Tenant,
    different-Organization Participation must be rejected before INSERT.
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)
    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    foreign_event, _ = create_event(
        client, foreign_headers, title="Foreign organization event"
    )
    foreign_registration, person_id = create_registration_for_person(
        database, foreign_event, "foreign-org-participation"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{foreign_event}/participations/assign",
        headers=foreign_headers,
        json={
            "registrationIds": [foreign_registration],
            "roleId": role["id"],
            "reason": "Foreign organization participation fixture",
        },
    )
    assert assigned.status_code == 200, assigned.text
    foreign_participation_id = assigned.json()["participationIds"][0]

    # login_as_scope() above moved the client's session cookie away from the
    # original owner staff; log back in before reusing `headers`.
    headers = login(client)
    rejected = client.post(
        f"/admin/people/{person_id}/achievements",
        headers=headers,
        json={
            "personId": person_id,
            "title": "Should be rejected",
            "achievementType": "MEDAL",
            "source": "EVENT_KAIT20",
            "occurredAt": "2026-10-01T10:00:00Z",
            "participationId": foreign_participation_id,
        },
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["error"]["code"] == "ACHIEVEMENT_REFERENCE_MISMATCH"
    with database.connect() as connection:
        total = connection.execute(
            text("SELECT COUNT(*) FROM achievements WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
    assert total == 0, "a rejected cross-organization creation must not insert anything"


def test_person_dossier_redacts_foreign_organization_achievement_context(
    client: TestClient,
) -> None:
    """Stage 4.3 correction: Person/Achievement identity is Tenant-canonical
    (readable Tenant-wide, per the accepted model), but the READABLE
    CONTEXT (Event title/date, Participation role/result) is Organization-
    owned and must be redacted for a staff outside that Organization - even
    though the Achievement row itself stays visible. Fixture is inserted
    directly (creation itself is now rejected per the cross-organization
    test above, so this proves the READ side against legacy-shaped data).
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)
    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    foreign_event, _ = create_event(
        client, foreign_headers, title="Redaction fixture event"
    )
    foreign_registration, person_id = create_registration_for_person(
        database, foreign_event, "redaction-fixture"
    )
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    assigned = client.post(
        f"/admin/events/{foreign_event}/participations/assign",
        headers=foreign_headers,
        json={
            "registrationIds": [foreign_registration],
            "roleId": role["id"],
            "reason": "Redaction fixture",
        },
    )
    assert assigned.status_code == 200, assigned.text
    foreign_participation_id = assigned.json()["participationIds"][0]

    achievement_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO achievements
                (id,person_id,event_id,participation_id,title,achievement_type,
                 source,status,occurred_at,created_at,updated_at)
                VALUES (:id,:person,:event,:participation,'Foreign context fixture',
                        'MEDAL','EVENT_KAIT20','PENDING','2026-10-01 10:00:00',
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": achievement_id,
                "person": person_id,
                "event": foreign_event,
                "participation": foreign_participation_id,
            },
        )

    # login_as_scope() above moved the client's session cookie away from the
    # original owner staff; log back in before reusing `headers`.
    headers = login(client)
    own_org_view = client.get(f"/admin/people/{person_id}/activity", headers=headers)
    assert own_org_view.status_code == 200, own_org_view.text
    redacted = next(
        i for i in own_org_view.json()["achievements"] if i["id"] == achievement_id
    )
    assert redacted["eventId"] == foreign_event, (
        "the raw id stays part of the already-accepted dossier"
    )
    assert redacted["eventTitle"] is None
    assert redacted["eventStartAt"] is None
    assert redacted["participationRole"] is None
    assert redacted["participationResult"] is None

    # Same session-cookie lesson: get a fresh session as the foreign staff
    # (the earlier one's cookie was replaced by the owner re-login above).
    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    foreign_org_view = client.get(
        f"/admin/people/{person_id}/activity", headers=foreign_headers
    )
    assert foreign_org_view.status_code == 200, foreign_org_view.text
    readable = next(
        i for i in foreign_org_view.json()["achievements"] if i["id"] == achievement_id
    )
    assert readable["eventTitle"] == "Redaction fixture event"
    assert readable["participationRole"] == {
        "code": "PARTICIPANT",
        "name": role["name"],
    }


def test_season_and_scoring_rule_assignment_reject_other_organization(
    client: TestClient,
) -> None:
    """N04: Season is Organization-owned (unlike the other four reference
    dictionaries reference() serves, which are tenant-global by design).
    Event season assignment and scoring rule create/list must not let one
    Organization see or attach to another Organization's Season, even inside
    the same Tenant.
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)

    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"OWNER_{uuid4().hex[:8].upper()}",
            "name": "Owner-only season",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    season_id = season.json()["id"]
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )

    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )

    foreign_event = client.post(
        "/admin/events",
        headers=foreign_headers,
        json={
            "title": "Foreign organization event",
            "slug": f"foreign-season-{uuid4().hex[:8]}",
            "location": "Elsewhere",
            "startAt": "2027-11-01T07:00:00Z",
            "endAt": "2027-11-01T17:00:00Z",
            "registrationDeadline": "2027-10-31T07:00:00Z",
            "capacity": 10,
            "status": "DRAFT",
            "seasonId": season_id,
        },
    )
    assert foreign_event.status_code == 400, foreign_event.text

    foreign_rule = client.post(
        "/admin/activity/scoring-rules",
        headers=foreign_headers,
        json={
            "seasonId": season_id,
            "eventCategoryId": None,
            "eventLevelId": None,
            "participationRoleId": role["id"],
            "participationResultId": None,
            "points": 15,
            "priority": 0,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert foreign_rule.status_code == 400, foreign_rule.text

    # login_as_scope replaced the client's session cookie; log back in as the
    # owner before using its (now stale) CSRF token again.
    headers = login(client)
    owner_rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season_id,
            "eventCategoryId": None,
            "eventLevelId": None,
            "participationRoleId": role["id"],
            "participationResultId": None,
            "points": 15,
            "priority": 0,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert owner_rule.status_code == 201, owner_rule.text

    # login_as_scope's own login re-pointed the client's session cookie back
    # to the owner when creating owner_rule above; log back in as the same
    # foreign Organization before using its session-cookie-authenticated GET.
    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    foreign_list = client.get("/admin/activity/scoring-rules", headers=foreign_headers)
    assert foreign_list.status_code == 200, foreign_list.text
    assert owner_rule.json()["id"] not in {
        item["id"] for item in foreign_list.json()["items"]
    }, "an unfiltered rule list must not leak another organization's rules"

    foreign_update = client.patch(
        f"/admin/activity/scoring-rules/{owner_rule.json()['id']}",
        headers=foreign_headers,
        json={
            "seasonId": season_id,
            "eventCategoryId": None,
            "eventLevelId": None,
            "participationRoleId": role["id"],
            "participationResultId": None,
            "points": 20,
            "priority": 0,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert foreign_update.status_code == 404, foreign_update.text

    foreign_deactivate = client.delete(
        f"/admin/activity/scoring-rules/{owner_rule.json()['id']}",
        headers=foreign_headers,
    )
    assert foreign_deactivate.status_code == 404, foreign_deactivate.text
    with database.connect() as connection:
        active = connection.execute(
            text("SELECT active FROM scoring_rules WHERE id=:id"),
            {"id": owner_rule.json()["id"]},
        ).scalar_one()
    assert bool(active) is True, (
        "a denied cross-organization deactivate must not persist"
    )


def test_admin_profile_get_has_no_side_effect(client: TestClient) -> None:
    """N05: GET must stay a safe method. Before this fix, get_profile_admin
    unconditionally upserted a student_profiles row on every call.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Profile GET safety")
    _, person_id = create_registration_for_person(database, event_id, "profile-get")

    def profile_row_exists() -> bool:
        with database.connect() as connection:
            return (
                connection.execute(
                    text(
                        "SELECT COUNT(*) FROM student_profiles WHERE person_id=:person"
                    ),
                    {"person": person_id},
                ).scalar_one()
                > 0
            )

    assert not profile_row_exists()
    first = client.get(f"/admin/people/{person_id}/profile", headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["visibility"] == "PRIVATE"
    assert first.json()["id"] is None
    assert not profile_row_exists(), "GET must not create a StudentProfile row"

    second = client.get(f"/admin/people/{person_id}/profile", headers=headers)
    assert second.status_code == 200, second.text
    assert not profile_row_exists()

    updated = client.patch(
        f"/admin/people/{person_id}/profile",
        headers=headers,
        json={"visibility": "PRIVATE"},
    )
    assert updated.status_code == 200, updated.text
    assert profile_row_exists(), "the mutating endpoint must still create the row"


def test_membership_boundary_adjacent_transfer_valid_same_day_overlap_rejected(
    client: TestClient,
) -> None:
    """N18: student_memberships uses an inclusive [valid_from, valid_to]
    interval (both bounds inclusive) at the SQL level. This proves the exact
    boundary rule a future transfer must respect: ending the old period the
    day BEFORE the new one starts is valid (no overlap), while ending it on
    the SAME day the new one starts is rejected as an overlap - the two
    scenarios TODO1 N18 calls out as A and B.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Membership boundary event")
    group_a = create_study_group(client, headers, "BOUNDARY_A", "BOUNDARY_DEPT_A", 1)
    group_b = create_study_group(client, headers, "BOUNDARY_B", "BOUNDARY_DEPT_B", 2)

    # A. Old ends 2026-09-30, new starts 2026-10-01 (adjacent, D-1) -> valid.
    _, valid_person = create_registration_for_person(
        database, event_id, "boundary-valid"
    )
    old_valid = client.post(
        f"/admin/people/{valid_person}/memberships",
        headers=headers,
        json={
            "studyGroupId": group_a,
            "validFrom": "2026-09-01",
            "validTo": "2026-09-30",
        },
    )
    assert old_valid.status_code == 201, old_valid.text
    new_valid = client.post(
        f"/admin/people/{valid_person}/memberships",
        headers=headers,
        json={"studyGroupId": group_b, "validFrom": "2026-10-01", "validTo": None},
    )
    assert new_valid.status_code == 201, new_valid.text

    # B. Old ends 2026-10-01, new starts 2026-10-01 (same day) -> overlap.
    _, overlap_person = create_registration_for_person(
        database, event_id, "boundary-overlap"
    )
    old_overlap = client.post(
        f"/admin/people/{overlap_person}/memberships",
        headers=headers,
        json={
            "studyGroupId": group_a,
            "validFrom": "2026-09-01",
            "validTo": "2026-10-01",
        },
    )
    assert old_overlap.status_code == 201, old_overlap.text
    new_overlap = client.post(
        f"/admin/people/{overlap_person}/memberships",
        headers=headers,
        json={"studyGroupId": group_b, "validFrom": "2026-10-01", "validTo": None},
    )
    assert new_overlap.status_code == 409, new_overlap.text
    assert new_overlap.json()["error"]["code"] == "MEMBERSHIP_PERIOD_OVERLAP"


def test_membership_boundary_resolves_exactly_one_membership_at_transfer_date(
    client: TestClient,
) -> None:
    """N18, scenarios C and D: an Event on the old period's last valid day
    resolves to the old membership; an Event the day after (the new period's
    first valid day) resolves to the new one. Exactly one row must match on
    each side of the boundary - never zero, never two.
    """
    headers = login(client)
    database: Database = client.app.state.database
    group_old = create_study_group(client, headers, "TRANSFER_OLD", "TRANSFER_DEPT", 3)
    group_new = create_study_group(client, headers, "TRANSFER_NEW", "TRANSFER_DEPT", 3)
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"TRANSFER_{uuid4().hex[:8].upper()}",
            "name": "Transfer boundary season",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season.json()["id"],
            "participationRoleId": role["id"],
            "points": 5,
            "priority": 401,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert rule.status_code == 201, rule.text
    before_event, _ = create_event(
        client,
        headers,
        title="Transfer boundary before",
        start_at="2026-09-30T10:00:00Z",
        end_at="2026-09-30T11:00:00Z",
        season_id=season.json()["id"],
    )
    after_event, _ = create_event(
        client,
        headers,
        title="Transfer boundary after",
        start_at="2026-10-01T10:00:00Z",
        end_at="2026-10-01T11:00:00Z",
        season_id=season.json()["id"],
    )
    before_registration, person_id = create_registration_for_person(
        database, before_event, "transfer-boundary"
    )
    after_registration, _ = create_registration_for_person(
        database, after_event, "transfer-boundary", person_id
    )
    old_membership = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={
            "studyGroupId": group_old,
            "validFrom": "2026-09-01",
            "validTo": "2026-09-30",
        },
    )
    assert old_membership.status_code == 201, old_membership.text
    new_membership = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_new, "validFrom": "2026-10-01", "validTo": None},
    )
    assert new_membership.status_code == 201, new_membership.text
    for event_id, registration_id in (
        (before_event, before_registration),
        (after_event, after_registration),
    ):
        confirmed = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={"registrationIds": [registration_id], "roleId": role["id"]},
        )
        assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        attributed = connection.execute(
            text("""SELECT e.title,st.membership_id FROM score_transactions st
            JOIN participations p ON p.id=st.participation_id
            JOIN events e ON e.id=p.event_id
            WHERE st.person_id=:person AND st.transaction_type='AWARD'
            ORDER BY e.start_at"""),
            {"person": person_id},
        ).all()
    assert [row[1] for row in attributed] == [
        old_membership.json()["id"],
        new_membership.json()["id"],
    ]


def test_concurrent_membership_creation_cannot_create_overlap(
    client: TestClient,
) -> None:
    """N18: create_membership()'s first statement locks the Person row FOR
    UPDATE before the overlap check runs, so two concurrent attempts for the
    same Person must serialize - never both succeed with overlapping
    periods. Proven with a genuinely overlapping pair of periods: exactly one
    must be accepted and the other rejected, regardless of scheduling.
    """
    from event_api.main import create_app

    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Membership race event")
    _, person_id = create_registration_for_person(database, event_id, "membership-race")
    group_a = create_study_group(client, headers, "RACE_A", "RACE_DEPT_A", 1)
    group_b = create_study_group(client, headers, "RACE_B", "RACE_DEPT_B", 2)
    barrier = threading.Barrier(2)

    with ExitStack() as stack:
        staff_clients = [
            stack.enter_context(TestClient(create_app(client.app.state.settings)))
            for _ in range(2)
        ]
        race_headers = [login(staff_client) for staff_client in staff_clients]
        payloads = (
            {
                "studyGroupId": group_a,
                "validFrom": "2026-09-01",
                "validTo": "2026-09-30",
            },
            {
                "studyGroupId": group_b,
                "validFrom": "2026-09-15",
                "validTo": "2026-10-15",
            },
        )

        def attempt(index: int) -> int:
            barrier.wait(timeout=10)
            return (
                staff_clients[index]
                .post(
                    f"/admin/people/{person_id}/memberships",
                    headers=race_headers[index],
                    json=payloads[index],
                )
                .status_code
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(attempt, range(2)))

    assert sorted(statuses) == [201, 409], statuses
    with database.connect() as connection:
        total = connection.execute(
            text("SELECT COUNT(*) FROM student_memberships WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
    assert total == 1, "the rejected racer must not have inserted a row"


def test_ambiguous_legacy_membership_blocks_award_and_is_audited(
    client: TestClient,
) -> None:
    """N18: the application-level overlap check makes new writes incapable
    of creating an ambiguous membership window, but pre-existing/legacy data
    could still contain one (this is not fixed here - see CLAUDE_REVIEW.md's
    reconciliation note). This proves the existing, unmodified safety net:
    when membership_for_activity() finds more than one matching row, it
    leaves score_transactions.membership_id NULL and audits
    SCORE_MEMBERSHIP_AMBIGUOUS, rather than guessing or silently picking one.
    """
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"AMBIG_{uuid4().hex[:8].upper()}",
            "name": "Ambiguous membership season",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season.json()["id"],
            "participationRoleId": role["id"],
            "points": 5,
            "priority": 402,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert rule.status_code == 201, rule.text
    event_id, _ = create_event(
        client,
        headers,
        title="Ambiguous membership event",
        start_at="2026-06-15T10:00:00Z",
        end_at="2026-06-15T11:00:00Z",
        season_id=season.json()["id"],
    )
    registration_id, person_id = create_registration_for_person(
        database, event_id, "ambiguous-membership"
    )
    group_a = create_study_group(client, headers, "AMBIG_A", "AMBIG_DEPT_A", 1)
    group_b = create_study_group(client, headers, "AMBIG_B", "AMBIG_DEPT_B", 2)
    # Simulates pre-existing/legacy data the application-level overlap check
    # could never itself produce - inserted directly, bypassing the API, the
    # same way an unreconciled historical import might have.
    with database.transaction() as connection:
        for study_group_id in (group_a, group_b):
            group = (
                connection.execute(
                    text(
                        "SELECT organization_id,department_id,course,name FROM study_groups WHERE id=:id"
                    ),
                    {"id": study_group_id},
                )
                .mappings()
                .one()
            )
            connection.execute(
                text(
                    """INSERT INTO student_memberships
                    (id,person_id,organization_id,department_id,study_group_id,course,
                     study_group,department,valid_from,valid_to,created_at,updated_at)
                    VALUES (:id,:person,:organization,:department,:study_group,:course,
                            :study_group_name,'Ambiguous',:valid_from,:valid_to,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": str(uuid4()),
                    "person": person_id,
                    "organization": group["organization_id"],
                    "department": group["department_id"],
                    "study_group": study_group_id,
                    "course": group["course"],
                    "study_group_name": group["name"],
                    "valid_from": "2026-06-01",
                    "valid_to": "2026-06-30",
                },
            )
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={"registrationIds": [registration_id], "roleId": role["id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    participation_id = confirmed.json()["participationIds"][0]
    with database.connect() as connection:
        award = connection.execute(
            text(
                "SELECT membership_id FROM score_transactions WHERE participation_id=:id AND transaction_type='AWARD'"
            ),
            {"id": participation_id},
        ).scalar_one()
        ambiguous_audit = connection.execute(
            text(
                "SELECT COUNT(*) FROM audit_log WHERE action='SCORE_MEMBERSHIP_AMBIGUOUS' AND entity_id=:id"
            ),
            {"id": participation_id},
        ).scalar_one()
    assert award is None, "an ambiguous match must not silently pick one membership"
    assert ambiguous_audit == 1


def _moscow_today() -> date:
    return datetime.now(ZoneInfo("Europe/Moscow")).date()


def test_membership_transfer_closes_old_opens_new_and_scoring_follows_boundary(
    client: TestClient,
) -> None:
    """N19: the required example - Old 2026-09-01..NULL (Group A), transfer to
    Group B effective 2026-10-01. Expected: Old becomes 2026-09-01..2026-09-30,
    New is 2026-10-01..NULL, and confirming a Participation on either side of
    the boundary attributes to the correct membership via the real
    membership_for_activity scoring path (not re-derived in the test).
    """
    headers = login(client)
    database: Database = client.app.state.database
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"XFER_{uuid4().hex[:8].upper()}",
            "name": "Transfer lifecycle season",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2026-12-31T23:59:59Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season.json()["id"],
            "participationRoleId": role["id"],
            "points": 7,
            "priority": 501,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert rule.status_code == 201, rule.text
    before_event, _ = create_event(
        client,
        headers,
        title="Transfer lifecycle before",
        start_at="2026-09-30T10:00:00Z",
        end_at="2026-09-30T11:00:00Z",
        season_id=season.json()["id"],
    )
    after_event, _ = create_event(
        client,
        headers,
        title="Transfer lifecycle after",
        start_at="2026-10-01T10:00:00Z",
        end_at="2026-10-01T11:00:00Z",
        season_id=season.json()["id"],
    )
    before_registration, person_id = create_registration_for_person(
        database, before_event, "xfer-lifecycle"
    )
    after_registration, _ = create_registration_for_person(
        database, after_event, "xfer-lifecycle", person_id
    )
    group_a = create_study_group(client, headers, "XFER_A", "XFER_DEPT", 1)
    group_b = create_study_group(client, headers, "XFER_B", "XFER_DEPT", 1)
    initial = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_a, "validFrom": "2026-09-01", "validTo": None},
    )
    assert initial.status_code == 201, initial.text

    transfer = client.post(
        f"/admin/people/{person_id}/memberships/transfer",
        headers=headers,
        json={"studyGroupId": group_b, "effectiveFrom": "2026-10-01"},
    )
    assert transfer.status_code == 200, transfer.text
    body = transfer.json()
    assert body["previous"]["validFrom"] == "2026-09-01"
    assert body["previous"]["validTo"] == "2026-09-30"
    assert body["current"]["validFrom"] == "2026-10-01"
    assert body["current"]["validTo"] is None
    assert body["current"]["studyGroupId"] == group_b

    for event_id, registration_id in (
        (before_event, before_registration),
        (after_event, after_registration),
    ):
        confirmed = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={"registrationIds": [registration_id], "roleId": role["id"]},
        )
        assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        attributed = connection.execute(
            text("""SELECT e.title,st.membership_id FROM score_transactions st
            JOIN participations p ON p.id=st.participation_id
            JOIN events e ON e.id=p.event_id
            WHERE st.person_id=:person AND st.transaction_type='AWARD'
            ORDER BY e.start_at"""),
            {"person": person_id},
        ).all()
    assert [row[1] for row in attributed] == [
        body["previous"]["id"],
        body["current"]["id"],
    ]


def test_membership_transfer_failure_after_close_rolls_back_both_statements(
    client: TestClient, monkeypatch
) -> None:
    """N19: a failure between closing the old period and inserting the new
    one must roll back the WHOLE transaction, not leave the old membership
    closed with no replacement. No natural DB constraint sits between these
    two statements (both use already-validated, mutually consistent data),
    so this uses a small, targeted monkeypatch on the router's own `execute`
    - not a fault-injection framework - to make only the INSERT fail.
    """
    import event_api.routers.activity as activity_module

    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Transfer rollback event")
    _, person_id = create_registration_for_person(database, event_id, "xfer-rollback")
    group_a = create_study_group(client, headers, "XFER_RB_A", "XFER_RB_DEPT", 1)
    group_b = create_study_group(client, headers, "XFER_RB_B", "XFER_RB_DEPT", 1)
    initial = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_a, "validFrom": "2026-09-01", "validTo": None},
    )
    assert initial.status_code == 201, initial.text
    original_id = initial.json()["id"]

    original_execute = activity_module.execute

    def failing_execute(connection, query, params=None):
        if "INSERT INTO student_memberships" in query:
            raise RuntimeError("simulated failure between close and insert")
        return original_execute(connection, query, params)

    monkeypatch.setattr(activity_module, "execute", failing_execute)
    # TestClient's default raise_server_exceptions=True re-raises an
    # unhandled error into the test even though the app's own generic
    # exception handler still turns it into a 500 for a real client - the
    # point under test is the rollback, not the HTTP framing.
    with pytest.raises(RuntimeError, match="simulated failure"):
        client.post(
            f"/admin/people/{person_id}/memberships/transfer",
            headers=headers,
            json={"studyGroupId": group_b, "effectiveFrom": "2026-10-01"},
        )
    monkeypatch.undo()

    with database.connect() as connection:
        rows = connection.execute(
            text("SELECT id,valid_to FROM student_memberships WHERE person_id=:person"),
            {"person": person_id},
        ).all()
    assert len(rows) == 1, "the failed transfer must not leave a partial state"
    assert rows[0][0] == original_id
    assert rows[0][1] is None, "the old membership must still be open after rollback"


def test_membership_transfer_rejects_cross_organization_study_group(
    client: TestClient,
) -> None:
    """N19: a same-Tenant/different-Organization StudyGroup must be rejected
    the same way create_membership already rejects it - 404, no group name
    disclosed, and the caller's own current membership is left untouched.
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)
    event_id, _ = create_event(client, headers, title="Transfer cross-org event")
    _, person_id = create_registration_for_person(database, event_id, "xfer-cross-org")
    group_a = create_study_group(client, headers, "XFER_XORG_A", "XFER_XORG_DEPT", 1)
    initial = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_a, "validFrom": "2026-09-01", "validTo": None},
    )
    assert initial.status_code == 201, initial.text

    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    foreign_group = create_study_group(
        client, foreign_headers, "XFER_XORG_B", "XFER_XORG_FOREIGN_DEPT", 1
    )

    headers = login(client)
    rejected = client.post(
        f"/admin/people/{person_id}/memberships/transfer",
        headers=headers,
        json={"studyGroupId": foreign_group, "effectiveFrom": "2026-10-01"},
    )
    assert rejected.status_code == 404, rejected.text
    assert rejected.json()["error"]["code"] == "STUDY_GROUP_NOT_FOUND"
    with database.connect() as connection:
        still_open = connection.execute(
            text("SELECT valid_to FROM student_memberships WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
    assert still_open is None


def test_concurrent_membership_transfer_same_effective_date_serializes(
    client: TestClient,
) -> None:
    """N19: two concurrent transfers of the same Person to the same effective
    date must serialize on the Person row lock, never both create a "current"
    membership. Because the second racer freshly re-resolves "current" under
    the lock (rather than working from stale pre-lock data), it sees the
    first racer's brand-new membership as its own source - and since both
    share the same effective date, `effectiveFrom > source.validFrom` fails
    for the second one, a deterministic, real rejection rather than a
    fabricated one.
    """
    from event_api.main import create_app

    owner_headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, owner_headers, title="Transfer race event")
    _, person_id = create_registration_for_person(database, event_id, "xfer-race")
    group_a = create_study_group(
        client, owner_headers, "XFER_RACE_A", "XFER_RACE_DEPT", 1
    )
    group_b = create_study_group(
        client, owner_headers, "XFER_RACE_B", "XFER_RACE_DEPT", 2
    )
    group_c = create_study_group(
        client, owner_headers, "XFER_RACE_C", "XFER_RACE_DEPT", 3
    )
    initial = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=owner_headers,
        json={"studyGroupId": group_a, "validFrom": "2026-09-01", "validTo": None},
    )
    assert initial.status_code == 201, initial.text
    barrier = threading.Barrier(2)

    with ExitStack() as stack:
        staff_clients = [
            stack.enter_context(TestClient(create_app(client.app.state.settings)))
            for _ in range(2)
        ]
        race_headers = [login(staff_client) for staff_client in staff_clients]
        targets = (group_b, group_c)

        def attempt(index: int) -> int:
            barrier.wait(timeout=10)
            return (
                staff_clients[index]
                .post(
                    f"/admin/people/{person_id}/memberships/transfer",
                    headers=race_headers[index],
                    json={
                        "studyGroupId": targets[index],
                        "effectiveFrom": "2026-10-01",
                    },
                )
                .status_code
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(attempt, range(2)))

    assert sorted(statuses) == [200, 400], statuses
    with database.connect() as connection:
        current_count = connection.execute(
            text(
                "SELECT COUNT(*) FROM student_memberships WHERE person_id=:person AND valid_to IS NULL"
            ),
            {"person": person_id},
        ).scalar_one()
        overlap = connection.execute(
            text(
                """SELECT COUNT(*) FROM student_memberships sm1
                JOIN student_memberships sm2 ON sm2.person_id=sm1.person_id AND sm2.id<>sm1.id
                WHERE sm1.person_id=:person
                  AND sm1.valid_from<=COALESCE(sm2.valid_to,DATE('9999-12-31'))
                  AND (sm1.valid_to IS NULL OR sm1.valid_to>=sm2.valid_from)"""
            ),
            {"person": person_id},
        ).scalar_one()
    assert current_count == 1, "exactly one current membership must survive the race"
    assert overlap == 0, "final history must be non-overlapping"


def test_retroactive_membership_transfer_does_not_rewrite_scored_history(
    client: TestClient,
) -> None:
    """N19: retroactively correcting affiliation must never touch an already
    -persisted score_transactions row. The key invariant this gate protects.
    """
    headers = login(client)
    database: Database = client.app.state.database
    today = _moscow_today()
    membership_start = (today - timedelta(days=120)).isoformat()
    event_date = today - timedelta(days=90)
    transfer_effective = (today - timedelta(days=30)).isoformat()
    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"RETRO_{uuid4().hex[:8].upper()}",
            "name": "Retroactive transfer season",
            "startsAt": f"{(today - timedelta(days=365)).isoformat()}T00:00:00Z",
            "endsAt": f"{(today + timedelta(days=365)).isoformat()}T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    role = next(
        item
        for item in client.get("/admin/activity/roles").json()["items"]
        if item["code"] == "PARTICIPANT"
    )
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season.json()["id"],
            "participationRoleId": role["id"],
            "points": 11,
            "priority": 502,
            "active": True,
            "validFrom": None,
            "validTo": None,
        },
    )
    assert rule.status_code == 201, rule.text
    event_id, _ = create_event(
        client,
        headers,
        title="Retroactive transfer scored event",
        start_at=f"{event_date.isoformat()}T10:00:00Z",
        end_at=f"{event_date.isoformat()}T11:00:00Z",
        season_id=season.json()["id"],
    )
    registration_id, person_id = create_registration_for_person(
        database, event_id, "xfer-retro"
    )
    group_a = create_study_group(client, headers, "RETRO_A", "RETRO_DEPT", 1)
    group_b = create_study_group(client, headers, "RETRO_B", "RETRO_DEPT", 2)
    initial = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_a, "validFrom": membership_start, "validTo": None},
    )
    assert initial.status_code == 201, initial.text
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={"registrationIds": [registration_id], "roleId": role["id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    participation_id = confirmed.json()["participationIds"][0]
    with database.connect() as connection:
        before = connection.execute(
            text(
                "SELECT membership_id,points FROM score_transactions WHERE participation_id=:id AND transaction_type='AWARD'"
            ),
            {"id": participation_id},
        ).one()
    assert before[0] is not None

    transfer = client.post(
        f"/admin/people/{person_id}/memberships/transfer",
        headers=headers,
        json={"studyGroupId": group_b, "effectiveFrom": transfer_effective},
    )
    assert transfer.status_code == 200, transfer.text

    with database.connect() as connection:
        after = connection.execute(
            text(
                "SELECT membership_id,points FROM score_transactions WHERE participation_id=:id AND transaction_type='AWARD'"
            ),
            {"id": participation_id},
        ).one()
        transaction_count = connection.execute(
            text("SELECT COUNT(*) FROM score_transactions WHERE participation_id=:id"),
            {"id": participation_id},
        ).scalar_one()
    assert after == before, "retroactive transfer must not rewrite the persisted award"
    assert transaction_count == 1, "no reversal/re-award may be triggered automatically"


def test_membership_transfer_rejects_ambiguous_legacy_history(
    client: TestClient,
) -> None:
    """N19: pre-existing overlapping data (never possible via the API itself,
    per the Data Integrity Gate) must block a transfer outright, never be
    auto-repaired or silently picked from.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Ambiguous transfer event")
    _, person_id = create_registration_for_person(database, event_id, "xfer-ambiguous")
    group_a = create_study_group(client, headers, "AMBIG_XFER_A", "AMBIG_XFER_DEPT", 1)
    group_b = create_study_group(client, headers, "AMBIG_XFER_B", "AMBIG_XFER_DEPT", 2)
    group_c = create_study_group(client, headers, "AMBIG_XFER_C", "AMBIG_XFER_DEPT", 3)
    with database.transaction() as connection:
        for study_group_id in (group_a, group_b):
            group = (
                connection.execute(
                    text(
                        "SELECT organization_id,department_id,course,name FROM study_groups WHERE id=:id"
                    ),
                    {"id": study_group_id},
                )
                .mappings()
                .one()
            )
            connection.execute(
                text(
                    """INSERT INTO student_memberships
                    (id,person_id,organization_id,department_id,study_group_id,course,
                     study_group,department,valid_from,valid_to,created_at,updated_at)
                    VALUES (:id,:person,:organization,:department,:study_group,:course,
                            :study_group_name,'Ambiguous',:valid_from,:valid_to,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": str(uuid4()),
                    "person": person_id,
                    "organization": group["organization_id"],
                    "department": group["department_id"],
                    "study_group": study_group_id,
                    "course": group["course"],
                    "study_group_name": group["name"],
                    "valid_from": "2026-06-01",
                    "valid_to": "2026-06-30",
                },
            )
    rejected = client.post(
        f"/admin/people/{person_id}/memberships/transfer",
        headers=headers,
        json={"studyGroupId": group_c, "effectiveFrom": "2026-10-01"},
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["error"]["code"] == "MEMBERSHIP_PERIOD_OVERLAP"
    with database.connect() as connection:
        total = connection.execute(
            text("SELECT COUNT(*) FROM student_memberships WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
    assert total == 2, "a rejected transfer must not touch the corrupted rows"


def test_membership_close_rejects_ambiguous_legacy_history(
    client: TestClient,
) -> None:
    """N19 correction: close must use the same ambiguity guard as transfer -
    pre-existing overlapping data must block a close outright, never let
    close_membership's own `ORDER BY valid_from DESC,id LIMIT 1` pick and
    mutate one of the conflicting rows. Membership B is deliberately the
    open-ended, most-recent-by-valid_from row - exactly the one the old,
    unguarded close_membership would have selected and closed.
    """
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Ambiguous close event")
    _, person_id = create_registration_for_person(database, event_id, "close-ambiguous")
    group_a = create_study_group(
        client, headers, "AMBIG_CLOSE_A", "AMBIG_CLOSE_DEPT", 1
    )
    group_b = create_study_group(
        client, headers, "AMBIG_CLOSE_B", "AMBIG_CLOSE_DEPT", 2
    )
    periods = {group_a: ("2026-06-01", "2026-07-31"), group_b: ("2026-06-15", None)}
    with database.transaction() as connection:
        for study_group_id, (valid_from, valid_to) in periods.items():
            group = (
                connection.execute(
                    text(
                        "SELECT organization_id,department_id,course,name FROM study_groups WHERE id=:id"
                    ),
                    {"id": study_group_id},
                )
                .mappings()
                .one()
            )
            connection.execute(
                text(
                    """INSERT INTO student_memberships
                    (id,person_id,organization_id,department_id,study_group_id,course,
                     study_group,department,valid_from,valid_to,created_at,updated_at)
                    VALUES (:id,:person,:organization,:department,:study_group,:course,
                            :study_group_name,'Ambiguous',:valid_from,:valid_to,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": str(uuid4()),
                    "person": person_id,
                    "organization": group["organization_id"],
                    "department": group["department_id"],
                    "study_group": study_group_id,
                    "course": group["course"],
                    "study_group_name": group["name"],
                    "valid_from": valid_from,
                    "valid_to": valid_to,
                },
            )
    with database.connect() as connection:
        before = connection.execute(
            text(
                "SELECT id,valid_from,valid_to FROM student_memberships WHERE person_id=:person ORDER BY valid_from"
            ),
            {"person": person_id},
        ).all()
    assert len(before) == 2

    rejected = client.post(
        f"/admin/people/{person_id}/memberships/close",
        headers=headers,
        json={"lastValidOn": "2026-08-31"},
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["error"]["code"] == "MEMBERSHIP_PERIOD_OVERLAP"

    with database.connect() as connection:
        after = connection.execute(
            text(
                "SELECT id,valid_from,valid_to FROM student_memberships WHERE person_id=:person ORDER BY valid_from"
            ),
            {"person": person_id},
        ).all()
        audit_count = connection.execute(
            text(
                """SELECT COUNT(*) FROM audit_log
                WHERE action='STUDENT_MEMBERSHIP_CLOSED' AND entity_id IN (:id_a,:id_b)"""
            ),
            {"id_a": before[0][0], "id_b": before[1][0]},
        ).scalar_one()
    assert after == before, "a rejected close must not mutate either conflicting row"
    assert audit_count == 0, "a rejected close must not create a close audit event"


def test_membership_close_sets_valid_to_and_rejects_second_close(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    event_id, _ = create_event(client, headers, title="Close lifecycle event")
    _, person_id = create_registration_for_person(database, event_id, "close-lifecycle")
    group_a = create_study_group(client, headers, "CLOSE_A", "CLOSE_DEPT", 1)
    initial = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_a, "validFrom": "2026-01-01", "validTo": None},
    )
    assert initial.status_code == 201, initial.text

    closed = client.post(
        f"/admin/people/{person_id}/memberships/close",
        headers=headers,
        json={"lastValidOn": "2026-06-30"},
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["validTo"] == "2026-06-30"

    second_close = client.post(
        f"/admin/people/{person_id}/memberships/close",
        headers=headers,
        json={"lastValidOn": "2026-07-31"},
    )
    assert second_close.status_code == 409, second_close.text
    assert second_close.json()["error"]["code"] == "MEMBERSHIP_ALREADY_CLOSED"
    with database.connect() as connection:
        total = connection.execute(
            text("SELECT COUNT(*) FROM student_memberships WHERE person_id=:person"),
            {"person": person_id},
        ).scalar_one()
    assert total == 1, "close must not create a new membership row"


def test_membership_list_is_scoped_to_the_current_organization(
    client: TestClient,
) -> None:
    """N19's own GET audit: StudentMembership belongs to Organization, so
    Organization A's admin must not see Organization B's membership rows for
    a Person even though Person itself is Tenant-canonical.
    """
    headers = login(client)
    database: Database = client.app.state.database
    scope = create_cross_scope(database)
    event_id, _ = create_event(client, headers, title="Membership scope event")
    _, person_id = create_registration_for_person(
        database, event_id, "membership-scope"
    )
    group_a = create_study_group(client, headers, "SCOPE_A", "SCOPE_DEPT", 1)
    created = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_a, "validFrom": "2026-09-01", "validTo": None},
    )
    assert created.status_code == 201, created.text

    foreign_headers = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a2"]
    )
    foreign_list = client.get(
        f"/admin/people/{person_id}/memberships", headers=foreign_headers
    )
    assert foreign_list.status_code == 200, foreign_list.text
    assert foreign_list.json()["items"] == []

    headers = login(client)
    owner_list = client.get(f"/admin/people/{person_id}/memberships", headers=headers)
    assert len(owner_list.json()["items"]) == 1
