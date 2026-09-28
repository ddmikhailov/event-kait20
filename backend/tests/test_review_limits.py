"""Real MySQL boundaries; fictional people, no production data."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

from sqlalchemy import text
from test_scoring_v2 import create_event, create_season, login

from event_api.errors import ApiError
from event_api.event_review import enqueue_due_reviews
from event_api.registration_service import create_registration, participant
from event_api.schemas import ParticipantValues


def test_failed_queue_head_does_not_starve_later_events(client, monkeypatch):
    import event_api.event_review as service

    headers = login(client)
    season = create_season(client, headers)
    events = [
        create_event(
            client,
            headers,
            season,
            (datetime(2020, 1, 1, tzinfo=UTC) + timedelta(minutes=i)).isoformat(),
        )
        for i in range(21)
    ]
    database = client.app.state.database
    with database.transaction() as connection:
        for identity in events:
            connection.execute(
                text(
                    "UPDATE events SET status='REGISTRATION_OPEN',activity_review_required=true WHERE id=:id"
                ),
                {"id": identity},
            )
    original = service.prepare_review
    failed = set(events[:20])

    def prepare(connection, identity, actor):
        if identity in failed:
            raise ApiError(
                409, "EVENT_COMPLETION_TOO_LARGE", "Test oversized legacy event"
            )
        return original(connection, identity, actor)

    monkeypatch.setattr(service, "prepare_review", prepare)
    now = datetime.now(UTC).replace(microsecond=0)
    enqueue_due_reviews(database, now)
    with database.connect() as connection:
        item = connection.execute(
            text(
                "SELECT status,review_preparation_error,review_retry_at FROM events WHERE id=:id"
            ),
            {"id": events[0]},
        ).one()
    assert item[0] == "REGISTRATION_OPEN"  # failed preparation rolled back
    assert item[1] == "EVENT_COMPLETION_TOO_LARGE"
    assert item[2] == (now + timedelta(minutes=5)).replace(
        tzinfo=None, microsecond=((now.microsecond // 1000) * 1000)
    )
    enqueue_due_reviews(database, now + timedelta(seconds=60))
    with database.connect() as connection:
        state = connection.execute(
            text("SELECT activity_review_state FROM events WHERE id=:id"),
            {"id": events[20]},
        ).scalar_one()
    assert state == "PENDING"
    monkeypatch.setattr(service, "prepare_review", original)
    enqueue_due_reviews(database, now + timedelta(minutes=6))
    with database.connect() as connection:
        recovered = connection.execute(
            text(
                "SELECT activity_review_state,review_preparation_error,review_retry_at FROM events WHERE id=:id"
            ),
            {"id": events[0]},
        ).one()
    assert tuple(recovered) == ("PENDING", None, None)


def test_event_limit_blocks_5001_even_with_onsite_override(client):
    headers = login(client)
    season = create_season(client, headers)
    event = create_event(client, headers, season, "2028-01-01T10:00:00Z")
    assert (
        client.patch(
            f"/admin/events/{event}", headers=headers, json={"capacity": 5001}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/admin/events/{event}", headers=headers, json={"capacity": 5000}
        ).status_code
        == 200
    )
    database = client.app.state.database
    people = [
        {"id": str(uuid4()), "registration": str(uuid4()), "event": event}
        for _ in range(4999)
    ]
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO persons (id,tenant_id,last_name,first_name,person_type,dedup_review_required,created_at,updated_at)
            VALUES (:id,'50000000-0000-4000-8000-000000000001','Тестов','Лимит','OTHER',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            people,
        )
        connection.execute(
            text("""INSERT INTO registrations (id,public_id,event_id,person_id,source,status,last_name,first_name,person_type,consent_accepted,registered_at,created_at,updated_at)
            VALUES (:registration,:registration,:event,:id,'ADMIN_MANUAL','ACTIVE','Тестов','Лимит','OTHER',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            people,
        )
    payload = {
        "firstName": "Граница",
        "lastName": "Тестов",
        "personType": "OTHER",
        "requestId": str(uuid4()),
        "capacityOverride": True,
        "consentAccepted": True,
    }
    with database.transaction() as connection:
        connection.execute(
            text("UPDATE events SET status='ACTIVE' WHERE id=:id"), {"id": event}
        )
    path = f"/admin/events/{event}/registrations/onsite"
    allowed = client.post(path, headers=headers, json=payload)
    assert allowed.status_code == 201, allowed.text
    blocked = client.post(
        path, headers=headers, json={**payload, "requestId": str(uuid4())}
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "EVENT_REGISTRATION_LIMIT"

    # A current locking read is required even if the transaction already has
    # a REPEATABLE READ snapshot from before another registration commits.
    candidates = [str(uuid4()), str(uuid4())]
    with database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE registrations SET status='ANNULLED',annulled_at=UTC_TIMESTAMP(3) WHERE id=:id"
            ),
            {"id": people[0]["registration"]},
        )
        connection.execute(
            text("""INSERT INTO persons (id,tenant_id,last_name,first_name,person_type,dedup_review_required,created_at,updated_at)
        VALUES (:id,'50000000-0000-4000-8000-000000000001','Тестов','Конкуренция','OTHER',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            [{"id": identity} for identity in candidates],
        )
    barrier = Barrier(2)
    data = participant(
        ParticipantValues(
            lastName="Тестов", firstName="Конкуренция", personType="OTHER"
        )
    )

    def compete(identity):
        try:
            with database.transaction() as connection:
                assert (
                    connection.execute(
                        text(
                            "SELECT COUNT(*) FROM registrations WHERE event_id=:event AND status='ACTIVE'"
                        ),
                        {"event": event},
                    ).scalar_one()
                    == 4999
                )
                barrier.wait(timeout=10)
                create_registration(
                    connection,
                    event,
                    identity,
                    data,
                    "ADMIN_MANUAL",
                    True,
                    client.app.state.settings,
                )
            return "CREATED"
        except ApiError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(compete, candidates))
    assert sorted(outcomes) == ["CREATED", "EVENT_REGISTRATION_LIMIT"]
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM registrations WHERE event_id=:event AND status='ACTIVE'"
                ),
                {"event": event},
            ).scalar_one()
            == 5000
        )


def test_stream_capacity_sum_cannot_exceed_review_limit(client):
    headers = login(client)
    event = create_event(
        client, headers, create_season(client, headers), "2028-01-01T10:00:00Z"
    )
    path = f"/admin/events/{event}/streams"
    values = {
        "title": "Тестовый поток",
        "startAt": "2028-01-01T10:00:00Z",
        "endAt": "2028-01-01T11:00:00Z",
        "capacity": 3000,
    }
    first = client.post(path, headers=headers, json=values)
    assert first.status_code == 201, first.text
    second = client.post(
        path,
        headers=headers,
        json={**values, "title": "Второй поток", "capacity": 2000},
    )
    assert second.status_code == 201, second.text
    for response in (
        client.post(
            path,
            headers=headers,
            json={**values, "title": "Третий поток", "capacity": 1},
        ),
        client.patch(
            f"{path}/{second.json()['id']}",
            headers=headers,
            json={**values, "title": "Второй поток", "capacity": 2001},
        ),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "EVENT_REGISTRATION_LIMIT"
    assert (
        client.get(f"/admin/events/{event}", headers=headers).json()["capacity"] == 5000
    )
