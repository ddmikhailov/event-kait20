"""A manual merge preserves scored history and refuses unresolved conflicts."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text
from test_activity import create_cross_scope, login_as_scope
from test_scoring_v2 import (
    activate_policy,
    create_event,
    create_policy,
    create_registration,
    create_season,
    create_v1_rule,
    login,
)

from event_api.registration_service import find_or_create_person


def _person_ids(client):
    headers = login(client)
    season = create_season(client, headers)
    first_event = create_event(client, headers, season, "2026-08-01T10:00:00Z")
    second_event = create_event(client, headers, season, "2026-08-02T10:00:00Z")
    first_registration, target = create_registration(
        client.app.state.database, first_event
    )
    second_registration, source = create_registration(
        client.app.state.database, second_event
    )
    return (
        headers,
        season,
        first_event,
        second_event,
        first_registration,
        second_registration,
        target,
        source,
    )


def test_person_merge_moves_history_and_preserves_registration_snapshot(client):
    (
        headers,
        season,
        _,
        second_event,
        _,
        source_registration,
        target,
        source,
    ) = _person_ids(client)
    database = client.app.state.database
    source_email = f"{source}@example.test"
    assert (
        client.patch(
            f"/admin/people/{source}",
            headers=headers,
            json={"studyGroup": "MERGE-1"},
        ).status_code
        == 200
    )
    assert (
        client.post(f"/admin/people/{source}/roster", headers=headers).status_code
        == 201
    )
    profile = client.patch(
        f"/admin/people/{source}/profile",
        headers=headers,
        json={"visibility": "PUBLIC"},
    )
    assert profile.status_code == 200, profile.text
    slug = profile.json()["publicSlug"]
    create_v1_rule(client, headers, season)
    confirmed = client.post(
        f"/admin/events/{second_event}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [source_registration],
            "roleId": "30000000-0000-4000-8000-000000000004",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    achievement_id = str(uuid4())
    membership_id = str(uuid4())
    status_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO achievements
            (id,person_id,title,achievement_type,source,status,occurred_at,updated_at)
            VALUES (:id,:person,'Тестовое достижение','OTHER','MANUAL','VERIFIED',
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {"id": achievement_id, "person": source},
        )
        connection.execute(
            text("""INSERT INTO student_memberships
            (id,person_id,organization_id,study_group,valid_from,updated_at)
            VALUES (:id,:person,'51000000-0000-4000-8000-000000000001',
                    'MERGE-1','2025-09-01',UTC_TIMESTAMP(3))"""),
            {"id": membership_id, "person": source},
        )
        connection.execute(
            text("""INSERT INTO person_status_assignments
            (id,person_id,status_type_id,valid_from)
            VALUES (:id,:person,'62000000-0000-4000-8000-000000000001','2025-09-01')"""),
            {"id": status_id, "person": source},
        )
    with database.connect() as connection:
        before = {
            table: [
                row[0]
                for row in connection.execute(
                    text(f"SELECT id FROM {table} WHERE person_id=:source ORDER BY id"),
                    {"source": source},
                )
            ]
            for table in (
                "registrations",
                "participations",
                "score_transactions",
                "achievements",
                "student_memberships",
                "person_status_assignments",
            )
        }
        snapshot = connection.execute(
            text("SELECT email,study_group FROM registrations WHERE id=:id"),
            {"id": source_registration},
        ).one()
    assert before["score_transactions"]
    preview = client.get(
        f"/admin/people/{target}/merge-preview",
        headers=headers,
        params={"sourcePersonId": source},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["canMerge"] is True
    assert preview.json()["sourceCounts"]["score_transactions"] > 0
    merged = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={"sourcePersonId": source, "reason": "Один студент, проверены данные"},
    )
    assert merged.status_code == 200, merged.text
    assert source_registration in [
        item["id"] for item in merged.json()["registrations"]
    ]
    with database.connect() as connection:
        for table, expected in before.items():
            actual = [
                row[0]
                for row in connection.execute(
                    text(f"SELECT id FROM {table} WHERE person_id=:target ORDER BY id"),
                    {"target": target},
                )
            ]
            assert set(expected).issubset(actual)
        assert (
            connection.execute(
                text("SELECT merged_into_id FROM persons WHERE id=:source"),
                {"source": source},
            ).scalar_one()
            == target
        )
        assert (
            connection.execute(
                text(
                    "SELECT person_id FROM student_roster_members WHERE person_id=:target"
                ),
                {"target": target},
            ).scalar_one()
            == target
        )
        assert (
            connection.execute(
                text("SELECT person_id FROM student_profiles WHERE public_slug=:slug"),
                {"slug": slug},
            ).scalar_one()
            == target
        )
        assert (
            connection.execute(
                text("SELECT email,study_group FROM registrations WHERE id=:id"),
                {"id": source_registration},
            ).one()
            == snapshot
        )
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM audit_log WHERE entity_id=:target AND action='PERSON_MERGED'"
                ),
                {"target": target},
            ).scalar_one()
            == 1
        )
    assert client.get(f"/public/profiles/{slug}").status_code == 200
    assert client.get(f"/admin/people/{source}", headers=headers).status_code == 404
    with database.transaction() as connection:
        resolved = find_or_create_person(
            connection,
            {
                "last_name": "Тестов",
                "first_name": "Score",
                "middle_name": None,
                "birth_date": None,
                "email": source_email,
                "phone": None,
                "study_group": "MERGE-1",
                "person_type": "KAIT_STUDENT",
                "organization": "КАИТ №20",
            },
            "50000000-0000-4000-8000-000000000001",
        )
        assert resolved == target
    assert (
        client.get(f"/admin/people/{target}", headers=headers).json()["email"]
        != source_email
    )


def test_person_merge_blocks_active_registration_conflict(client):
    headers = login(client)
    season = create_season(client, headers)
    event = create_event(client, headers, season, "2026-09-01T10:00:00Z")
    _, target = create_registration(client.app.state.database, event)
    _, source = create_registration(client.app.state.database, event)
    preview = client.get(
        f"/admin/people/{target}/merge-preview",
        headers=headers,
        params={"sourcePersonId": source},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["canMerge"] is False
    assert preview.json()["conflicts"][0] == {
        "code": "ACTIVE_REGISTRATION",
        "eventId": event,
        "sequence": None,
    }
    merged = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={"sourcePersonId": source, "reason": "Проверка конфликта"},
    )
    assert merged.status_code == 409
    assert merged.json()["error"]["code"] == "PERSON_MERGE_CONFLICT"
    bypass = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={
            "sourcePersonId": source,
            "reason": "Проверка конфликта",
            "participationOrder": [],
            "orderVersion": "0" * 64,
        },
    )
    assert bypass.status_code == 409
    assert bypass.json()["error"]["code"] == "PERSON_MERGE_CONFLICT"
    with client.app.state.database.connect() as connection:
        assert (
            connection.execute(
                text("SELECT merged_into_id FROM persons WHERE id=:source"),
                {"source": source},
            ).scalar_one()
            is None
        )


def test_person_merge_blocks_duplicate_scoring_sequence(client):
    (
        headers,
        _,
        first_event,
        second_event,
        first_registration,
        second_registration,
        target,
        source,
    ) = _person_ids(client)
    with client.app.state.database.transaction() as connection:
        for person, event, registration in (
            (target, first_event, first_registration),
            (source, second_event, second_registration),
        ):
            connection.execute(
                text("""INSERT INTO participations
                (id,person_id,event_id,registration_id,status,scoring_sequence,updated_at)
                VALUES (:id,:person,:event,:registration,'CONFIRMED',1,UTC_TIMESTAMP(3))"""),
                {
                    "id": str(uuid4()),
                    "person": person,
                    "event": event,
                    "registration": registration,
                },
            )
    preview = client.get(
        f"/admin/people/{target}/merge-preview",
        headers=headers,
        params={"sourcePersonId": source},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["conflicts"] == [
        {"code": "SCORING_SEQUENCE", "eventId": None, "sequence": 1}
    ]
    response = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={"sourcePersonId": source, "reason": "История требует решения"},
    )
    assert response.status_code == 409, response.text


def test_ordered_merge_recalculates_awards_with_full_ledger_history(client):
    headers = login(client)
    season = create_season(client, headers)
    policy, _ = create_policy(client, headers)
    activate_policy(client, headers, season, policy, "2026-01-01T00:00:00Z")
    first_event = create_event(client, headers, season, "2026-08-01T10:00:00Z")
    second_event = create_event(client, headers, season, "2026-08-02T10:00:00Z")
    first_registration, target = create_registration(
        client.app.state.database, first_event
    )
    second_registration, source = create_registration(
        client.app.state.database, second_event
    )
    participation_ids = []
    for event, registration in (
        (first_event, first_registration),
        (second_event, second_registration),
    ):
        confirmed = client.post(
            f"/admin/events/{event}/participations/confirm",
            headers=headers,
            json={
                "registrationIds": [registration],
                "roleId": "30000000-0000-4000-8000-000000000004",
            },
        )
        assert confirmed.status_code == 200, confirmed.text
        with client.app.state.database.connect() as connection:
            participation_ids.append(
                connection.execute(
                    text("SELECT id FROM participations WHERE registration_id=:id"),
                    {"id": registration},
                ).scalar_one()
            )
    preview = client.get(
        f"/admin/people/{target}/merge-preview",
        headers=headers,
        params={"sourcePersonId": source},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["canMerge"] is False
    assert preview.json()["canResolveWithOrder"] is True
    assert {item["id"] for item in preview.json()["participationOrder"]} == set(
        participation_ids
    )
    incorrect = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={
            "sourcePersonId": source,
            "reason": "Проверен порядок всей истории",
            "participationOrder": [participation_ids[0], participation_ids[0]],
            "orderVersion": preview.json()["orderVersion"],
        },
    )
    assert incorrect.status_code == 409, incorrect.text
    assert incorrect.json()["error"]["code"] == "PERSON_MERGE_ORDER_CHANGED"
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text("""UPDATE participations SET updated_at=DATE_ADD(updated_at, INTERVAL 1 SECOND)
            WHERE id=:id"""),
            {"id": participation_ids[0]},
        )
    stale = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={
            "sourcePersonId": source,
            "reason": "Проверен порядок всей истории",
            "participationOrder": participation_ids,
            "orderVersion": preview.json()["orderVersion"],
        },
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "PERSON_MERGE_ORDER_CHANGED"
    preview = client.get(
        f"/admin/people/{target}/merge-preview",
        headers=headers,
        params={"sourcePersonId": source},
    )
    assert preview.status_code == 200, preview.text
    merged = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={
            "sourcePersonId": source,
            "reason": "Проверен порядок всей истории",
            "participationOrder": participation_ids,
            "orderVersion": preview.json()["orderVersion"],
        },
    )
    assert merged.status_code == 200, merged.text
    with client.app.state.database.connect() as connection:
        participations = (
            connection.execute(
                text("""SELECT id,person_id,scoring_sequence,scoring_cycle FROM participations
            WHERE id IN (:first,:second) ORDER BY scoring_sequence"""),
                {"first": participation_ids[0], "second": participation_ids[1]},
            )
            .mappings()
            .all()
        )
        assert [item["id"] for item in participations] == participation_ids
        assert [item["person_id"] for item in participations] == [target, target]
        assert [item["scoring_sequence"] for item in participations] == [1, 2]
        assert [item["scoring_cycle"] for item in participations] == [2, 2]
        ledger = (
            connection.execute(
                text("""SELECT participation_id,transaction_type,points,person_id,
                   calculation_snapshot FROM score_transactions
                   WHERE participation_id IN (:first,:second)
                   ORDER BY created_at,id"""),
                {"first": participation_ids[0], "second": participation_ids[1]},
            )
            .mappings()
            .all()
        )
        assert len(ledger) == 6
        assert {item["person_id"] for item in ledger} == {target}
        by_participation = {
            identity: [item for item in ledger if item["participation_id"] == identity]
            for identity in participation_ids
        }
        assert {
            item["transaction_type"] for item in by_participation[participation_ids[1]]
        } == {"AWARD", "REVERSAL"}
        assert sum(item["points"] for item in ledger) == Decimal("16.8")
        assert (
            connection.execute(
                text("""SELECT count(*) FROM audit_log
                WHERE action='SCORING_SEQUENCE_REASSIGNED'
                  AND entity_id IN (:first,:second)"""),
                {"first": participation_ids[0], "second": participation_ids[1]},
            ).scalar_one()
            == 2
        )


def test_ordered_merge_includes_legacy_participations_without_reawarding_them(client):
    headers = login(client)
    season = create_season(client, headers)
    create_v1_rule(client, headers, season)
    legacy_event = create_event(client, headers, season, "2026-06-01T10:00:00Z")
    legacy_registration, target = create_registration(
        client.app.state.database, legacy_event
    )
    policy, _ = create_policy(client, headers, effective_from="2026-07-01T00:00:00Z")
    activate_policy(client, headers, season, policy, "2026-07-01T00:00:00Z")
    first_event = create_event(client, headers, season, "2026-08-01T10:00:00Z")
    second_event = create_event(client, headers, season, "2026-08-02T10:00:00Z")
    first_registration, _ = create_registration(
        client.app.state.database, first_event, target
    )
    second_registration, source = create_registration(
        client.app.state.database, second_event
    )
    participation_ids = []
    for event, registration in (
        (first_event, first_registration),
        (second_event, second_registration),
        (legacy_event, legacy_registration),
    ):
        response = client.post(
            f"/admin/events/{event}/participations/confirm",
            headers=headers,
            json={
                "registrationIds": [registration],
                "roleId": "30000000-0000-4000-8000-000000000004",
            },
        )
        assert response.status_code == 200, response.text
        with client.app.state.database.connect() as connection:
            participation_ids.append(
                connection.execute(
                    text("SELECT id FROM participations WHERE registration_id=:id"),
                    {"id": registration},
                ).scalar_one()
            )
    preview = client.get(
        f"/admin/people/{target}/merge-preview",
        headers=headers,
        params={"sourcePersonId": source},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["canResolveWithOrder"] is True
    assert len(preview.json()["participationOrder"]) == 3
    legacy = next(
        item
        for item in preview.json()["participationOrder"]
        if item["id"] == participation_ids[2]
    )
    assert legacy["previousSequence"] is None
    merged = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={
            "sourcePersonId": source,
            "reason": "Вся история упорядочена вручную",
            "participationOrder": [participation_ids[2], *participation_ids[:2]],
            "orderVersion": preview.json()["orderVersion"],
        },
    )
    assert merged.status_code == 200, merged.text
    with client.app.state.database.connect() as connection:
        ledger = (
            connection.execute(
                text("""SELECT participation_id,transaction_type,points
            FROM score_transactions WHERE person_id=:person"""),
                {"person": target},
            )
            .mappings()
            .all()
        )
        assert [
            item["transaction_type"]
            for item in ledger
            if item["participation_id"] == participation_ids[2]
        ] == ["AWARD"]
        assert sum(item["points"] for item in ledger) == Decimal("22.0")
        assert [
            item["scoring_sequence"]
            for item in connection.execute(
                text("""SELECT scoring_sequence FROM participations
                WHERE person_id=:person ORDER BY scoring_sequence"""),
                {"person": target},
            )
            .mappings()
            .all()
        ] == [1, 2, 3]


def test_merged_public_slug_follows_primary_visibility(client):
    headers, _, _, _, _, _, target, source = _person_ids(client)
    slugs = []
    for person, group in ((target, "PRIMARY-1"), (source, "SECONDARY-1")):
        assert (
            client.patch(
                f"/admin/people/{person}", headers=headers, json={"studyGroup": group}
            ).status_code
            == 200
        )
        assert (
            client.post(f"/admin/people/{person}/roster", headers=headers).status_code
            == 201
        )
        profile = client.patch(
            f"/admin/people/{person}/profile",
            headers=headers,
            json={"visibility": "PUBLIC"},
        )
        assert profile.status_code == 200, profile.text
        slugs.append(profile.json()["publicSlug"])
    merged = client.post(
        f"/admin/people/{target}/merge",
        headers=headers,
        json={"sourcePersonId": source, "reason": "Проверены обе карточки"},
    )
    assert merged.status_code == 200, merged.text
    old_link = client.get(f"/public/profiles/{slugs[1]}")
    assert old_link.status_code == 200, old_link.text
    assert old_link.json()["publicSlug"] == slugs[0]
    assert old_link.json()["studyGroup"] == "PRIMARY-1"
    hidden = client.patch(
        f"/admin/people/{target}/profile",
        headers=headers,
        json={"visibility": "PRIVATE"},
    )
    assert hidden.status_code == 200, hidden.text
    assert client.get(f"/public/profiles/{slugs[1]}").status_code == 404


def test_duplicate_dismiss_and_merge_are_super_admin_only(client):
    headers, _, _, _, _, _, target, source = _person_ids(client)
    database = client.app.state.database
    with database.transaction() as connection:
        connection.execute(
            text("UPDATE persons SET dedup_review_required=true WHERE id=:id"),
            {"id": target},
        )
    scope = create_cross_scope(database)
    organizer = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a1"], "ORGANIZER"
    )
    assert (
        client.get(
            f"/admin/people/{target}/merge-preview",
            headers=organizer,
            params={"sourcePersonId": source},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/admin/people/{target}/merge",
            headers=organizer,
            json={"sourcePersonId": source, "reason": "Проверка прав"},
        ).status_code
        == 403
    )
    headers = login(client)
    other = login_as_scope(
        database, client, scope["tenant_b"], scope["organization_b1"]
    )
    assert (
        client.get(
            f"/admin/people/{target}/merge-preview",
            headers=other,
            params={"sourcePersonId": source},
        ).status_code
        == 404
    )
    headers = login(client)
    dismissed = client.post(
        f"/admin/people/{target}/dismiss-duplicate",
        headers=headers,
        json={"reason": "Это разные студенты"},
    )
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["dedupReviewRequired"] is False
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM audit_log WHERE entity_id=:target AND action='PERSON_DUPLICATE_DISMISSED'"
                ),
                {"target": target},
            ).scalar_one()
            == 1
        )
