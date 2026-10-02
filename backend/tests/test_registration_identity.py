"""Fictional roster validation and non-authoritative staff suggestions."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from publication_fixture import publication_fields
from sqlalchemy import text
from test_activity import create_cross_scope, login, login_as_scope


def seed_student(client, group, *, first="Алексей", middle="Сергеевич Второй"):
    identity = str(uuid4())
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO persons
            (id,tenant_id,last_name,first_name,middle_name,person_type,study_group,
             dedup_review_required,created_at,updated_at)
            VALUES (:id,'50000000-0000-4000-8000-000000000001','Демов',:first,:middle,
                    'KAIT_STUDENT',:group,false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {"id": identity, "group": group, "first": first, "middle": middle},
        )
        connection.execute(
            text("INSERT INTO student_roster_members(person_id) VALUES (:id)"),
            {"id": identity},
        )
    return identity


def setup_event(client):
    headers = login(client)
    now = datetime.now(UTC)
    response = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Проверка данных",
            "slug": f"identity-{uuid4().hex[:12]}",
            "startAt": (now + timedelta(days=2)).isoformat(),
            "endAt": (now + timedelta(days=2, hours=1)).isoformat(),
            "registrationDeadline": (now + timedelta(days=1)).isoformat(),
            "location": "Тест",
            "capacity": 20,
            "status": "REGISTRATION_OPEN",
            **publication_fields(client),
        },
    )
    assert response.status_code == 201, response.text
    return headers, response.json()


def payload(group, **changes):
    return {
        "lastName": "Демов",
        "firstName": "Алексей",
        "middleName": "Сергеевич Второй",
        "studyGroup": group,
        "personType": "KAIT_STUDENT",
        "requestId": str(uuid4()),
        "consentAccepted": True,
        "consentVersion": "test-v1",
        **changes,
    }


def test_public_groups_and_exact_match_preserve_roster(client):
    headers, event = setup_event(client)
    group = f"ГРУППА-{uuid4().hex[:8]}"
    person = seed_student(client, group)
    details = client.get(f"/public/events/{event['slug']}").json()
    assert group in details["studyGroups"]
    assert person not in str(details)
    assert "Сергеевич" not in str(details)
    response = client.post(
        f"/public/events/{event['slug']}/register",
        headers=headers,
        json=payload(
            group.lower(), lastName="  демов  ", middleName="  Сергеевич   Второй "
        ),
    )
    assert response.status_code == 201, response.text
    with client.app.state.database.connect() as connection:
        saved = (
            connection.execute(
                text(
                    "SELECT person_id,last_name,middle_name,study_group,roster_match_state FROM registrations WHERE id=:id"
                ),
                {"id": response.json()["registrationId"]},
            )
            .mappings()
            .one()
        )
        assert saved["person_id"] == person
        assert saved["last_name"] == "демов"
        assert saved["middle_name"] == "Сергеевич Второй"
        assert saved["study_group"] == group
        assert saved["roster_match_state"] == "MATCHED"
        assert (
            connection.execute(
                text("SELECT last_name FROM persons WHERE id=:id"), {"id": person}
            ).scalar_one()
            == "Демов"
        )


def test_unknown_group_requires_explicit_missing_choice(client):
    headers, event = setup_event(client)
    path = f"/public/events/{event['slug']}/register"
    for data in (
        payload("НЕСУЩЕСТВУЮЩАЯ"),
        payload("НЕСУЩЕСТВУЮЩАЯ", studyGroupMissing=True),
        payload(None, personType="PARENT", studyGroupMissing=True),
    ):
        response = client.post(path, headers=headers, json=data)
        assert response.status_code == 400, response.text
        assert response.json()["error"]["code"] == "STUDY_GROUP_INVALID"
    # Missing-group escape also works when the organizer makes group required.
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE events SET form_config=JSON_OBJECT('public',JSON_ARRAY(JSON_OBJECT('key','studyGroup','mode','REQUIRED')),'onsite',JSON_ARRAY()) WHERE id=:id"
            ),
            {"id": event["id"]},
        )
    data = payload(None, studyGroupMissing=True)
    response = client.post(path, headers=headers, json=data)
    assert response.status_code == 201, response.text
    assert client.post(path, headers=headers, json=data).status_code == 200
    with client.app.state.database.connect() as connection:
        saved = (
            connection.execute(
                text(
                    "SELECT study_group,roster_match_state,roster_person_id FROM registrations WHERE id=:id"
                ),
                {"id": response.json()["registrationId"]},
            )
            .mappings()
            .one()
        )
        assert saved["study_group"] is None
        assert saved["roster_person_id"] is None
        assert saved["roster_match_state"] == "UNMATCHED"


def test_typo_suggestions_are_private_and_never_automatically_link(client):
    headers, event = setup_event(client)
    group = f"ПОДБОР-{uuid4().hex[:8]}"
    first = seed_student(client, group)
    second = seed_student(client, group)
    unrelated = seed_student(client, group, first="Василиса", middle="Петровна")
    response = client.post(
        f"/public/events/{event['slug']}/register",
        headers=headers,
        json=payload(group, middleName="Сергевич Второй"),
    )
    assert response.status_code == 201, response.text
    registration = response.json()["registrationId"]
    path = f"/admin/events/{event['id']}/review/{registration}/roster-suggestions"
    suggestions = client.get(path, headers=headers)
    assert suggestions.status_code == 200, suggestions.text
    assert {item["id"] for item in suggestions.json()["items"]} == {first, second}
    assert unrelated not in str(suggestions.json())
    assert all(
        item["differingFields"] == ["middleName"]
        for item in suggestions.json()["items"]
    )
    with client.app.state.database.connect() as connection:
        saved = (
            connection.execute(
                text(
                    "SELECT person_id,roster_person_id,roster_match_state FROM registrations WHERE id=:id"
                ),
                {"id": registration},
            )
            .mappings()
            .one()
        )
        assert saved["person_id"] not in (first, second)
        assert saved["roster_person_id"] is None
        assert saved["roster_match_state"] == "UNMATCHED"
    client.cookies.clear()
    assert client.get(path).status_code == 401
    scope = create_cross_scope(client.app.state.database)
    foreign = login_as_scope(
        client.app.state.database, client, scope["tenant_b"], scope["organization_b1"]
    )
    assert client.get(path, headers=foreign).status_code == 404
    scanner = login_as_scope(
        client.app.state.database,
        client,
        scope["tenant_a"],
        scope["organization_a1"],
        "SCANNER",
    )
    assert client.get(path, headers=scanner).status_code == 403


def test_exact_duplicate_roster_names_remain_ambiguous(client):
    headers, event = setup_event(client)
    group = f"ДУБЛИ-{uuid4().hex[:8]}"
    first = seed_student(client, group)
    second = seed_student(client, group)
    response = client.post(
        f"/public/events/{event['slug']}/register", headers=headers, json=payload(group)
    )
    assert response.status_code == 201, response.text
    with client.app.state.database.connect() as connection:
        saved = (
            connection.execute(
                text(
                    "SELECT person_id,roster_person_id,roster_match_state FROM registrations WHERE id=:id"
                ),
                {"id": response.json()["registrationId"]},
            )
            .mappings()
            .one()
        )
        assert saved["person_id"] not in (first, second)
        assert saved["roster_person_id"] is None
        assert saved["roster_match_state"] == "AMBIGUOUS"
