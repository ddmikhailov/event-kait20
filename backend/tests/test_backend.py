from __future__ import annotations

import json
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from event_api.bootstrap import create_activation_token
from event_api.config import Settings
from event_api.database import Database
from event_api.demo_seed import main as seed_demo
from event_api.email_worker import process_once
from event_api.errors import ApiError
from event_api.registration_service import participant
from event_api.routers.excel import _parse
from event_api.schemas import MAX_CUSTOM_ANSWERS, ParticipantValues
from event_api.security import RateLimiter, auth_link_token, hash_password, token_hash

ORIGIN = {"Origin": "http://localhost:5173"}


def _tiny_png() -> bytes:
    """A real, minimal, decodable PNG - media.py now fully decodes uploads."""
    from io import BytesIO as _BytesIO

    from PIL import Image as _Image

    buffer = _BytesIO()
    _Image.new("RGB", (2, 2), color=(120, 60, 180)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_excel_rejects_formula_and_merged_cells() -> None:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["Фамилия", "Имя", "Дата рождения", "Тип участника", "Телефон"])
    sheet.append(["=1+1", "Иван", "2000-01-01", "KAIT_TEACHER", "+79990000000"])
    source = BytesIO()
    workbook.save(source)
    assert _parse(source.getvalue())[2][0]["errors"]
    sheet.merge_cells("A2:B2")
    source = BytesIO()
    workbook.save(source)
    with pytest.raises(ApiError):
        _parse(source.getvalue())


@pytest.mark.parametrize(
    ("label", "expected"), [("Родитель", "PARENT"), ("Другое", "OTHER")]
)
def test_excel_accepts_new_participant_labels(label: str, expected: str) -> None:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["Фамилия", "Имя", "Дата рождения", "Тип участника", "Телефон"])
    sheet.append(["Иванова", "Анна", "1985-02-03", label, "+79990000001"])
    source = BytesIO()
    workbook.save(source)

    parsed = _parse(source.getvalue())[2][0]
    assert parsed["errors"] == []
    assert parsed["participant"]["personType"] == expected


@pytest.mark.parametrize("person_type", ["PARENT", "OTHER"])
def test_new_participant_types_need_no_group_or_organization(person_type: str) -> None:
    values = ParticipantValues.model_validate(
        {
            "lastName": "Иванова",
            "firstName": "Анна",
            "birthDate": "1985-02-03",
            "phone": "+79990000001",
            "personType": person_type,
            "studyGroup": "Старое значение",
            "organization": "Старое значение",
            "customAnswers": [],
        }
    )

    normalized = participant(values)
    assert normalized["person_type"] == person_type
    assert normalized["study_group"] is None
    assert normalized["organization"] is None


def _login(client: TestClient) -> tuple[dict[str, str], str]:
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert response.status_code == 200, response.text
    csrf = response.json()["csrfToken"]
    return {**ORIGIN, "X-CSRF-Token": csrf}, response.cookies["staff_session"]


def _seed_active_fields(
    database: Database, event_id: str, count: int, start: int = 0
) -> None:
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO event_form_fields
                (id,event_id,type,label,required,sort_order,active,created_at,updated_at)
                VALUES (:id,:event,'SHORT_TEXT',:label,true,:sort,true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            [
                {
                    "id": str(uuid4()),
                    "event": event_id,
                    "label": f"Поле {index}",
                    "sort": index,
                }
                for index in range(start, start + count)
            ],
        )


