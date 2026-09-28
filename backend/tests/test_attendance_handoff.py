"""Rejected marks survive Scanner handoff without changing attendance."""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

ORIGIN = {"Origin": "http://localhost:5173"}


def test_rejected_mark_handoff_is_durable_idempotent_and_admin_resolved(
    client: TestClient,
) -> None:
    client.cookies.clear()
    login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert login.status_code == 200, login.text
    headers = {**ORIGIN, "X-CSRF-Token": login.json()["csrfToken"]}
    event = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Handoff test",
            "slug": f"handoff-{uuid4().hex[:12]}",
            "description": "Disposable integration event",
            "startAt": "2026-10-10T10:00:00Z",
            "endAt": "2026-10-10T12:00:00Z",
            "timezone": "Europe/Moscow",
            "location": "Тестовая площадка",
            "registrationDeadline": "2026-10-09T10:00:00Z",
            "capacity": 100,
            "status": "DRAFT",
        },
    )
    assert event.status_code == 201, event.text
    event_id = event.json()["id"]
    client_id, registration_id = str(uuid4()), str(uuid4())
    body = {
        "deviceId": str(uuid4()),
        "item": {
            "clientEventId": client_id,
            "registrationId": registration_id,
            "mode": "MANUAL_CONFIRM",
            "source": "OFFLINE_SYNC",
            "deviceScannedAt": "2026-10-10T10:30:00Z",
            "estimatedScannedAt": "2026-10-10T10:30:00Z",
        },
        "rejectionStatus": "INVALID_REGISTRATION",
    }
    path = f"/scanner/events/{event_id}/attendance/rejections"
    assert client.post(path, headers=ORIGIN, json=body).status_code == 403
    created = client.post(path, headers=headers, json=body)
    assert created.status_code == 201, created.text
    assert created.json() == {"clientEventId": client_id, "status": "OPEN"}
    assert client.post(path, headers=headers, json=body).json() == created.json()
    conflicting = client.post(
        path, headers=headers, json={**body, "deviceId": str(uuid4())}
    )
    assert conflicting.status_code == 409
    assert conflicting.json()["error"]["code"] == "HANDOFF_CONFLICT"

    admin_path = f"/admin/events/{event_id}/attendance/rejections"
    listed = client.get(admin_path)
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"][0]["registrationId"] == registration_id
    assert listed.json()["items"][0]["lastName"] is None
    assert listed.json()["hasNext"] is False
    assert client.get(f"/admin/events/{uuid4()}/attendance/rejections").status_code == 404
    database = client.app.state.database
    with database.connect() as connection:
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM attendance_events WHERE event_id=:event"),
                {"event": event_id},
            ).scalar_one()
            == 0
        )
    resolved = client.patch(
        f"{admin_path}/{client_id}",
        headers=headers,
        json={"reason": "Регистрация не найдена, требуется проверка данных"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "RESOLVED"
    assert client.get(admin_path).json()["items"] == []
    assert client.post(path, headers=headers, json=body).json()["status"] == "RESOLVED"
    assert (
        client.patch(
            f"{admin_path}/{client_id}",
            headers=headers,
            json={"reason": "Ещё одна проверка"},
        ).status_code
        == 409
    )


def test_handoff_other_event_cannot_reveal_case(client: TestClient) -> None:
    """A case URL never bypasses the event/organization boundary."""
    client.cookies.clear()
    response = client.get(f"/admin/events/{uuid4()}/attendance/rejections")
    assert response.status_code == 401
