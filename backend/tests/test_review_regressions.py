"""Review findings reproduced against disposable MySQL with fictional data."""

from uuid import uuid4

from publication_fixture import publication_fields
from sqlalchemy import text
from test_scoring_v2 import (
    _create_no_result_policy,
    activate_policy,
    assign_participation,
    create_event,
    create_registration,
    create_season,
    login,
)


def test_cancelled_no_rule_sequence_is_not_reused(client):
    headers = login(client)
    database = client.app.state.database
    policy_id, _ = _create_no_result_policy(client, headers)
    season = create_season(client, headers)
    activate_policy(client, headers, season, policy_id, "2026-01-01T00:00:00Z")
    event = create_event(client, headers, season, "2026-07-01T10:00:00Z")
    registration, person = create_registration(database, event)
    first = assign_participation(client, headers, event, registration)
    payload = {
        "registrationIds": [registration],
        "roleId": "30000000-0000-4000-8000-000000000004",
        "resultId": "40000000-0000-4000-8000-000000000001",
    }
    response = client.post(
        f"/admin/events/{event}/participations/confirm", headers=headers, json=payload
    )
    assert response.status_code == 200, response.text
    cancelled = client.post(
        f"/admin/events/{event}/participations/cancel",
        headers=headers,
        json={"participationIds": [first], "reason": "Review regression"},
    )
    assert cancelled.status_code == 200, cancelled.text
    second_event = create_event(client, headers, season, "2026-07-02T10:00:00Z")
    second_registration, _ = create_registration(database, second_event, person)
    second = assign_participation(client, headers, second_event, second_registration)
    payload["registrationIds"] = [second_registration]
    for _ in range(2):
        response = client.post(
            f"/admin/events/{second_event}/participations/confirm",
            headers=headers,
            json=payload,
        )
        assert response.status_code == 200, response.text
    with database.connect() as connection:
        sequence = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": second},
        ).scalar_one()
    assert sequence == 2


def test_event_without_season_can_recover_without_changing_announced_boost(client):
    headers = login(client)
    season = publication_fields(client)["seasonId"]
    event = create_event(client, headers, season, "2026-07-01T10:00:00Z")
    assert (
        client.patch(
            f"/admin/events/{event}", headers=headers, json={"seasonId": None}
        ).status_code
        == 200
    )
    # Model an already published legacy Event with incomplete scoring settings.
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text("UPDATE events SET status='REGISTRATION_OPEN' WHERE id=:id"),
            {"id": event},
        )
    create_registration(client.app.state.database, event)
    recovery = client.patch(
        f"/admin/events/{event}", headers=headers, json={"seasonId": season}
    )
    assert recovery.status_code == 200, recovery.text
    for patch in ({"seasonId": None}, {"boostMultiplier": "3.0"}):
        response = client.patch(f"/admin/events/{event}", headers=headers, json=patch)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "SCORING_CONFIG_LOCKED"


def test_registration_retry_does_not_queue_another_ticket(client):
    headers = login(client)
    slug = f"mail-retry-{uuid4().hex[:10]}"
    response = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Mail retry regression",
            "slug": slug,
            "location": "Test",
            "startAt": "2027-10-10T07:00:00Z",
            "endAt": "2027-10-10T09:00:00Z",
            "registrationDeadline": "2027-10-09T07:00:00Z",
            "capacity": 10,
            "status": "REGISTRATION_OPEN",
            **publication_fields(client),
        },
    )
    assert response.status_code == 201, response.text
    event_id = response.json()["id"]
    path = f"/public/events/{slug}/register"
    payload = {
        "requestId": str(uuid4()),
        "firstName": "Тест",
        "lastName": "Почтовый",
        "email": f"{uuid4().hex}@example.com",
        "consentAccepted": True,
        "consentVersion": client.app.state.settings.consent_version,
    }
    first = client.post(path, headers=headers, json=payload)
    assert first.status_code == 201, first.text
    database = client.app.state.database

    def deliveries():
        with database.connect() as connection:
            return connection.execute(
                text("SELECT COUNT(*) FROM email_deliveries WHERE event_id=:id"),
                {"id": event_id},
            ).scalar_one()

    for values in (payload, {**payload, "requestId": str(uuid4())}):
        retry = client.post(path, headers=headers, json=values)
        assert retry.status_code == 200, retry.text
    assert deliveries() == 1
    with database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE email_deliveries SET status='SENT',queued_at=UTC_TIMESTAMP(3)-INTERVAL 6 MINUTE WHERE event_id=:id"
            ),
            {"id": event_id},
        )
    replay = client.post(path, headers=headers, json=payload)
    assert replay.status_code == 200
    assert deliveries() == 1
    recovery = {**payload, "requestId": str(uuid4())}
    assert client.post(path, headers=headers, json=recovery).status_code == 200
    assert deliveries() == 2
    assert client.post(path, headers=headers, json=recovery).status_code == 200
    assert deliveries() == 2