def test_health_and_security_foundation(client: TestClient) -> None:
    health = client.get("/health/ready")
    assert health.json() == {"status": "ready"}
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["x-frame-options"] == "DENY"
    database: Database = client.app.state.database
    config: Settings = client.app.state.settings
    bootstrap_test = client.app.state.bootstrap_test
    assert bootstrap_test["invitationHash"] == token_hash(
        bootstrap_test["rawActivation"]
    )
    assert bootstrap_test["rawActivation"] != bootstrap_test["invitationHash"]
    with database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM staff_users WHERE system_role='SUPER_ADMIN'"
                    " AND email_normalized='admin@example.com'"
                )
            ).scalar_one()
            == 1
        )
    with pytest.raises(SystemExit, match="already exists"):
        create_activation_token("other@example.com", database, config)
    unknown = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "missing@example.com", "password": "incorrect password"},
    )
    invalid = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "incorrect password"},
    )
    assert (unknown.status_code, unknown.json()["error"]["code"]) == (
        401,
        "INVALID_CREDENTIALS",
    )
    assert invalid.json()["error"]["code"] == "INVALID_CREDENTIALS"
    client.cookies.set("staff_session", "revoked-or-malformed-cookie")
    assert (
        client.post(
            "/auth/login",
            headers=ORIGIN,
            json={"email": "admin@example.com", "password": "correct horse battery"},
        ).status_code
        == 200
    )
    headers, raw_session = _login(client)
    with database.connect() as connection:
        stored = connection.execute(
            text("SELECT token_hash FROM sessions WHERE token_hash=:hash"),
            {"hash": token_hash(raw_session)},
        ).scalar_one()
    assert stored == token_hash(raw_session)
    assert raw_session != stored
    assert (
        client.post(
            "/admin/events", json={}, headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert client.post("/auth/logout", headers=ORIGIN).status_code == 403
    assert client.post("/auth/logout", headers=headers).status_code == 200
    assert client.get("/auth/session").status_code == 401


def test_production_configuration_hides_api_schema(database_url: str) -> None:
    from event_api.main import create_app

    config = Settings(
        database_url=database_url,
        node_env="production",
        cors_origins=["https://events.example.org", "https://scanner.example.org"],
        session_secret="s" * 43,
        auth_link_secret="a" * 43,
        auth_link_base_url="https://events.example.org/auth",
        qr_signing_secret="q" * 43,
        public_web_base_url="https://events.example.org",
        consent_url="https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf",
        privacy_policy_url="https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf",
        consent_version="2026-08-26",
        media_root=Path.cwd() / ".runtime" / "production-media-test",
    )
    with pytest.raises(ValueError, match="STARTTLS"):
        Settings.model_validate(
            {
                **config.model_dump(),
                "smtp_host": "smtp.example.org",
                "smtp_from_email": "noreply@example.org",
                "smtp_starttls": False,
            }
        )
    with TestClient(create_app(config)) as production:
        assert production.get("/docs").status_code == 404
        assert production.get("/openapi.json").status_code == 404
        response = production.get("/health")
        assert "max-age=31536000" in response.headers["strict-transport-security"]


def test_shared_rate_limiter_hides_identifiers(client: TestClient) -> None:
    database: Database = client.app.state.database
    config = client.app.state.settings.model_copy(
        update={"auth_rate_limit_max": 2, "auth_rate_limit_window_seconds": 60}
    )
    limiter = RateLimiter(config, database)
    limiter.consume("test-release", "person@example.org")
    limiter.consume("test-release", "person@example.org")
    with pytest.raises(ApiError) as caught:
        limiter.consume("test-release", "person@example.org")
    assert caught.value.status == 429
    with database.connect() as connection:
        keys = connection.execute(
            text("SELECT bucket_key FROM security_rate_limits")
        ).scalars()
    assert all("person@example.org" not in key for key in keys)


def test_domain_constraints_and_event_crud(client: TestClient) -> None:
    headers, _ = _login(client)
    payload = {
        "title": "Python MVP",
        "slug": "python-mvp",
        "description": "Integration event",
        "startAt": "2026-10-10T10:00:00Z",
        "endAt": "2026-10-10T12:00:00Z",
        "timezone": "Europe/Moscow",
        "location": "КАИТ №20",
        "registrationDeadline": "2026-10-09T10:00:00Z",
        "capacity": 100,
        "status": "DRAFT",
    }
    created = client.post("/admin/events", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    assert created.json()["direction"] is None
    cover = client.post(
        f"/admin/events/{event_id}/cover",
        headers=headers,
        files={"cover": ("cover.png", _tiny_png(), "image/png")},
    )
    assert cover.status_code == 200, cover.text
    cover_key = cover.json()["coverObjectKey"]
    assert client.get(f"/media/event-covers/{cover_key}").content.startswith(b"\x89PNG")
    invalid_cover = client.post(
        f"/admin/events/{event_id}/cover",
        headers=headers,
        files={"cover": ("cover.svg", b"<svg/>", "image/svg+xml")},
    )
    assert invalid_cover.status_code == 415
    assert client.get(f"/admin/events/{event_id}").status_code == 200
    field = client.post(
        f"/admin/events/{event_id}/form-fields",
        headers=headers,
        json={"type": "BOOLEAN", "label": "Согласие", "required": True, "sortOrder": 1},
    )
    assert field.status_code == 201, field.text
    assert (
        client.patch(
            f"/admin/events/{event_id}", headers=headers, json={"capacity": None}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/admin/events/{event_id}/form-fields/{field.json()['id']}",
            headers=headers,
            json={"label": None},
        ).status_code
        == 400
    )
    assert (
        client.delete(
            f"/admin/events/{event_id}/form-fields/{field.json()['id']}",
            headers=headers,
        ).status_code
        == 200
    )


def test_mysql_specific_invariants(client: TestClient) -> None:
    database: Database = client.app.state.database
    with database.connect() as connection:
        version = str(connection.execute(text("SELECT VERSION()")).scalar_one())
        tables = {row[0] for row in connection.execute(text("SHOW TABLES"))}
        columns = {
            row[0] for row in connection.execute(text("SHOW COLUMNS FROM sessions"))
        }
        person_type = (
            connection.execute(text("SHOW COLUMNS FROM persons LIKE 'person_type'"))
            .mappings()
            .one()
        )
        registration_type = (
            connection.execute(
                text("SHOW COLUMNS FROM registrations LIKE 'person_type'")
            )
            .mappings()
            .one()
        )
    assert version.startswith("8.1.0")
    assert {
        "persons",
        "events",
        "registrations",
        "attendance_events",
        "schema_migrations",
    } <= tables
    assert "token_hash" in columns and "token" not in columns
    assert "'PARENT'" in person_type["Type"] and "'OTHER'" in person_type["Type"]
    assert "'PARENT'" in registration_type["Type"]
    assert "'OTHER'" in registration_type["Type"]


def test_demo_seed_is_idempotent(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from event_api.config import get_settings

    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("DEMO_ADMIN_EMAIL", "demo-admin@example.com")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "demo admin safe password")
    monkeypatch.setenv("DEMO_SCANNER_EMAIL", "demo-scanner@example.com")
    monkeypatch.setenv("DEMO_SCANNER_PASSWORD", "demo scanner safe password")
    get_settings.cache_clear()
    try:
        seed_demo()
        seed_demo()
    finally:
        get_settings.cache_clear()
    database: Database = client.app.state.database
    with database.connect() as connection:
        event_count = connection.execute(
            text("SELECT count(*) FROM events WHERE slug='demo-event'")
        ).scalar_one()
        access_count = connection.execute(
            text("""SELECT count(*) FROM event_access a
            JOIN events e ON e.id=a.event_id JOIN staff_users u ON u.id=a.user_id
            WHERE e.slug='demo-event' AND u.email_normalized='demo-scanner@example.com'""")
        ).scalar_one()
    assert event_count == 1 and access_count == 1


def test_public_registration_and_idempotent_attendance(client: TestClient) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    with database.connect() as connection:
        event_id = connection.execute(
            text("SELECT id FROM events WHERE slug='python-mvp'")
        ).scalar_one()
    opened = client.patch(
        f"/admin/events/{event_id}",
        headers=headers,
        json={"status": "REGISTRATION_OPEN"},
    )
    assert opened.status_code == 200, opened.text
    client.cookies.clear()
    public_events = client.get("/public/events")
    assert public_events.status_code == 200
    assert any(item["slug"] == "python-mvp" for item in public_events.json()["items"])
    registration = client.post(
        "/public/events/python-mvp/register",
        headers=ORIGIN,
        json={
            "lastName": "Иванов",
            "firstName": "Иван",
            "middleName": "Иванович",
            "birthDate": "2005-03-15",
            "email": "participant@example.com",
            "phone": "+79991234567",
            "studyGroup": "ИС-21",
            "personType": "KAIT_STUDENT",
            "customAnswers": [],
            "consentAccepted": True,
            "consentVersion": "test-v1",
        },
    )
    assert registration.status_code == 201, registration.text
    public_event = client.get("/public/events/python-mvp")
    assert public_event.json()["consentUrl"] == str(
        client.app.state.settings.consent_url
    )
    assert public_event.json()["privacyPolicyUrl"] == str(
        client.app.state.settings.privacy_policy_url
    )
    repeated = client.post(
        "/public/events/python-mvp/register",
        headers=ORIGIN,
        json={
            "lastName": "Иванов",
            "firstName": "Иван",
            "middleName": "Иванович",
            "birthDate": "2005-03-15",
            "email": "participant@example.com",
            "phone": "+79991234567",
            "studyGroup": "ИС-21",
            "personType": "KAIT_STUDENT",
            "customAnswers": [],
            "consentAccepted": True,
            "consentVersion": "test-v1",
        },
    )
    assert repeated.status_code == 200
    assert repeated.json() == {
        "status": "ALREADY_REGISTERED",
        "recoveryQueued": True,
    }
    attempted_takeover = client.post(
        "/public/events/python-mvp/register",
        headers=ORIGIN,
        json={
            "lastName": "Иванов",
            "firstName": "Иван",
            "middleName": "Иванович",
            "birthDate": "2005-03-15",
            "email": "attacker@example.com",
            "phone": "+79990009999",
            "studyGroup": "ЧУЖАЯ-ГРУППА",
            "personType": "KAIT_STUDENT",
            "customAnswers": [],
            "consentAccepted": True,
            "consentVersion": "test-v1",
        },
    )
    assert attempted_takeover.status_code == 200
    assert attempted_takeover.json() == {
        "status": "ALREADY_REGISTERED",
        "recoveryQueued": True,
    }
    assert "ticketUrl" not in attempted_takeover.json()
    assert "registrationId" not in attempted_takeover.json()
    with database.connect() as connection:
        legal_record = connection.execute(
            text(
                "SELECT id,consent_url,privacy_policy_url FROM registrations WHERE event_id=:event AND status='ACTIVE'"
            ),
            {"event": event_id},
        ).one()
        registration_id = legal_record.id
        assert legal_record.consent_url == str(client.app.state.settings.consent_url)
        assert legal_record.privacy_policy_url == str(
            client.app.state.settings.privacy_policy_url
        )
        protected_snapshot = connection.execute(
            text(
                """SELECT r.email,r.phone,r.study_group,p.email,p.phone,p.study_group
                FROM registrations r JOIN persons p ON p.id=r.person_id WHERE r.id=:id"""
            ),
            {"id": registration_id},
        ).one()
        assert tuple(protected_snapshot) == (
            "participant@example.com",
            "+79991234567",
            "ИС-21",
            "participant@example.com",
            "+79991234567",
            "ИС-21",
        )
        ticket_recipients = connection.execute(
            text(
                "SELECT recipient_email FROM email_deliveries WHERE registration_id=:id"
            ),
            {"id": registration_id},
        ).scalars()
        assert set(ticket_recipients) == {"participant@example.com"}
    headers, _ = _login(client)
    client_event_id = str(uuid4())
    attendance = {
        "deviceId": str(uuid4()),
        "events": [
            {
                "clientEventId": client_event_id,
                "registrationId": registration_id,
                "mode": "MANUAL_CONFIRM",
                "source": "ONLINE",
                "deviceScannedAt": "2026-10-10T13:30:00.123456+03:00",
                "estimatedScannedAt": "2026-10-10T13:30:00.123456+03:00",
            }
        ],
    }
    accepted = client.post(
        f"/scanner/events/{event_id}/attendance/sync",
        headers=headers,
        json=attendance,
    )
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["results"][0]["status"] == "ACCEPTED"
    assert accepted.json()["results"][0]["firstAttendedAt"].startswith(
        "2026-10-10T10:30:00"
    )
    retried = client.post(
        f"/scanner/events/{event_id}/attendance/sync",
        headers=headers,
        json=attendance,
    )
    assert retried.json()["results"][0]["status"] == "ALREADY_PROCESSED"
    conflicting = client.post(
        f"/scanner/events/{event_id}/attendance/sync",
        headers=headers,
        json={**attendance, "deviceId": str(uuid4())},
    )
    assert conflicting.status_code == 201
    assert conflicting.json()["results"][0]["status"] == "CLIENT_EVENT_CONFLICT"
    naive_timestamp = client.post(
        f"/scanner/events/{event_id}/attendance/sync",
        headers=headers,
        json={
            "deviceId": str(uuid4()),
            "events": [
                {
                    **attendance["events"][0],
                    "clientEventId": str(uuid4()),
                    "deviceScannedAt": "2026-10-10T10:30:00",
                    "estimatedScannedAt": "2026-10-10T10:30:00",
                }
            ],
        },
    )
    assert naive_timestamp.status_code == 400


def test_scanner_invitation_and_event_access(client: TestClient) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    with database.connect() as connection:
        event_id = connection.execute(
            text("SELECT id FROM events WHERE slug='python-mvp'")
        ).scalar_one()
    invited = client.post(
        "/admin/staff/invitations",
        headers=headers,
        json={"email": "scanner@example.com", "eventId": event_id},
    )
    assert invited.status_code == 201, invited.text
    invitation_id = invited.json()["id"]
    with database.connect() as connection:
        record = (
            connection.execute(
                text(
                    "SELECT expires_at,token_hash FROM staff_invitations WHERE id=:id"
                ),
                {"id": invitation_id},
            )
            .mappings()
            .one()
        )
    token = auth_link_token(
        "invitation",
        invitation_id,
        record["expires_at"],
        client.app.state.settings.auth_link_secret,
    )
    assert token_hash(token) == record["token_hash"] and token != record["token_hash"]
    client.cookies.clear()
    accepted = client.post(
        f"/auth/invitations/{token}/accept",
        headers=ORIGIN,
        json={"password": "scanner secure password"},
    )
    assert accepted.status_code == 200, accepted.text
    assert (
        client.post(
            f"/auth/invitations/{token}/accept",
            headers=ORIGIN,
            json={"password": "scanner secure password"},
        ).status_code
        == 400
    )
    scanner_login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "scanner@example.com", "password": "scanner secure password"},
    )
    assert scanner_login.status_code == 200
    scanner_headers = {**ORIGIN, "X-CSRF-Token": scanner_login.json()["csrfToken"]}
    visible = client.get("/scanner/events")
    assert visible.status_code == 200
    assert any(item["id"] == event_id for item in visible.json()["items"])
    assert (
        client.post("/admin/events", headers=scanner_headers, json={}).status_code
        == 403
    )


def test_organizer_boundaries_archived_visibility_and_event_purge(
    client: TestClient,
) -> None:
    admin_headers, _ = _login(client)
    database: Database = client.app.state.database
    invited = client.post(
        "/admin/staff/invitations",
        headers=admin_headers,
        json={"email": "organizer@example.com", "role": "ORGANIZER"},
    )
    assert invited.status_code == 201, invited.text
    invitation_id = invited.json()["id"]
    with database.connect() as connection:
        invitation = (
            connection.execute(
                text(
                    "SELECT expires_at,token_hash FROM staff_invitations WHERE id=:id"
                ),
                {"id": invitation_id},
            )
            .mappings()
            .one()
        )
    token = auth_link_token(
        "invitation",
        invitation_id,
        invitation["expires_at"],
        client.app.state.settings.auth_link_secret,
    )
    assert token_hash(token) == invitation["token_hash"]
    client.cookies.clear()
    accepted = client.post(
        f"/auth/invitations/{token}/accept",
        headers=ORIGIN,
        json={"password": "organizer secure password"},
    )
    assert accepted.json() == {"status": "accepted", "role": "ORGANIZER"}
    logged_in = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={
            "email": "organizer@example.com",
            "password": "organizer secure password",
        },
    )
    assert logged_in.status_code == 200, logged_in.text
    organizer_headers = {
        **ORIGIN,
        "X-CSRF-Token": logged_in.json()["csrfToken"],
    }
    payload = {
        "title": "Удаляемое мероприятие",
        "slug": "purge-test-event",
        "description": "Проверка границ роли",
        "startAt": "2026-11-10T10:00:00Z",
        "endAt": "2026-11-10T12:00:00Z",
        "timezone": "Europe/Moscow",
        "location": "КАИТ №20",
        "registrationDeadline": "2026-11-09T10:00:00Z",
        "capacity": 10,
        "status": "REGISTRATION_OPEN",
    }
    created = client.post("/admin/events", headers=organizer_headers, json=payload)
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    forbidden_role = client.post(
        "/admin/staff/invitations",
        headers=organizer_headers,
        json={"email": "second-organizer@example.com", "role": "ORGANIZER"},
    )
    assert forbidden_role.status_code == 403
    scanner_invitation = client.post(
        "/admin/staff/invitations",
        headers=organizer_headers,
        json={
            "email": "organizer-scanner@example.com",
            "role": "SCANNER",
            "eventId": event_id,
        },
    )
    assert scanner_invitation.status_code == 201, scanner_invitation.text
    client.cookies.clear()
    registration = client.post(
        "/public/events/purge-test-event/register",
        headers=ORIGIN,
        json={
            "lastName": "Петров",
            "firstName": "Пётр",
            "birthDate": "2004-01-02",
            "email": "external-participant@example.com",
            "phone": "+79995554433",
            "studyGroup": "ЭТО ПОЛЕ НЕ ДОЛЖНО СОХРАНИТЬСЯ",
            "personType": "EXTERNAL_STUDENT",
            "organization": "Другая образовательная организация",
            "customAnswers": [],
            "consentAccepted": True,
            "consentVersion": "test-v1",
        },
    )
    assert registration.status_code == 201, registration.text
    with database.connect() as connection:
        person = (
            connection.execute(
                text(
                    "SELECT id,study_group FROM persons WHERE email_normalized=:email"
                ),
                {"email": "external-participant@example.com"},
            )
            .mappings()
            .one()
        )
    assert person["study_group"] is None
    organizer_login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={
            "email": "organizer@example.com",
            "password": "organizer secure password",
        },
    )
    assert organizer_login.status_code == 200
    organizer_headers = {
        **ORIGIN,
        "X-CSRF-Token": organizer_login.json()["csrfToken"],
    }
    people = client.get("/admin/people?query=external-participant@example.com")
    assert people.status_code == 200
    assert any(item["id"] == person["id"] for item in people.json()["items"])
    statistics = client.get(f"/admin/events/{event_id}/statistics")
    assert statistics.status_code == 200
    assert statistics.json()["registered"] == 1
    with database.connect() as connection:
        admin_id = connection.execute(
            text(
                "SELECT id FROM staff_users WHERE email_normalized='admin@example.com'"
            )
        ).scalar_one()
    protected_admin = client.post(
        f"/admin/staff/{admin_id}/deactivate", headers=organizer_headers
    )
    assert protected_admin.status_code == 403
    archived = client.post(
        f"/admin/events/{event_id}/archive", headers=organizer_headers
    )
    assert archived.status_code == 201, archived.text
    visible = client.get("/admin/events")
    assert all(item["id"] != event_id for item in visible.json()["items"])
    historical = client.get("/admin/events?includeArchived=true")
    assert any(item["id"] == event_id for item in historical.json()["items"])
    denied_purge = client.post(
        f"/admin/events/{event_id}/purge",
        headers=organizer_headers,
        json={"confirmationSlug": "purge-test-event"},
    )
    assert denied_purge.status_code == 403
    admin_headers, _ = _login(client)
    wrong_confirmation = client.post(
        f"/admin/events/{event_id}/purge",
        headers=admin_headers,
        json={"confirmationSlug": "wrong-slug"},
    )
    assert wrong_confirmation.status_code == 400
    purged = client.post(
        f"/admin/events/{event_id}/purge",
        headers=admin_headers,
        json={"confirmationSlug": "purge-test-event"},
    )
    assert purged.status_code == 200, purged.text
    with database.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM events WHERE id=:id"), {"id": event_id}
            ).scalar_one()
            == 0
        )
        assert (
            connection.execute(
                text("SELECT count(*) FROM persons WHERE id=:id"), {"id": person["id"]}
            ).scalar_one()
            == 1
        )


