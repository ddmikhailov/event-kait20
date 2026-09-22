from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

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
