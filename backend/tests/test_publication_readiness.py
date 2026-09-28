from uuid import uuid4

from publication_fixture import publication_fields
from test_scoring_v2 import (
    activate_policy,
    create_event,
    create_policy,
    create_season,
    login,
)


def event_values():
    return {
        "title": "Проверка готовности начислений",
        "slug": f"readiness-{uuid4().hex[:10]}",
        "startAt": "2028-01-01T10:00:00Z",
        "endAt": "2028-01-01T12:00:00Z",
        "registrationDeadline": "2028-01-01T09:00:00Z",
        "location": "Тестовая площадка",
        "capacity": 20,
        "status": "REGISTRATION_OPEN",
    }


def assert_reason(response, reason):
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "SCORING_SETUP_REQUIRED"
    assert response.json()["error"]["details"]["reason"] == reason


def test_draft_can_be_incomplete_but_publication_requires_scoring(client):
    headers = login(client)
    payload = event_values()
    assert_reason(
        client.post("/admin/events", headers=headers, json=payload), "SEASON_REQUIRED"
    )
    draft = client.post(
        "/admin/events", headers=headers, json={**payload, "status": "DRAFT"}
    )
    assert draft.status_code == 201, draft.text
    path = f"/admin/events/{draft.json()['id']}"
    assert_reason(
        client.patch(path, headers=headers, json={"status": "REGISTRATION_OPEN"}),
        "SEASON_REQUIRED",
    )
    fields = publication_fields(client)
    assert_reason(
        client.patch(
            path,
            headers=headers,
            json={"status": "REGISTRATION_OPEN", "seasonId": fields["seasonId"]},
        ),
        "LEVEL_REQUIRED",
    )
    opened = client.patch(
        path, headers=headers, json={"status": "REGISTRATION_OPEN", **fields}
    )
    assert opened.status_code == 200, opened.text
    assert client.get(f"/public/events/{payload['slug']}").status_code == 200
    assert_reason(
        client.patch(path, headers=headers, json={"seasonId": None}), "SEASON_REQUIRED"
    )
    assert client.get(path, headers=headers).json()["seasonId"] == fields["seasonId"]
    # Removing the effective policy through rescheduling must also be rejected atomically.
    assert_reason(
        client.patch(
            path,
            headers=headers,
            json={
                "startAt": "2019-01-01T10:00:00Z",
                "registrationDeadline": "2019-01-01T09:00:00Z",
            },
        ),
        "POLICY_REQUIRED",
    )


def test_publication_checks_default_role_and_chosen_level(client):
    headers = login(client)
    season = create_season(client, headers)
    event = create_event(client, headers, season, "2028-01-01T10:00:00Z")
    path = f"/admin/events/{event}"
    assert_reason(
        client.patch(path, headers=headers, json={"status": "REGISTRATION_OPEN"}),
        "POLICY_REQUIRED",
    )
    # This valid policy only defines another role; publication needs PARTICIPANT.
    policy, _ = create_policy(client, headers)
    activate_policy(client, headers, season, policy, "2026-01-01T00:00:00Z")
    assert_reason(
        client.patch(path, headers=headers, json={"status": "REGISTRATION_OPEN"}),
        "PARTICIPANT_BASE_REQUIRED",
    )
    fields = publication_fields(client)
    assert_reason(
        client.post(
            "/admin/events",
            headers=headers,
            json={
                **event_values(),
                **fields,
                "levelId": "20000000-0000-4000-8000-000000000001",
            },
        ),
        "LEVEL_MULTIPLIER_REQUIRED",
    )
    ready = client.post(
        "/admin/events", headers=headers, json={**event_values(), **fields}
    )
    assert ready.status_code == 201, ready.text


def test_assigned_policy_must_cover_event_date(client):
    headers = login(client)
    season = create_season(client, headers)
    policy, _ = create_policy(client, headers, effective_to="2027-01-01T00:00:00Z")
    activate_policy(client, headers, season, policy, "2026-01-01T00:00:00Z")
    event = create_event(client, headers, season, "2028-01-01T10:00:00Z")
    response = client.patch(
        f"/admin/events/{event}", headers=headers, json={"status": "REGISTRATION_OPEN"}
    )
    assert_reason(response, "POLICY_VERSION_REQUIRED")