def test_purge_event_removes_cover_file(client: TestClient) -> None:
    headers, _ = _login(client)
    payload = {
        "title": "Удаляемое мероприятие с обложкой",
        "slug": "purge-cover-test-event",
        "description": "Проверка удаления обложки при purge",
        "startAt": "2026-11-11T10:00:00Z",
        "endAt": "2026-11-11T12:00:00Z",
        "timezone": "Europe/Moscow",
        "location": "КАИТ №20",
        "registrationDeadline": "2026-11-10T10:00:00Z",
        "capacity": 10,
        "status": "DRAFT",
    }
    created = client.post("/admin/events", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    cover = client.post(
        f"/admin/events/{event_id}/cover",
        headers=headers,
        files={"cover": ("cover.png", _tiny_png(), "image/png")},
    )
    assert cover.status_code == 200, cover.text
    cover_key = cover.json()["coverObjectKey"]
    assert client.get(f"/media/event-covers/{cover_key}").content.startswith(b"\x89PNG")
    archived = client.post(f"/admin/events/{event_id}/archive", headers=headers)
    assert archived.status_code == 201, archived.text
    purged = client.post(
        f"/admin/events/{event_id}/purge",
        headers=headers,
        json={"confirmationSlug": "purge-cover-test-event"},
    )
    assert purged.status_code == 200, purged.text
    assert client.get(f"/media/event-covers/{cover_key}").status_code == 404


def test_excel_preview_commit_and_safe_export(client: TestClient) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Проверка Excel",
            "slug": f"excel-import-{uuid4().hex[:12]}",
            "description": "Изолированный тест импорта и экспорта",
            "startAt": "2027-10-10T10:00:00Z",
            "endAt": "2027-10-10T12:00:00Z",
            "location": "КАИТ №20",
            "registrationDeadline": "2027-10-09T10:00:00Z",
            "capacity": 100,
            "status": "DRAFT",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    existing_person_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO persons
                (id,tenant_id,last_name,first_name,middle_name,birth_date,email,email_normalized,phone,phone_normalized,
                 person_type,organization,study_group,dedup_review_required,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001','Петрова','Анна','Сергеевна','1990-01-10',
                        'excel@example.com','excel@example.com',
                        '+79997654321','+79997654321','KAIT_TEACHER','КАИТ №20',NULL,FALSE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": existing_person_id},
        )
        custom_fields = [
            (str(uuid4()), "SHORT_TEXT", "Excel комментарий", None),
            (
                str(uuid4()),
                "SINGLE_CHOICE",
                "Excel направление",
                json.dumps(["ИТ", "Медиа"], ensure_ascii=False),
            ),
            (
                str(uuid4()),
                "MULTI_CHOICE",
                "Excel интересы",
                json.dumps(["Робототехника", "Дизайн"], ensure_ascii=False),
            ),
            (str(uuid4()), "BOOLEAN", "Excel подтверждение", None),
            (str(uuid4()), "LONG_TEXT", "Excel пожелания", None),
        ]
        for sort_order, (field_id, field_type, label, options) in enumerate(
            custom_fields, start=100
        ):
            connection.execute(
                text(
                    """INSERT INTO event_form_fields
                    (id,event_id,type,label,required,sort_order,options,active,created_at,updated_at,onsite_required)
                    VALUES (:id,:event,:type,:label,TRUE,:sort_order,:options,TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),TRUE)"""
                ),
                {
                    "id": field_id,
                    "event": event_id,
                    "type": field_type,
                    "label": label,
                    "sort_order": sort_order,
                    "options": options,
                },
            )
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(
        [
            "Фамилия",
            "Имя",
            "Отчество",
            "Дата рождения",
            "Тип участника",
            "Группа",
            "Организация",
            "Телефон",
            "Email",
            "Поле: Excel комментарий",
            "Поле: Excel направление",
            "Поле: Excel интересы",
            "Поле: Excel подтверждение",
            "Поле: Excel пожелания",
        ]
    )
    sheet.append(
        [
            "Петрова",
            "Анна",
            "Сергеевна",
            "1990-01-10",
            "KAIT_TEACHER",
            "",
            "КАИТ №20",
            "+79997654321",
            "excel@example.com",
            "Комментарий из Excel",
            "ИТ",
            "Робототехника; Дизайн",
            "Да",
            "Длинный ответ из Excel",
        ]
    )
    source = BytesIO()
    workbook.save(source)

    def offline_data_version() -> int:
        with database.connect() as connection:
            return int(
                connection.execute(
                    text("SELECT offline_data_version FROM events WHERE id=:id"),
                    {"id": event_id},
                ).scalar_one()
            )

    # D02: preview must not touch Scanner's cache-invalidation version at all.
    version_before_preview = offline_data_version()
    preview = client.post(
        f"/admin/events/{event_id}/import/preview",
        headers=headers,
        files={
            "file": (
                "participants.xlsx",
                source.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 201, preview.text
    assert preview.json()["summary"]["possibleMatchRows"] == 1
    assert preview.json()["rows"][0]["candidates"][0]["personId"] == existing_person_id
    assert offline_data_version() == version_before_preview
    commit = client.post(
        f"/admin/events/{event_id}/import/{preview.json()['importJobId']}/commit",
        headers=headers,
        json={
            "mapping": preview.json()["mapping"],
            "decisions": [{"rowNumber": 2, "action": "CREATE_NEW"}],
            "capacityOverride": False,
        },
    )
    assert commit.status_code == 200, commit.text
    assert commit.json()["importedRows"] == 1
    # A successful commit that actually created a Registration must bump the
    # version exactly once, atomically with the import itself.
    version_after_commit = offline_data_version()
    assert version_after_commit == version_before_preview + 1
    bundle = client.get(f"/scanner/events/{event_id}/offline-bundle", headers=headers)
    assert bundle.status_code == 200, bundle.text
    assert bundle.json()["version"] == str(version_after_commit)
    assert any(
        item["lastName"] == "Петрова" and item["firstName"] == "Анна"
        for item in bundle.json()["registrations"]
    )
    repeated = client.post(
        f"/admin/events/{event_id}/import/{preview.json()['importJobId']}/commit",
        headers=headers,
        json={"mapping": preview.json()["mapping"], "decisions": []},
    )
    assert repeated.status_code == 409
    # The rejected repeat must not be a second bump — existing idempotency
    # (a non-PREVIEW_READY job is refused before any write) already prevents
    # this; this only proves that guarantee still holds.
    assert offline_data_version() == version_after_commit
    with database.transaction() as connection:
        registration_id = connection.execute(
            text(
                "SELECT id FROM registrations WHERE event_id=:event AND email='excel@example.com'"
            ),
            {"event": event_id},
        ).scalar_one()
        registration_person_id = connection.execute(
            text("SELECT person_id FROM registrations WHERE id=:id"),
            {"id": registration_id},
        ).scalar_one()
        assert registration_person_id != existing_person_id
        assert bool(
            connection.execute(
                text("SELECT dedup_review_required FROM persons WHERE id=:id"),
                {"id": registration_person_id},
            ).scalar_one()
        )
        imported_answers = {
            row.field_label_snapshot: json.loads(row.answer)
            if isinstance(row.answer, str)
            else row.answer
            for row in connection.execute(
                text(
                    """SELECT field_label_snapshot,answer FROM registration_answers
                    WHERE registration_id=:registration"""
                ),
                {"registration": registration_id},
            )
        }
        assert imported_answers == {
            "Excel комментарий": "Комментарий из Excel",
            "Excel направление": "ИТ",
            "Excel интересы": ["Робототехника", "Дизайн"],
            "Excel подтверждение": True,
            "Excel пожелания": "Длинный ответ из Excel",
        }
        text_field_id = str(uuid4())
        choices_field_id = str(uuid4())
        connection.execute(
            text(
                """INSERT INTO event_form_fields
                (id,event_id,type,label,required,sort_order,options,active,created_at,updated_at,onsite_required)
                VALUES (:text_id,:event,'SHORT_TEXT','Комментарий',FALSE,10,NULL,FALSE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),FALSE),
                (:choices_id,:event,'MULTI_CHOICE','Интересы',FALSE,20,:options,TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),FALSE)"""
            ),
            {
                "text_id": text_field_id,
                "choices_id": choices_field_id,
                "event": event_id,
                "options": json.dumps(["Робототехника", "Дизайн"]),
            },
        )
        connection.execute(
            text(
                """INSERT INTO registration_answers
                (id,registration_id,field_id,field_label_snapshot,field_type_snapshot,answer,created_at,updated_at)
                VALUES (:first,:registration,:text_id,'Комментарий','SHORT_TEXT',:comment,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
                (:second,:registration,:choices_id,'Интересы','MULTI_CHOICE',:choices,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "first": str(uuid4()),
                "second": str(uuid4()),
                "registration": registration_id,
                "text_id": text_field_id,
                "choices_id": choices_field_id,
                "comment": json.dumps("=не формула", ensure_ascii=False),
                "choices": json.dumps(["Робототехника", "Дизайн"], ensure_ascii=False),
            },
        )
    exported = client.get(f"/admin/events/{event_id}/export.xlsx")
    assert exported.status_code == 200
    assert exported.content.startswith(b"PK")
    exported_workbook = load_workbook(BytesIO(exported.content), data_only=False)
    exported_sheet = exported_workbook["Участники"]
    exported_headers = [cell.value for cell in exported_sheet[1]]
    email_index = exported_headers.index("Email")
    exported_cells = next(
        row
        for row in exported_sheet.iter_rows(min_row=2)
        if row[email_index].value == "excel@example.com"
    )
    exported_row = {
        exported_headers[index]: cell.value for index, cell in enumerate(exported_cells)
    }
    assert exported_row["Поле: Комментарий"] == "'=не формула"
    assert exported_row["Поле: Интересы"] == "Робототехника; Дизайн"
    assert exported_row["Поле: Excel комментарий"] == "Комментарий из Excel"
    assert exported_row["Поле: Excel направление"] == "ИТ"
    assert exported_row["Поле: Excel интересы"] == "Робототехника; Дизайн"
    assert exported_row["Поле: Excel подтверждение"] == "Да"
    assert exported_row["Поле: Excel пожелания"] == "Длинный ответ из Excel"
    assert exported_row["Источник регистрации"] == "EXCEL_IMPORT"
    assert exported_row["Посетил мероприятие"] == "Нет"
    with database.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM import_job_files")
            ).scalar_one()
            == 0
        )
    archived = client.post(f"/admin/events/{event_id}/archive", headers=headers)
    assert archived.status_code == 201, archived.text
    assert client.get(f"/admin/events/{event_id}/export.xlsx").status_code == 200
    blocked_import = client.post(
        f"/admin/events/{event_id}/import/preview",
        headers=headers,
        files={
            "file": (
                "participants.xlsx",
                source.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert blocked_import.status_code == 409


def test_excel_commit_that_imports_nothing_does_not_bump_offline_data_version(
    client: TestClient,
) -> None:
    """D02: a commit can succeed (200, a valid result summary) while
    importing zero rows — every row was already registered. That batch
    changed nothing Scanner-visible, so it must not invalidate the cache."""
    headers, _ = _login(client)
    database: Database = client.app.state.database
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Импорт без изменений",
            "slug": f"excel-noop-{uuid4().hex[:12]}",
            "description": "Все строки уже зарегистрированы",
            "startAt": "2027-10-10T10:00:00Z",
            "endAt": "2027-10-10T12:00:00Z",
            "location": "КАИТ №20",
            "registrationDeadline": "2027-10-09T10:00:00Z",
            "capacity": 100,
            "status": "DRAFT",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    person_id = str(uuid4())
    registration_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO persons
                (id,tenant_id,last_name,first_name,middle_name,birth_date,email,email_normalized,phone,phone_normalized,
                 person_type,organization,study_group,dedup_review_required,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001','Сидоров','Олег',NULL,NULL,
                        'noop-import@example.com','noop-import@example.com',
                        NULL,NULL,'KAIT_TEACHER','КАИТ №20',NULL,FALSE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": person_id},
        )
        connection.execute(
            text(
                """INSERT INTO registrations
                (id,public_id,event_id,person_id,source,status,last_name,first_name,
                 email,person_type,organization,consent_accepted,registered_at,created_at,updated_at)
                VALUES (:id,:public,:event,:person,'ADMIN_MANUAL','ACTIVE','Сидоров','Олег',
                        'noop-import@example.com','KAIT_TEACHER','КАИТ №20',TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": registration_id,
                "public": str(uuid4()),
                "event": event_id,
                "person": person_id,
            },
        )
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(["Фамилия", "Имя", "Тип участника", "Email"])
    sheet.append(["Сидоров", "Олег", "KAIT_TEACHER", "noop-import@example.com"])
    source = BytesIO()
    workbook.save(source)

    def offline_data_version() -> int:
        with database.connect() as connection:
            return int(
                connection.execute(
                    text("SELECT offline_data_version FROM events WHERE id=:id"),
                    {"id": event_id},
                ).scalar_one()
            )

    version_before = offline_data_version()
    preview = client.post(
        f"/admin/events/{event_id}/import/preview",
        headers=headers,
        files={
            "file": (
                "participants.xlsx",
                source.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 201, preview.text
    assert preview.json()["summary"]["alreadyRegisteredRows"] == 1
    commit = client.post(
        f"/admin/events/{event_id}/import/{preview.json()['importJobId']}/commit",
        headers=headers,
        json={"mapping": preview.json()["mapping"], "decisions": []},
    )
    assert commit.status_code == 200, commit.text
    assert commit.json()["importedRows"] == 0
    assert commit.json()["duplicateRows"] == 1
    assert offline_data_version() == version_before


def test_stream_capacity_visibility_and_audience(client: TestClient) -> None:
    headers, _ = _login(client)
    event_payload = {
        "title": "Потоки собрания",
        "slug": "parent-streams",
        "location": "Колледж",
        "startAt": "2027-10-10T07:00:00Z",
        "endAt": "2027-10-10T17:00:00Z",
        "registrationDeadline": "2027-10-09T07:00:00Z",
        "capacity": 100,
        "status": "REGISTRATION_OPEN",
        "isListed": False,
        "allowedPersonTypes": ["PARENT"],
    }
    created = client.post("/admin/events", headers=headers, json=event_payload)
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    base = f"/admin/events/{event_id}"
    values = {
        "title": "Утренний",
        "startAt": "2027-10-10T07:00:00Z",
        "endAt": "2027-10-10T08:00:00Z",
        "capacity": 1,
    }
    first = client.post(f"{base}/streams", headers=headers, json=values)
    assert first.status_code == 201, first.text
    a = first.json()["id"]
    second = client.post(
        f"{base}/streams",
        headers=headers,
        json={
            **values,
            "title": "Дневной",
            "startAt": "2027-10-10T10:00:00Z",
            "endAt": "2027-10-10T11:00:00Z",
        },
    )
    assert second.status_code == 201, second.text
    b = second.json()["id"]
    assert client.get(base).json()["capacity"] == 2
    assert client.patch(base, headers=headers, json={"capacity": 3}).status_code == 409
    assert (
        client.post(
            f"{base}/streams",
            headers=headers,
            json={**values, "endAt": "2027-10-11T07:00:00Z"},
        ).status_code
        == 400
    )
    other = client.post(
        "/admin/events",
        headers=headers,
        json={**event_payload, "slug": "other-stream-event"},
    ).json()["id"]
    foreign = client.post(
        f"/admin/events/{other}/streams", headers=headers, json=values
    ).json()["id"]
    client.cookies.clear()
    catalogue = client.get("/public/events").json()["items"]
    assert not any(item["id"] == event_id for item in catalogue)
    public = client.get("/public/events/parent-streams")
    assert public.status_code == 200 and public.json()["streamsEnabled"]
    assert len(public.json()["streams"]) == 2
    assert public.headers["x-robots-tag"] == "noindex, nofollow"
    participant = {
        "lastName": "Потоков",
        "firstName": "Родитель",
        "birthDate": "1980-01-01",
        "email": "stream@example.com",
        "phone": "+79991234568",
        "personType": "PARENT",
        "consentAccepted": True,
        "consentVersion": "test-v1",
    }
    path = "/public/events/parent-streams/register"
    assert (
        client.post(path, headers=ORIGIN, json=participant).json()["error"]["code"]
        == "STREAM_REQUIRED"
    )
    assert (
        client.post(
            path, headers=ORIGIN, json={**participant, "streamId": foreign}
        ).json()["error"]["code"]
        == "STREAM_INVALID"
    )
    assert (
        client.post(
            path,
            headers=ORIGIN,
            json={**participant, "streamId": a, "personType": "OTHER"},
        ).json()["error"]["code"]
        == "PARTICIPANT_TYPE_NOT_ALLOWED"
    )
    registered = client.post(path, headers=ORIGIN, json={**participant, "streamId": a})
    assert registered.status_code == 201, registered.text
    assert (
        client.post(path, headers=ORIGIN, json={**participant, "streamId": a}).json()[
            "status"
        ]
        == "ALREADY_REGISTERED"
    )
    other_stream_repeat = client.post(
        path, headers=ORIGIN, json={**participant, "streamId": b}
    )
    assert other_stream_repeat.status_code == 200
    assert other_stream_repeat.json() == {
        "status": "ALREADY_REGISTERED",
        "recoveryQueued": True,
    }
    assert (
        client.post(
            path,
            headers=ORIGIN,
            json={**participant, "firstName": "Второй", "streamId": a},
        ).json()["error"]["code"]
        == "CAPACITY_FULL"
    )
    second_person = client.post(
        path, headers=ORIGIN, json={**participant, "firstName": "Второй", "streamId": b}
    )
    assert second_person.status_code == 201, second_person.text
    ticket_path = registered.json()["ticketUrl"].replace("http://localhost:5173", "")
    ticket = client.get(ticket_path).json()
    assert ticket["event"]["streamTitle"] == "Утренний"
    assert ticket["event"]["startAt"].startswith("2027-10-10T07:00:00")
    headers, _ = _login(client)
    disabled = client.patch(
        f"{base}/streams/{a}", headers=headers, json={**values, "active": False}
    )
    assert disabled.status_code == 200, disabled.text
    assert (
        client.get(ticket_path).status_code == 200
    )  # Closing bookings preserves tickets.
    assert len(client.get("/public/events/parent-streams").json()["streams"]) == 1
    # A composite FK prevents attaching a registration to another event's stream.
    with (
        client.app.state.database.transaction() as connection,
        pytest.raises(IntegrityError),
    ):
        connection.execute(
            text("UPDATE registrations SET stream_id=:stream WHERE id=:id"),
            {"stream": foreign, "id": registered.json()["registrationId"]},
        )
    # Existing r2 registrations cannot silently move into newly created streams.
    with client.app.state.database.connect() as connection:
        legacy = connection.execute(
            text("SELECT id FROM events WHERE slug='python-mvp'")
        ).scalar_one()
    legacy_values = {
        **values,
        "startAt": "2026-10-10T10:00:00Z",
        "endAt": "2026-10-10T11:00:00Z",
    }
    assert (
        client.post(
            f"/admin/events/{legacy}/streams", headers=headers, json=legacy_values
        ).json()["error"]["code"]
        == "STREAM_HISTORY_CONFLICT"
    )


def test_stream_race_scanner_override_and_report(client: TestClient) -> None:
    from event_api.main import create_app

    headers, _ = _login(client)
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Stream race",
            "slug": "stream-race",
            "location": "Колледж",
            "startAt": "2027-11-10T07:00:00Z",
            "endAt": "2027-11-10T17:00:00Z",
            "registrationDeadline": "2027-11-09T07:00:00Z",
            "capacity": 100,
            "status": "REGISTRATION_OPEN",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    stream_values = {
        "title": "Последнее место",
        "startAt": "2027-11-10T07:00:00Z",
        "endAt": "2027-11-10T08:00:00Z",
        "capacity": 1,
    }
    stream = client.post(
        f"/admin/events/{event_id}/streams", headers=headers, json=stream_values
    ).json()["id"]
    barrier = threading.Barrier(3)

    def submit(index: int) -> int:
        with TestClient(create_app(client.app.state.settings)) as visitor:
            barrier.wait(timeout=10)
            return visitor.post(
                "/public/events/stream-race/register",
                headers=ORIGIN,
                json={
                    "streamId": stream,
                    "lastName": f"Параллельный{index}",
                    "firstName": "Родитель",
                    "birthDate": "1980-01-01",
                    "email": f"race-stream-{index}@example.com",
                    "phone": f"+7999123457{index}",
                    "personType": "PARENT",
                    "consentAccepted": True,
                    "consentVersion": "test-v1",
                },
            ).status_code

    with ThreadPoolExecutor(max_workers=3) as pool:
        statuses = list(pool.map(submit, range(3)))
    assert sorted(statuses) == [201, 409, 409]
    with client.app.state.database.connect() as connection:
        scanner_id = connection.execute(
            text("SELECT id FROM staff_users WHERE email='scanner@example.com'")
        ).scalar_one()
    assigned = client.post(
        f"/admin/events/{event_id}/access", headers=headers, json={"userId": scanner_id}
    )
    assert assigned.status_code in {200, 201}, assigned.text
    client.cookies.clear()
    login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "scanner@example.com", "password": "scanner secure password"},
    )
    scanner_headers = {**ORIGIN, "X-CSRF-Token": login.json()["csrfToken"]}
    assert client.get(f"/scanner/events/{event_id}/streams").status_code == 200
    assert (
        client.post(
            f"/admin/events/{event_id}/streams",
            headers=scanner_headers,
            json=stream_values,
        ).status_code
        == 403
    )
    payload = {
        "streamId": stream,
        "lastName": "Сверхлимита",
        "consentAccepted": True,
        "firstName": "Родитель",
        "birthDate": "1980-02-02",
        "phone": "+79998887766",
        "personType": "PARENT",
    }
    path = f"/scanner/events/{event_id}/registrations/onsite"
    assert (
        client.post(path, headers=scanner_headers, json=payload).json()["error"]["code"]
        == "CAPACITY_FULL"
    )
    accepted = client.post(
        path, headers=scanner_headers, json={**payload, "capacityOverride": True}
    )
    assert accepted.status_code == 201, accepted.text
    with client.app.state.database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM registrations WHERE stream_id=:stream AND status='ACTIVE'"
                ),
                {"stream": stream},
            ).scalar_one()
            == 2
        )
        metadata = connection.execute(
            text(
                "SELECT metadata FROM audit_log WHERE action='ONSITE_REGISTRATION' AND entity_id=:id"
            ),
            {"id": accepted.json()["registrationId"]},
        ).scalar_one()
        assert '"capacityOverride": true' in str(metadata)
    headers, _ = _login(client)
    report = client.get(f"/admin/events/{event_id}/statistics").json()
    assert report["byStream"][0]["registered"] == 2
    assert report["overCapacity"] == 1
    assert (
        client.delete(
            f"/admin/events/{event_id}/access/{scanner_id}", headers=headers
        ).status_code
        == 200
    )
    client.cookies.clear()
    login = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "scanner@example.com", "password": "scanner secure password"},
    )
    scanner_headers = {**ORIGIN, "X-CSRF-Token": login.json()["csrfToken"]}
    assert client.get(f"/scanner/events/{event_id}/streams").status_code == 403
    assert (
        client.post(
            path, headers=scanner_headers, json={**payload, "capacityOverride": True}
        ).status_code
        == 403
    )


def test_invitation_resend_status_and_idempotency(client: TestClient) -> None:
    headers, _ = _login(client)
    response = client.post(
        "/admin/staff/invitations",
        headers=headers,
        json={"email": "retry-invitation@example.com", "role": "ORGANIZER"},
    )
    assert response.status_code == 201, response.text
    invitation_id = response.json()["id"]
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE email_deliveries SET status='FAILED',attempts=5,last_error_code='SMTP_451',updated_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE) WHERE staff_invitation_id=:id"
            ),
            {"id": invitation_id},
        )
    listed = client.get("/admin/staff/invitations").json()
    item = next(item for item in listed["items"] if item["id"] == invitation_id)
    assert item["deliveryStatus"] == "FAILED" and item["lastErrorCode"] == "SMTP_451"
    assert "token" not in str(item).lower()
    same = client.post(
        "/admin/staff/invitations",
        headers=headers,
        json={"email": "retry-invitation@example.com", "role": "ORGANIZER"},
    )
    assert same.json()["status"] == "failed"
    request = {"requestId": str(uuid4())}
    path = f"/admin/staff/invitations/{invitation_id}/resend"
    assert client.post(path, headers=headers, json=request).json()["status"] == "queued"
    assert client.post(path, headers=headers, json=request).json()["status"] == "queued"
    with client.app.state.database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(*) FROM email_deliveries WHERE staff_invitation_id=:id"
                ),
                {"id": invitation_id},
            ).scalar_one()
            == 2
        )


