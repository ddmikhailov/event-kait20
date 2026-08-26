from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Request, UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import text
from starlette.datastructures import Headers

from event_api.config import Settings
from event_api.database import Database
from event_api.errors import ApiError, unexpected_error_handler
from event_api.routers.excel import MAX_FILE, XLSX_MIME, _parse, _validate_upload
from event_api.security import (
    auth_link_token,
    hash_password,
    registration_qr,
    token_hash,
    verify_auth_link,
    verify_registration,
)


def test_signed_links_are_bound_to_purpose_and_reject_tampering() -> None:
    record_id = str(uuid4())
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=15)
    secret = "a" * 43
    invitation = auth_link_token("invitation", record_id, expires_at, secret)
    stored_hash = token_hash(invitation)

    assert verify_auth_link(
        invitation, "invitation", record_id, expires_at, stored_hash, secret
    )
    assert not verify_auth_link(
        invitation, "password-reset", record_id, expires_at, stored_hash, secret
    )
    assert not verify_auth_link(
        f"{invitation}x", "invitation", record_id, expires_at, stored_hash, secret
    )


def test_registration_qr_contains_no_participant_data_and_rejects_tampering() -> None:
    public_id = str(uuid4())
    secret = "q" * 43
    payload = registration_qr(public_id, secret)
    identifier, signature = payload.split(".", maxsplit=1)

    assert identifier == public_id
    assert "participant@example.org" not in payload
    assert "+79991234567" not in payload
    assert verify_registration(public_id, signature, secret)
    assert not verify_registration(public_id, f"{signature}x", secret)
    assert not verify_registration(str(uuid4()), signature, secret)


def test_excel_rejects_wrong_extension_mime_and_oversized_content() -> None:
    for filename, content_type in [
        ("participants.xlsm", XLSX_MIME),
        ("participants.xlsx", "application/octet-stream"),
        ("participants.xlsx.exe", XLSX_MIME),
    ]:
        upload = UploadFile(
            file=BytesIO(b"PK"),
            filename=filename,
            headers=Headers({"content-type": content_type}),
        )
        with pytest.raises(ApiError, match="Only an XLSX"):
            _validate_upload(upload)
    with pytest.raises(ApiError, match="up to 5 MiB"):
        _parse(b"PK" + b"0" * MAX_FILE)


def test_unexpected_error_logging_uses_route_template_and_redacts_details(
    caplog,
) -> None:  # type: ignore[no-untyped-def]
    leaked = "participant@example.org password=DoNotLogMe"
    scope = {
        "type": "http",
        "method": "GET",
        "scheme": "https",
        "path": "/tickets/private-id/private-signature",
        "raw_path": b"/tickets/private-id/private-signature",
        "query_string": b"token=private-token",
        "headers": [(b"cookie", b"staff_session=private-session")],
        "client": ("127.0.0.1", 12345),
        "server": ("api.example.org", 443),
        "route": SimpleNamespace(path="/tickets/{public_id}/{signature}"),
    }
    request = Request(scope)
    with caplog.at_level(logging.ERROR, logger="event_api"):
        response = asyncio.run(unexpected_error_handler(request, RuntimeError(leaked)))

    log = caplog.text
    body = json.loads(response.body)
    assert response.status_code == 500
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert body["error"]["message"] == "Request could not be completed"
    assert "/tickets/{public_id}/{signature}" in log
    for sensitive in [
        leaked,
        "participant@example.org",
        "DoNotLogMe",
        "private-id",
        "private-signature",
        "private-token",
        "private-session",
    ]:
        assert sensitive not in log
        assert sensitive not in response.body.decode()


def test_production_login_cookie_is_secure(
    client: TestClient, database_url: str
) -> None:
    from event_api.main import create_app

    email = f"release-cookie-{uuid4()}@example.org"
    password = "production cookie password"  # noqa: S105 - synthetic test value
    database: Database = client.app.state.database
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO staff_users
                   (id,email,email_normalized,password_hash,system_role,active,
                    password_changed_at,created_at,updated_at)
                   VALUES (:id,:email,:email,:password,'SUPER_ADMIN',TRUE,
                           UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": str(uuid4()),
                "email": email,
                "password": hash_password(password),
            },
        )
    config = Settings(
        database_url=database_url,
        node_env="production",
        cors_origins=[
            "https://events.example.org",
            "https://scanner.example.org",
        ],
        session_secret="s" * 43,
        auth_link_secret="a" * 43,
        auth_link_base_url="https://events.example.org/auth",
        qr_signing_secret="q" * 43,
        public_web_base_url="https://events.example.org",
        consent_url="https://legal.example.org/privacy",
        consent_version="release-cookie-test",
    )
    with TestClient(create_app(config)) as production:
        response = production.post(
            "/auth/login",
            headers={"Origin": "https://events.example.org"},
            json={"email": email, "password": password},
        )

    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "staff_session=" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=lax" in cookie
    assert "expires=" in cookie


def test_login_route_enforces_shared_rate_limit_without_storing_email(
    client: TestClient, database_url: str
) -> None:
    from event_api.main import create_app

    email = f"rate-limit-{uuid4()}@example.org"
    config = Settings(
        database_url=database_url,
        node_env="test",
        cors_origins=["http://localhost:5173", "http://localhost:5174"],
        session_secret="r" * 43,
        auth_link_secret="a" * 43,
        auth_link_base_url="http://localhost:5173/auth",
        auth_rate_limit_max=2,
        auth_rate_limit_window_seconds=60,
        qr_signing_secret="q" * 43,
        public_web_base_url="http://localhost:5173",
        consent_url="http://localhost:5173/privacy",
        consent_version="rate-limit-test",
    )
    with TestClient(create_app(config)) as limited:
        responses = [
            limited.post(
                "/auth/login",
                headers={"Origin": "http://localhost:5173"},
                json={"email": email, "password": "incorrect test password"},
            )
            for _ in range(3)
        ]

    assert [response.status_code for response in responses] == [401, 401, 429]
    assert responses[0].json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert responses[1].json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert responses[2].json()["error"]["code"] == "RATE_LIMITED"
    database: Database = client.app.state.database
    with database.connect() as connection:
        keys = list(
            connection.execute(
                text("SELECT bucket_key FROM security_rate_limits")
            ).scalars()
        )
    assert all(email not in key for key in keys)
