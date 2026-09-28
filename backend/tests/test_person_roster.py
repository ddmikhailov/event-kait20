"""Roster edits preserve snapshots, ledger and tenant boundaries."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from test_activity import create_cross_scope, login_as_scope
from test_scoring_v2 import (
    create_event,
    create_registration,
    create_season,
    create_v1_rule,
    login,
)


@pytest.fixture
def student(client):
    headers = login(client)
    season = create_season(client, headers)
    event = create_event(client, headers, season, "2026-08-01T10:00:00Z")
    registration, person = create_registration(client.app.state.database, event)
    changed = client.patch(
        f"/admin/people/{person}", headers=headers, json={"studyGroup": "ТЕСТ-1"}
    )
    assert changed.status_code == 200, changed.text
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
    create_v1_rule(client, headers, season)
    confirmed = client.post(
        f"/admin/events/{event}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration],
            "roleId": "30000000-0000-4000-8000-000000000004",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    detail = client.get(f"/admin/people/{person}", headers=headers).json()
    return person, headers, detail, profile.json()["publicSlug"]


def payload(detail, **changes):
    return {
        **detail["roster"],
        "expectedVersion": detail["rosterVersion"],
        "reason": "Исправление реестра",
        **changes,
    }


def history(database, person):
    with database.connect() as connection:
        return {
            table: [
                dict(item)
                for item in connection.execute(
                    text(f"SELECT * FROM {table} WHERE person_id=:person ORDER BY id"),
                    {"person": person},
                ).mappings()
            ]
            for table in (
                "registrations",
                "participations",
                "score_transactions",
                "student_memberships",
            )
        }


def test_roster_update_preserves_history_and_public_field_boundary(client, student):
    person, headers, detail, slug = student
    database = client.app.state.database
    before = history(database, person)
    assert before["score_transactions"]
    data = payload(
        detail,
        campusAddress="Новая площадка",
        educationStatus="Выпущен",
        course="4",
        programName="Закрытая специальность",
        programCode="00.00.00",
    )
    response = client.patch(
        f"/admin/people/{person}/roster-metadata", headers=headers, json=data
    )
    assert response.status_code == 200, response.text
    assert response.json()["rosterVersion"] != detail["rosterVersion"]
    assert response.json()["roster"]["educationStatus"] == "Выпущен"
    assert history(database, person) == before
    public = client.get(f"/public/profiles/{slug}").json()
    assert public["campus"] == "Новая площадка"
    assert set(public) == {"publicSlug", "displayName", "studyGroup", "campus"}
    with database.connect() as connection:
        metadata = connection.execute(
            text(
                "SELECT metadata FROM audit_log WHERE entity_id=:person AND action='ROSTER_METADATA_UPDATED'"
            ),
            {"person": person},
        ).scalar_one()
    audit = json.loads(metadata)
    assert audit["fields"] == [
        "campus_address",
        "course_label",
        "education_status",
        "program_code",
        "program_name",
    ]
    assert audit["reason"] == data["reason"]
    assert "Закрытая специальность" not in metadata
    stale = client.patch(
        f"/admin/people/{person}/roster-metadata",
        headers=headers,
        json=payload(detail, campusAddress="Устаревшая правка"),
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "ROSTER_METADATA_CHANGED"
    assert client.get(f"/public/profiles/{slug}").json()["campus"] == "Новая площадка"


def test_roster_concurrent_changes_do_not_overwrite_each_other(client, student):
    person, headers, detail, _ = student

    def edit(campus):
        return client.patch(
            f"/admin/people/{person}/roster-metadata",
            headers=headers,
            json=payload(detail, campusAddress=campus),
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(edit, ["Площадка А", "Площадка Б"]))
    assert sorted(item.status_code for item in responses) == [200, 409]


def test_roster_metadata_authorization_validation_and_nulls(client, student):
    person, headers, detail, _ = student
    path = f"/admin/people/{person}/roster-metadata"
    assert (
        client.patch(
            path, headers={"Origin": "http://localhost:5173"}, json=payload(detail)
        ).status_code
        == 403
    )
    for invalid in (
        {"reason": ""},
        {"course": "x" * 121},
        {"publicSlug": "injected"},
        {"expectedVersion": ""},
    ):
        assert (
            client.patch(
                path, headers=headers, json=payload(detail, **invalid)
            ).status_code
            == 400
        )
    database = client.app.state.database
    scope = create_cross_scope(database)
    organizer = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a1"], "ORGANIZER"
    )
    saved = client.patch(
        path,
        headers=organizer,
        json=payload(detail, campusAddress="Площадка организатора"),
    )
    assert saved.status_code == 200, saved.text
    cleared = client.patch(
        path, headers=organizer, json=payload(saved.json(), campusAddress=None)
    )
    assert (
        cleared.status_code == 200 and cleared.json()["roster"]["campusAddress"] is None
    )
    scanner = login_as_scope(
        database, client, scope["tenant_a"], scope["organization_a1"], "SCANNER"
    )
    assert (
        client.patch(path, headers=scanner, json=payload(cleared.json())).status_code
        == 403
    )
    other = login_as_scope(
        database, client, scope["tenant_b"], scope["organization_b1"]
    )
    assert (
        client.patch(path, headers=other, json=payload(cleared.json())).status_code
        == 404
    )
    client.cookies.clear()
    assert (
        client.patch(path, headers=headers, json=payload(cleared.json())).status_code
        == 401
    )


def test_duplicate_filter_is_bounded_and_tenant_scoped(client, student):
    person, headers, detail, _ = student
    query = {"query": detail["email"], "pageSize": 1, "dedupReviewRequired": "true"}
    assert (
        client.get("/admin/people", headers=headers, params=query).json()["total"] == 0
    )
    database = client.app.state.database
    with database.transaction() as connection:
        connection.execute(
            text("UPDATE persons SET dedup_review_required=true WHERE id=:id"),
            {"id": person},
        )
    listed = client.get("/admin/people", headers=headers, params=query)
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()["items"]] == [person]
    assert (
        client.get(
            "/admin/people",
            headers=headers,
            params={**query, "dedupReviewRequired": "false"},
        ).json()["total"]
        == 0
    )
    assert (
        client.get(
            "/admin/people", headers=headers, params={**query, "pageSize": 101}
        ).status_code
        == 400
    )
    scope = create_cross_scope(database)
    other = login_as_scope(
        database, client, scope["tenant_b"], scope["organization_b1"]
    )
    assert client.get("/admin/people", headers=other, params=query).json()["total"] == 0