def test_registration_constructor_and_private_retry_receipts(
    client: TestClient,
) -> None:
    headers, _ = _login(client)
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Конструктор",
            "slug": "constructor-test",
            "location": "КАИТ",
            "startAt": "2027-10-10T07:00:00Z",
            "endAt": "2027-10-10T09:00:00Z",
            "registrationDeadline": "2027-10-09T07:00:00Z",
            "capacity": 100,
            "status": "REGISTRATION_OPEN",
        },
    )
    assert created.status_code == 201, created.text
    event = created.json()
    event_id = event["id"]
    base = f"/admin/events/{event_id}"
    path = "/public/events/constructor-test/register"
    config = event["formConfig"]
    assert all(field["mode"] == "OPTIONAL" for field in config["public"])
    payload = {
        "requestId": str(uuid4()),
        "firstName": "Без",
        "lastName": "Контактов",
        "consentAccepted": True,
        "consentVersion": client.app.state.settings.consent_version,
    }
    first = client.post(path, headers=headers, json=payload)
    assert first.status_code == 201, first.text
    repeat = client.post(path, headers=headers, json=payload)
    assert repeat.status_code == 200, repeat.text
    assert repeat.json() == {
        "status": "ALREADY_REGISTERED",
        "recoveryQueued": False,
    }
    assert (
        client.post(
            path, headers=headers, json={**payload, "firstName": "Подмена"}
        ).json()["error"]["code"]
        == "REQUEST_ALREADY_USED"
    )
    second = client.post(
        path, headers=headers, json={**payload, "requestId": str(uuid4())}
    )
    assert second.status_code == 201, second.text
    with client.app.state.database.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT COUNT(DISTINCT person_id) FROM registrations WHERE event_id=:id"
                ),
                {"id": event_id},
            ).scalar_one()
            == 2
        )
        receipts = connection.execute(
            text(
                "SELECT request_hash,payload_hash FROM registration_requests WHERE event_id=:id"
            ),
            {"id": event_id},
        ).all()
        assert len(receipts) == 2
        assert all(
            len(item.request_hash) == len(item.payload_hash) == 64
            and payload["requestId"] not in item.request_hash
            for item in receipts
        )
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM email_deliveries WHERE event_id=:id"),
                {"id": event_id},
            ).scalar_one()
            == 0
        )
    for change in [{"consentAccepted": False}, {"firstName": ""}, {"lastName": ""}]:
        assert (
            client.post(
                path,
                headers=headers,
                json={**payload, **change, "requestId": str(uuid4())},
            ).status_code
            == 400
        )
    assert (
        client.post(
            path,
            headers=headers,
            json={key: value for key, value in payload.items() if key != "requestId"},
        ).status_code
        == 400
    )
    # Mandatory fields are checked by the API, independently for each channel.
    config["onsite"] = [
        {**field, "mode": "REQUIRED" if field["key"] == "email" else field["mode"]}
        for field in config["onsite"]
    ]
    config["public"] = [
        {**field, "mode": "HIDDEN" if field["key"] == "phone" else field["mode"]}
        for field in config["public"]
    ]
    assert (
        client.patch(base, headers=headers, json={"formConfig": config}).status_code
        == 200
    )
    onsite = {key: value for key, value in payload.items() if key != "consentVersion"}
    assert (
        client.post(
            base + "/registrations/onsite", headers=headers, json=onsite
        ).status_code
        == 409
    )
    onsite["email"] = "constructor@example.com"
    assert (
        client.post(
            base + "/registrations/onsite", headers=headers, json=onsite
        ).status_code
        == 201
    )
    assert (
        client.post(
            base + "/registrations/onsite",
            headers=headers,
            json={**onsite, "consentAccepted": False},
        ).status_code
        == 400
    )
    assert (
        client.post(
            path,
            headers=headers,
            json={**payload, "requestId": str(uuid4()), "phone": "+79990000000"},
        ).json()["error"]["code"]
        == "FORM_VERSION_INVALID"
    )
    fields = client.get(f"/scanner/events/{event_id}/form-fields").json()
    assert fields["systemFields"] == config["onsite"]
    assert fields["allowedPersonTypes"] is None
    broken = {**config, "public": config["public"][:-1]}
    assert (
        client.patch(base, headers=headers, json={"formConfig": broken}).status_code
        == 400
    )
    field = client.post(
        base + "/form-fields",
        headers=headers,
        json={
            "label": "Ответ",
            "type": "BOOLEAN",
            "required": True,
            "onsiteRequired": False,
            "sortOrder": 0,
        },
    ).json()
    assert field["required"] is True and field["onsiteRequired"] is False
    no_answer = {**payload, "requestId": str(uuid4())}
    assert (
        client.post(path, headers=headers, json=no_answer).json()["error"]["code"]
        == "FORM_VERSION_INVALID"
    )
    answered = {
        **no_answer,
        "customAnswers": [{"fieldId": field["id"], "value": False}],
    }
    assert client.post(path, headers=headers, json=answered).status_code == 201
    assert (
        client.patch(
            base, headers=headers, json={"allowedPersonTypes": ["PARENT"]}
        ).status_code
        == 200
    )
    assert (
        client.post(
            path, headers=headers, json={**answered, "requestId": str(uuid4())}
        ).status_code
        == 409
    )
    assert (
        client.post(
            path,
            headers=headers,
            json={**answered, "requestId": str(uuid4()), "personType": "KAIT_STUDENT"},
        ).json()["error"]["code"]
        == "PARTICIPANT_TYPE_NOT_ALLOWED"
    )
    # r2 rows retain their previous requirements until an organiser changes them.
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE events SET form_config=NULL,allowed_person_types=NULL WHERE id=:id"
            ),
            {"id": event_id},
        )
    legacy = client.get("/public/events/constructor-test").json()["systemFields"]
    assert next(item for item in legacy if item["key"] == "phone")["mode"] == "REQUIRED"
    assert (
        client.post(
            path, headers=headers, json={**answered, "requestId": str(uuid4())}
        ).status_code
        == 409
    )


