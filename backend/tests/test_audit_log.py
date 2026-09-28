from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

from event_api.database import Database

ORIGIN = {"Origin": "http://localhost:5173"}


def test_audit_is_private_compact_and_correlated(client: TestClient) -> None:
    client.cookies.clear()
    assert client.get("/admin/audit").status_code == 401
    login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert login.status_code == 200, login.text
    headers = {**ORIGIN, "X-CSRF-Token": login.json()["csrfToken"]}
    slug = f"audit-check-{uuid4().hex[:12]}"
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Вымышленное мероприятие для проверки журнала",
            "slug": slug,
            "startAt": "2026-11-01T10:00:00+03:00",
            "endAt": "2026-11-01T12:00:00+03:00",
            "registrationDeadline": "2026-10-30T10:00:00+03:00",
            "location": "Тестовая площадка",
            "capacity": 10,
            "status": "DRAFT",
        },
    )
    assert created.status_code == 201, created.text
    assert "X-Request-ID" in created.headers["access-control-expose-headers"]
    request_id = created.headers["x-request-id"]
    event_id = created.json()["id"]
    result = client.get(f"/admin/audit?requestId={request_id}")
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["items"] == [
        {
            "id": result.json()["items"][0]["id"],
            "action": "EVENT_CREATED",
            "entityType": "Event",
            "entityId": event_id,
            "requestId": request_id,
            "actorEmail": "admin@example.com",
            "createdAt": result.json()["items"][0]["createdAt"],
        }
    ]
    assert "metadata" not in result.text

    database: Database = client.app.state.database
    with database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE staff_users SET system_role='ORGANIZER' WHERE email='admin@example.com'"
            )
        )
    try:
        assert client.get("/admin/audit").status_code == 403
    finally:
        with database.transaction() as connection:
            connection.execute(
                text(
                    "UPDATE staff_users SET system_role='SUPER_ADMIN' WHERE email='admin@example.com'"
                )
            )