def test_form_field_creation_enforces_active_limit_and_exact_limit_submits(
    client: TestClient,
) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Лимит полей",
            "slug": "field-limit",
            "location": "КАИТ",
            "startAt": "2027-10-10T07:00:00Z",
            "endAt": "2027-10-10T09:00:00Z",
            "registrationDeadline": "2027-10-09T07:00:00Z",
            "capacity": 100,
            "status": "REGISTRATION_OPEN",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    _seed_active_fields(database, event_id, MAX_CUSTOM_ANSWERS - 1)
    exact = client.post(
        f"/admin/events/{event_id}/form-fields",
        headers=headers,
        json={
            "type": "SHORT_TEXT",
            "label": "Ровно на лимите",
            "required": True,
            "sortOrder": MAX_CUSTOM_ANSWERS - 1,
        },
    )
    assert exact.status_code == 201, exact.text
    over = client.post(
        f"/admin/events/{event_id}/form-fields",
        headers=headers,
        json={
            "type": "SHORT_TEXT",
            "label": "Сверх лимита",
            "required": False,
            "sortOrder": MAX_CUSTOM_ANSWERS,
        },
    )
    assert over.status_code == 409, over.text
    assert over.json()["error"]["code"] == "FORM_FIELD_LIMIT_EXCEEDED"
    with database.connect() as connection:
        active_total = connection.execute(
            text(
                "SELECT COUNT(*) FROM event_form_fields WHERE event_id=:id AND active=true"
            ),
            {"id": event_id},
        ).scalar_one()
    assert active_total == MAX_CUSTOM_ANSWERS
    fields = client.get(
        f"/admin/events/{event_id}/form-fields", headers=headers
    ).json()["items"]
    assert len(fields) == MAX_CUSTOM_ANSWERS
    answers = [{"fieldId": field["id"], "value": "ответ"} for field in fields]
    path = "/public/events/field-limit/register"
    payload = {
        "requestId": str(uuid4()),
        "firstName": "Полная",
        "lastName": "Форма",
        "consentAccepted": True,
        "consentVersion": client.app.state.settings.consent_version,
        "customAnswers": answers,
    }
    full = client.post(path, headers=headers, json=payload)
    assert full.status_code == 201, full.text
    overflowing = client.post(
        path,
        headers=headers,
        json={
            **payload,
            "requestId": str(uuid4()),
            "customAnswers": [*answers, {"fieldId": str(uuid4()), "value": "лишний"}],
        },
    )
    assert overflowing.status_code == 400, overflowing.text
    assert overflowing.json()["error"]["code"] == "VALIDATION_ERROR"


def test_form_field_edit_and_deactivate_remain_allowed_at_limit(
    client: TestClient,
) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Редактирование на лимите",
            "slug": "field-limit-edit",
            "location": "КАИТ",
            "startAt": "2027-10-10T07:00:00Z",
            "endAt": "2027-10-10T09:00:00Z",
            "registrationDeadline": "2027-10-09T07:00:00Z",
            "capacity": 10,
            "status": "REGISTRATION_OPEN",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    _seed_active_fields(database, event_id, MAX_CUSTOM_ANSWERS)
    fields = client.get(
        f"/admin/events/{event_id}/form-fields", headers=headers
    ).json()["items"]
    assert len(fields) == MAX_CUSTOM_ANSWERS
    target = fields[0]
    # Editing label/sortOrder/required of an existing active field never changes
    # the active count, so it must stay allowed even when the Event is at the
    # create limit — the check below only guards create.
    edited = client.patch(
        f"/admin/events/{event_id}/form-fields/{target['id']}",
        headers=headers,
        json={"label": "Отредактировано на лимите"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["label"] == "Отредактировано на лимите"
    blocked = client.post(
        f"/admin/events/{event_id}/form-fields",
        headers=headers,
        json={
            "type": "SHORT_TEXT",
            "label": "Ещё одно",
            "required": False,
            "sortOrder": MAX_CUSTOM_ANSWERS,
        },
    )
    assert blocked.status_code == 409, blocked.text
    deactivated = client.delete(
        f"/admin/events/{event_id}/form-fields/{target['id']}", headers=headers
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["active"] is False
    replacement = client.post(
        f"/admin/events/{event_id}/form-fields",
        headers=headers,
        json={
            "type": "SHORT_TEXT",
            "label": "Новое после отключения",
            "required": False,
            "sortOrder": MAX_CUSTOM_ANSWERS,
        },
    )
    assert replacement.status_code == 201, replacement.text
    with database.connect() as connection:
        active_total = connection.execute(
            text(
                "SELECT COUNT(*) FROM event_form_fields WHERE event_id=:id AND active=true"
            ),
            {"id": event_id},
        ).scalar_one()
    assert active_total == MAX_CUSTOM_ANSWERS


def test_legacy_over_limit_event_can_recover_but_not_grow(
    client: TestClient,
) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Легаси сверх лимита",
            "slug": "legacy-over-limit",
            "location": "КАИТ",
            "startAt": "2027-10-10T07:00:00Z",
            "endAt": "2027-10-10T09:00:00Z",
            "registrationDeadline": "2027-10-09T07:00:00Z",
            "capacity": 10,
            "status": "REGISTRATION_OPEN",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    # Simulates a form that already exceeds the new limit, e.g. created before
    # this invariant existed. The new check must never make such an Event's
    # form fully immutable — only block growth of the active count.
    _seed_active_fields(database, event_id, MAX_CUSTOM_ANSWERS + 5)
    fields = client.get(
        f"/admin/events/{event_id}/form-fields", headers=headers
    ).json()["items"]
    assert len(fields) == MAX_CUSTOM_ANSWERS + 5
    blocked = client.post(
        f"/admin/events/{event_id}/form-fields",
        headers=headers,
        json={
            "type": "SHORT_TEXT",
            "label": "Нельзя",
            "required": False,
            "sortOrder": 0,
        },
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "FORM_FIELD_LIMIT_EXCEEDED"
    edited = client.patch(
        f"/admin/events/{event_id}/form-fields/{fields[0]['id']}",
        headers=headers,
        json={"sortOrder": 999},
    )
    assert edited.status_code == 200, edited.text
    deactivated = client.delete(
        f"/admin/events/{event_id}/form-fields/{fields[0]['id']}", headers=headers
    )
    assert deactivated.status_code == 200, deactivated.text


def test_form_field_creation_race_does_not_exceed_limit(client: TestClient) -> None:
    from event_api.main import create_app

    headers, _ = _login(client)
    database: Database = client.app.state.database
    created = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Гонка полей",
            "slug": "field-limit-race",
            "location": "КАИТ",
            "startAt": "2027-10-10T07:00:00Z",
            "endAt": "2027-10-10T09:00:00Z",
            "registrationDeadline": "2027-10-09T07:00:00Z",
            "capacity": 10,
            "status": "REGISTRATION_OPEN",
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    _seed_active_fields(database, event_id, MAX_CUSTOM_ANSWERS - 1)
    barrier = threading.Barrier(2)

    # Each racer logs in on its own connection *before* the barrier: two
    # concurrent logins for the same staff_users row can themselves deadlock
    # in MySQL, which would test the login path's locking, not create_field's.
    # Only the create_field POST itself — the thing under test — runs behind
    # the barrier.
    with ExitStack() as stack:
        staff_clients = [
            stack.enter_context(TestClient(create_app(client.app.state.settings)))
            for _ in range(2)
        ]
        race_headers = [_login(staff_client)[0] for staff_client in staff_clients]

        def attempt(index: int) -> int:
            barrier.wait(timeout=10)
            return (
                staff_clients[index]
                .post(
                    f"/admin/events/{event_id}/form-fields",
                    headers=race_headers[index],
                    json={
                        "type": "SHORT_TEXT",
                        "label": f"Гонка {index}",
                        "required": False,
                        "sortOrder": MAX_CUSTOM_ANSWERS + index,
                    },
                )
                .status_code
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(attempt, range(2)))
    assert sorted(statuses) == [201, 409]
    with database.connect() as connection:
        active_total = connection.execute(
            text(
                "SELECT COUNT(*) FROM event_form_fields WHERE event_id=:id AND active=true"
            ),
            {"id": event_id},
        ).scalar_one()
    assert active_total == MAX_CUSTOM_ANSWERS


def test_live_event_status_and_closed_catalogue(client: TestClient) -> None:
    from datetime import UTC, datetime, timedelta

    headers, _ = _login(client)
    now = datetime.now(UTC).replace(microsecond=0)
    payload = {
        "title": "Статусы",
        "slug": "live-status-test",
        "location": "КАИТ",
        "capacity": 10,
        "startAt": (now + timedelta(hours=1)).isoformat(),
        "endAt": (now + timedelta(hours=2)).isoformat(),
        "registrationDeadline": (now + timedelta(minutes=30)).isoformat(),
        "status": "REGISTRATION_OPEN",
    }
    created = client.post("/admin/events", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    base = f"/admin/events/{event_id}"
    public = "/public/events/live-status-test"
    assert client.get(public).json()["effectiveStatus"] == "REGISTRATION_OPEN"
    assert client.get(public).headers["cache-control"] == "no-store"
    for dates, status in [
        (
            {"registrationDeadline": (now - timedelta(seconds=1)).isoformat()},
            "REGISTRATION_CLOSED",
        ),
        ({"startAt": (now - timedelta(seconds=1)).isoformat()}, "ACTIVE"),
        ({"endAt": now.isoformat()}, "COMPLETED"),
    ]:
        assert client.patch(base, headers=headers, json=dates).status_code == 200
        actual = client.get(public).json()
        assert actual["effectiveStatus"] == status
        assert actual["availability"] == "CLOSED"
        assert client.get(base).json()["effectiveStatus"] == status
        assert (
            client.get(base).json()["status"] == "REGISTRATION_OPEN"
        )  # operator intent is not rewritten
        visible = [item["id"] for item in client.get("/public/events").json()["items"]]
        assert (event_id in visible) == (status != "COMPLETED")
        rejected = client.post(
            public + "/register",
            headers=headers,
            json={
                "requestId": str(uuid4()),
                "firstName": "Тест",
                "lastName": "Срок",
                "consentAccepted": True,
                "consentVersion": client.app.state.settings.consent_version,
            },
        )
        assert rejected.json()["error"]["code"] == "REGISTRATION_CLOSED"
    hidden = client.post(
        "/admin/events",
        headers=headers,
        json={**payload, "slug": "hidden-draft-status", "status": "DRAFT"},
    ).json()
    assert client.get("/public/events/hidden-draft-status").status_code == 404
    assert hidden["id"] not in [
        item["id"] for item in client.get("/public/events").json()["items"]
    ]


def test_password_reset_is_one_time_and_revokes_sessions(client: TestClient) -> None:
    headers, raw_session = _login(client)
    forgot = client.post(
        "/auth/password/forgot",
        headers=headers,
        json={"email": "admin@example.com"},
    )
    assert forgot.status_code == 202
    database: Database = client.app.state.database
    with database.connect() as connection:
        record = (
            connection.execute(
                text(
                    "SELECT id,expires_at,token_hash FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    token = auth_link_token(
        "password-reset",
        record["id"],
        record["expires_at"],
        client.app.state.settings.auth_link_secret,
    )
    assert token_hash(token) == record["token_hash"] and token != record["token_hash"]
    reset = client.post(
        "/auth/password/reset",
        headers=headers,
        json={"token": token, "password": "new correct horse battery"},
    )
    assert reset.status_code == 200, reset.text
    assert client.get("/auth/session").status_code == 401
    assert (
        client.post(
            "/auth/password/reset",
            headers=headers,
            json={"token": token, "password": "another correct password"},
        ).status_code
        == 400
    )
    with database.connect() as connection:
        revoked = connection.execute(
            text("SELECT revoked_at FROM sessions WHERE token_hash=:hash"),
            {"hash": token_hash(raw_session)},
        ).scalar_one()
    assert revoked is not None
    # The shared session-scoped client fixture logs in as admin@example.com with
    # "correct horse battery" for the rest of the suite; restore it since this test
    # just changed it in the real database, not a per-test transaction.
    with database.transaction() as connection:
        connection.execute(
            text(
                "UPDATE staff_users SET password_hash=:password WHERE email_normalized='admin@example.com'"
            ),
            {"password": hash_password("correct horse battery")},
        )


def test_repeated_forgot_password_does_not_invalidate_pending_link(
    client: TestClient,
) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    first = client.post(
        "/auth/password/forgot",
        headers=headers,
        json={"email": "admin@example.com"},
    )
    assert first.status_code == 202
    with database.connect() as connection:
        first_record = (
            connection.execute(
                text(
                    "SELECT id,token_hash FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    second = client.post(
        "/auth/password/forgot",
        headers=headers,
        json={"email": "admin@example.com"},
    )
    assert second.status_code == 202
    with database.connect() as connection:
        second_record = (
            connection.execute(
                text(
                    "SELECT id,token_hash,used_at FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    assert second_record["id"] == first_record["id"]
    assert second_record["token_hash"] == first_record["token_hash"]
    assert second_record["used_at"] is None


def test_email_worker_sends_durable_intent_without_persisting_link(
    client: TestClient,
) -> None:
    database: Database = client.app.state.database
    config = client.app.state.settings.model_copy(
        update={
            "smtp_host": "smtp.example.test",
            "smtp_from_email": "noreply@example.test",
        }
    )
    captured: list[str] = []

    def fake_sender(message: object, _config: Settings) -> str:
        captured.append(str(message))
        return "provider-test-id"

    assert process_once(database, config, fake_sender) == 1
    assert captured and "provider-test-id" not in captured[0]
    with database.connect() as connection:
        delivery = (
            connection.execute(
                text(
                    "SELECT status,provider_message_id FROM email_deliveries WHERE status='SENT' ORDER BY sent_at DESC LIMIT 1"
                )
            )
            .mappings()
            .one()
        )
    assert delivery == {"status": "SENT", "provider_message_id": "provider-test-id"}


def test_email_worker_main_recovers_from_transient_failure(
    client: TestClient,
) -> None:
    from event_api import email_worker

    config = client.app.state.settings.model_copy(
        update={
            "smtp_host": "smtp.example.test",
            "smtp_from_email": "noreply@example.test",
        }
    )

    class StopWorker(BaseException):
        """Escapes main()'s `except Exception` on purpose to end the test."""

    calls = 0

    def fake_process_once(_database: Database, _config: Settings) -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("simulated transient database outage")
        if calls == 2:
            return 1
        raise StopWorker

    sleeps: list[float] = []

    with (
        patch.object(email_worker, "get_settings", return_value=config),
        patch.object(email_worker, "process_once", side_effect=fake_process_once),
        patch.object(email_worker.time, "sleep", side_effect=sleeps.append),
        pytest.raises(StopWorker),
    ):
        email_worker.main()

    assert calls == 3
    assert sleeps, "worker must back off after a transient failure instead of dying"


def test_parallel_email_workers_claim_each_delivery_once(client: TestClient) -> None:
    database: Database = client.app.state.database
    delivery_ids = [str(uuid4()) for _ in range(24)]
    with database.transaction() as connection:
        context = (
            connection.execute(
                text(
                    """SELECT event_id,id AS registration_id,email AS email_snapshot
                       FROM registrations ORDER BY created_at LIMIT 1"""
                )
            )
            .mappings()
            .one()
        )
        connection.execute(
            text(
                """INSERT INTO email_deliveries
                   (id,idempotency_key,type,recipient_email,event_id,registration_id,
                    status,attempts,queued_at,created_at,updated_at)
                   VALUES (:id,:key,'REGISTRATION_TICKET',:recipient,:event,:registration,
                           'QUEUED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            [
                {
                    "id": delivery_id,
                    "key": f"parallel-claim:{delivery_id}",
                    "recipient": context["email_snapshot"],
                    "event": context["event_id"],
                    "registration": context["registration_id"],
                }
                for delivery_id in delivery_ids
            ],
        )

    config = client.app.state.settings.model_copy(
        update={
            "smtp_host": "smtp.example.test",
            "smtp_from_email": "noreply@example.test",
        }
    )
    sent: Counter[str] = Counter()
    lock = threading.Lock()

    def sender(message: EmailMessage, _config: Settings) -> str:
        identifier = str(message["Message-ID"])
        with lock:
            sent[identifier] += 1
        return identifier

    def drain() -> None:
        while process_once(database, config, sender):
            pass

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda _: drain(), range(8)))

    for delivery_id in delivery_ids:
        assert sent[f"<{delivery_id}@event-registration>"] == 1


def _smtp_config(client: TestClient) -> Settings:
    return client.app.state.settings.model_copy(
        update={
            "smtp_host": "smtp.example.test",
            "smtp_from_email": "noreply@example.test",
        }
    )


def test_a_worker_sends_a_still_current_password_reset(client: TestClient) -> None:
    database: Database = client.app.state.database
    with database.connect() as connection:
        admin_id = connection.execute(
            text(
                "SELECT id FROM staff_users WHERE email_normalized='admin@example.com'"
            )
        ).scalar_one()
    reset_id, delivery_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at)
                   VALUES (:id,:user,:hash,:expires,UTC_TIMESTAMP(3))"""
            ),
            {
                "id": reset_id,
                "user": admin_id,
                "hash": f"hash-{reset_id}",
                "expires": datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            },
        )
        connection.execute(
            text(
                """INSERT INTO email_deliveries
                   (id,idempotency_key,type,recipient_email,staff_user_id,password_reset_token_id,
                    status,attempts,queued_at,created_at,updated_at)
                   VALUES (:id,:key,'PASSWORD_RESET',:email,:user,:reset,'QUEUED',0,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": delivery_id,
                "key": f"test-valid-reset:{delivery_id}",
                "email": "admin@example.com",
                "user": admin_id,
                "reset": reset_id,
            },
        )
    target_message_id = f"<{delivery_id}@event-registration>"
    calls: list[str] = []

    def sender(message: EmailMessage, _config: Settings) -> str:
        # The shared session-scoped queue can still hold older, unrelated
        # rows left QUEUED by earlier tests; only count/verify the target.
        calls.append(str(message["Message-ID"]))
        return "provider-id"

    for _ in range(50):
        with database.connect() as connection:
            attempts = connection.execute(
                text("SELECT attempts FROM email_deliveries WHERE id=:id"),
                {"id": delivery_id},
            ).scalar_one()
        if attempts > 0:
            break
        if not process_once(database, _smtp_config(client), sender):
            pytest.fail("target delivery was never claimed")
    assert target_message_id in calls
    with database.connect() as connection:
        outcome = (
            connection.execute(
                text(
                    "SELECT status,last_error_code FROM email_deliveries WHERE id=:id"
                ),
                {"id": delivery_id},
            )
            .mappings()
            .one()
        )
    assert outcome == {"status": "SENT", "last_error_code": None}


def test_worker_cancels_an_already_used_reset_token_without_calling_smtp(
    client: TestClient,
) -> None:
    """Backstop path: the row is still QUEUED (as if the worker discovered
    this independently of any proactive router-side cancellation) and its
    token has genuinely been used by the account owner, with no newer token
    superseding it."""
    database: Database = client.app.state.database
    with database.connect() as connection:
        admin_id = connection.execute(
            text(
                "SELECT id FROM staff_users WHERE email_normalized='admin@example.com'"
            )
        ).scalar_one()
    reset_id, delivery_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,used_at,created_at)
                   VALUES (:id,:user,:hash,:expires,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": reset_id,
                "user": admin_id,
                "hash": f"hash-{reset_id}",
                "expires": datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            },
        )
        connection.execute(
            text(
                """INSERT INTO email_deliveries
                   (id,idempotency_key,type,recipient_email,staff_user_id,password_reset_token_id,
                    status,attempts,queued_at,created_at,updated_at)
                   VALUES (:id,:key,'PASSWORD_RESET',:email,:user,:reset,'QUEUED',0,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": delivery_id,
                "key": f"test-used-reset:{delivery_id}",
                "email": "admin@example.com",
                "user": admin_id,
                "reset": reset_id,
            },
        )
    target_message_id = f"<{delivery_id}@event-registration>"
    calls: list[str] = []

    def sender(message: EmailMessage, _config: Settings) -> str:
        # Recording every call (not just the target's) is the point: if the
        # invalidated intent's message ever reaches here, that is the bug
        # this test exists to catch.
        calls.append(str(message["Message-ID"]))
        return "drained-unrelated-delivery"

    for _ in range(50):
        with database.connect() as connection:
            attempts = connection.execute(
                text("SELECT attempts FROM email_deliveries WHERE id=:id"),
                {"id": delivery_id},
            ).scalar_one()
        if attempts > 0:
            break
        if not process_once(database, _smtp_config(client), sender):
            pytest.fail("target delivery was never claimed")
    assert target_message_id not in calls, (
        "SMTP must not be invoked for an invalidated intent"
    )
    with database.connect() as connection:
        outcome = (
            connection.execute(
                text(
                    "SELECT status,last_error_code,next_attempt_at,attempts FROM email_deliveries WHERE id=:id"
                ),
                {"id": delivery_id},
            )
            .mappings()
            .one()
        )
    assert outcome["status"] == "CANCELLED"
    assert outcome["last_error_code"] == "RESET_TOKEN_USED"
    assert outcome["next_attempt_at"] is None, "a cancelled row must not be retried"
    # F: a further poll must not rediscover or re-process the cancelled row —
    # its own attempts/status must stay exactly as they are, regardless of
    # whether process_once finds and drains some unrelated queued row.
    process_once(database, _smtp_config(client), sender)
    with database.connect() as connection:
        unchanged = (
            connection.execute(
                text("SELECT status,attempts FROM email_deliveries WHERE id=:id"),
                {"id": delivery_id},
            )
            .mappings()
            .one()
        )
    assert unchanged == {"status": "CANCELLED", "attempts": outcome["attempts"]}
    assert target_message_id not in calls


def test_b_forgot_password_proactively_cancels_the_superseded_reset_email(
    client: TestClient,
) -> None:
    """Router-side path: a second forgot-password request outside the
    coalescing cooldown supersedes the first token; the first token's still
    queued email must be cancelled in the same transaction, without waiting
    for the worker."""
    headers, _ = _login(client)
    database: Database = client.app.state.database
    with database.connect() as connection:
        admin_id = connection.execute(
            text(
                "SELECT id FROM staff_users WHERE email_normalized='admin@example.com'"
            )
        ).scalar_one()
    old_reset_id, old_delivery_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        # Clear any unused token left over from another test sharing this
        # same bootstrapped admin user — otherwise forgot_password's own
        # cooldown-coalesce could find that one "recent" and return early
        # without ever reaching the supersede path this test targets.
        connection.execute(
            text(
                "UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP(3) WHERE user_id=:id AND used_at IS NULL"
            ),
            {"id": admin_id},
        )
        connection.execute(
            text(
                """INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at)
                   VALUES (:id,:user,:hash,:expires,:created)"""
            ),
            {
                "id": old_reset_id,
                "user": admin_id,
                "hash": f"hash-{old_reset_id}",
                "expires": datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
                # Backdated past PASSWORD_RESET_COOLDOWN_SECONDS so the next
                # request below genuinely supersedes it instead of coalescing.
                "created": datetime.now(UTC).replace(tzinfo=None)
                - timedelta(minutes=5),
            },
        )
        connection.execute(
            text(
                """INSERT INTO email_deliveries
                   (id,idempotency_key,type,recipient_email,staff_user_id,password_reset_token_id,
                    status,attempts,queued_at,created_at,updated_at)
                   VALUES (:id,:key,'PASSWORD_RESET',:email,:user,:reset,'QUEUED',0,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": old_delivery_id,
                "key": f"test-supersede:{old_delivery_id}",
                "email": "admin@example.com",
                "user": admin_id,
                "reset": old_reset_id,
            },
        )
    response = client.post(
        "/auth/password/forgot",
        headers=headers,
        json={"email": "admin@example.com"},
    )
    assert response.status_code == 202
    with database.connect() as connection:
        outcome = (
            connection.execute(
                text(
                    "SELECT status,last_error_code FROM email_deliveries WHERE id=:id"
                ),
                {"id": old_delivery_id},
            )
            .mappings()
            .one()
        )
    assert outcome == {
        "status": "CANCELLED",
        "last_error_code": "RESET_TOKEN_SUPERSEDED",
    }


def test_h_annulling_a_registration_proactively_cancels_its_queued_ticket_email(
    client: TestClient,
) -> None:
    headers, _ = _login(client)
    database: Database = client.app.state.database
    with database.connect() as connection:
        registration = (
            connection.execute(
                text(
                    """SELECT id,event_id,email FROM registrations
                       WHERE status='ACTIVE' AND email IS NOT NULL LIMIT 1"""
                )
            )
            .mappings()
            .one()
        )
    delivery_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO email_deliveries
                   (id,idempotency_key,type,recipient_email,event_id,registration_id,
                    status,attempts,queued_at,created_at,updated_at)
                   VALUES (:id,:key,'REGISTRATION_TICKET',:email,:event,:registration,'QUEUED',0,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": delivery_id,
                "key": f"test-annul-cancel:{delivery_id}",
                "email": registration["email"],
                "event": registration["event_id"],
                "registration": registration["id"],
            },
        )
    response = client.post(
        f"/admin/events/{registration['event_id']}/registrations/{registration['id']}/annul",
        headers=headers,
    )
    assert response.status_code == 201
    with database.connect() as connection:
        outcome = (
            connection.execute(
                text(
                    "SELECT status,last_error_code FROM email_deliveries WHERE id=:id"
                ),
                {"id": delivery_id},
            )
            .mappings()
            .one()
        )
    assert outcome == {
        "status": "CANCELLED",
        "last_error_code": "REGISTRATION_CANCELLED",
    }


def test_e_transient_smtp_failure_for_a_valid_intent_still_retries(
    client: TestClient,
) -> None:
    database: Database = client.app.state.database
    with database.connect() as connection:
        admin_id = connection.execute(
            text(
                "SELECT id FROM staff_users WHERE email_normalized='admin@example.com'"
            )
        ).scalar_one()
    reset_id, delivery_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at)
                   VALUES (:id,:user,:hash,:expires,UTC_TIMESTAMP(3))"""
            ),
            {
                "id": reset_id,
                "user": admin_id,
                "hash": f"hash-{reset_id}",
                "expires": datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            },
        )
        connection.execute(
            text(
                """INSERT INTO email_deliveries
                   (id,idempotency_key,type,recipient_email,staff_user_id,password_reset_token_id,
                    status,attempts,queued_at,created_at,updated_at)
                   VALUES (:id,:key,'PASSWORD_RESET',:email,:user,:reset,'QUEUED',0,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": delivery_id,
                "key": f"test-transient-failure:{delivery_id}",
                "email": "admin@example.com",
                "user": admin_id,
                "reset": reset_id,
            },
        )

    target_message_id = f"<{delivery_id}@event-registration>"

    def selective_failing_sender(message: EmailMessage, _config: Settings) -> str:
        # The shared session-scoped queue can hold older, unrelated rows
        # left QUEUED by earlier tests; _claim's FIFO order might hand this
        # call one of those instead of the row this test just inserted. Only
        # the target delivery should fail — anything else is drained
        # harmlessly so the loop below reliably reaches it.
        if str(message["Message-ID"]) == target_message_id:
            raise TimeoutError("simulated transient SMTP outage")
        return "drained-unrelated-delivery"

    for _ in range(50):
        with database.connect() as connection:
            attempts = connection.execute(
                text("SELECT attempts FROM email_deliveries WHERE id=:id"),
                {"id": delivery_id},
            ).scalar_one()
        if attempts > 0:
            break
        if not process_once(database, _smtp_config(client), selective_failing_sender):
            pytest.fail("target delivery was never claimed")
    with database.connect() as connection:
        outcome = (
            connection.execute(
                text(
                    "SELECT status,last_error_code,next_attempt_at FROM email_deliveries WHERE id=:id"
                ),
                {"id": delivery_id},
            )
            .mappings()
            .one()
        )
    assert outcome["status"] == "QUEUED"
    assert outcome["last_error_code"] == "TIMEOUTERROR"
    assert outcome["next_attempt_at"] is not None, "a transient failure must be retried"
