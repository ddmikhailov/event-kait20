from __future__ import annotations

import json
import math
import os
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import bindparam, text

from event_api.database import Database
from event_api.email_worker import process_once
from event_api.security import hash_password

ORIGIN = {"Origin": "http://localhost:5173"}


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * percentile) - 1)
    return round(ordered[index], 2)


def _timed_request(
    client: TestClient, path: str, payload: dict[str, Any]
) -> tuple[int, str | None, float]:
    started = time.perf_counter()
    response = client.post(path, headers=ORIGIN, json=payload)
    elapsed_ms = (time.perf_counter() - started) * 1_000
    body = response.json()
    code = body.get("error", {}).get("code") if isinstance(body, dict) else None
    return response.status_code, code, elapsed_ms


def _participant(index: int) -> dict[str, Any]:
    return {
        "lastName": f"Нагрузочный-{index:04d}",
        "firstName": "Участник",
        "middleName": None,
        "birthDate": "2005-01-01",
        "email": f"load-{index:04d}@example.com",
        "phone": f"+79{index:09d}",
        "studyGroup": "LOAD-01",
        "personType": "KAIT_STUDENT",
        "customAnswers": [],
        "consentAccepted": True,
        "consentVersion": "test-v1",
    }


def _seed_load_event(database: Database, capacity: int) -> tuple[str, str]:
    admin_id, event_id = str(uuid4()), str(uuid4())
    now = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO staff_users
                (id,email,email_normalized,password_hash,system_role,active,
                 password_changed_at,created_at,updated_at)
                VALUES (:id,'load-admin@example.com','load-admin@example.com',:password,
                        'SUPER_ADMIN',TRUE,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": admin_id, "password": hash_password("load admin safe password")},
        )
        connection.execute(
            text(
                """INSERT INTO events
                (id,title,slug,description,start_at,end_at,timezone,location,
                 registration_deadline,capacity,status,created_by,offline_data_version,
                 created_at,updated_at)
                VALUES (:id,'Release load test','release-load',NULL,:start,:end,
                        'Europe/Moscow','Synthetic',:deadline,:capacity,
                        'REGISTRATION_OPEN',:admin,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": event_id,
                "start": now + timedelta(hours=1),
                "end": now + timedelta(hours=5),
                "deadline": now + timedelta(minutes=30),
                "capacity": capacity,
                "admin": admin_id,
            },
        )
    return admin_id, event_id


def _login(client: TestClient) -> dict[str, str]:
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={
            "email": "load-admin@example.com",
            "password": "load admin safe password",
        },
    )
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


@pytest.mark.load
def test_release_load_and_concurrency(client: TestClient) -> None:
    registration_count = int(os.getenv("EVENT_LOAD_REGISTRATIONS", "1000"))
    workers = int(os.getenv("EVENT_LOAD_WORKERS", "24"))
    capacity = int(os.getenv("EVENT_LOAD_CAPACITY", str(registration_count * 4 // 5)))
    assert 10 <= capacity < registration_count <= 5_000
    assert 2 <= workers <= 64

    database: Database = client.app.state.database
    _, event_id = _seed_load_event(database, capacity)
    payloads = [_participant(index) for index in range(registration_count)]

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        registration_results = list(
            executor.map(
                lambda payload: _timed_request(
                    client, "/public/events/release-load/register", payload
                ),
                payloads,
            )
        )
    registration_seconds = time.perf_counter() - started
    created = [result for result in registration_results if result[0] == 201]
    full = [
        result
        for result in registration_results
        if result[0] == 409 and result[1] == "CAPACITY_FULL"
    ]
    unexpected = [
        result for result in registration_results if result not in created + full
    ]
    assert not unexpected
    assert len(created) == capacity
    assert len(full) == registration_count - capacity

    repeat_payloads = [
        payload
        for payload, result in zip(payloads, registration_results, strict=True)
        if result[0] == 201
    ][: min(50, capacity)]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        repeated = list(
            executor.map(
                lambda payload: _timed_request(
                    client, "/public/events/release-load/register", payload
                ),
                repeat_payloads,
            )
        )
    assert all(status == 200 and code is None for status, code, _ in repeated)

    with database.connect() as connection:
        active = int(
            connection.execute(
                text(
                    "SELECT count(*) FROM registrations WHERE event_id=:event AND status='ACTIVE'"
                ),
                {"event": event_id},
            ).scalar_one()
        )
        registration_ids = list(
            connection.execute(
                text(
                    "SELECT id FROM registrations WHERE event_id=:event ORDER BY id LIMIT 200"
                ),
                {"event": event_id},
            ).scalars()
        )
    assert active == capacity

    auth_headers = _login(client)
    estimated = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    scanner_batches: list[dict[str, Any]] = []
    for _device_index in range(4):
        scanner_batches.append(
            {
                "deviceId": str(uuid4()),
                "events": [
                    {
                        "clientEventId": str(uuid4()),
                        "registrationId": registration_id,
                        "mode": "MANUAL_CONFIRM",
                        "source": "ONLINE",
                        "deviceScannedAt": estimated,
                        "estimatedScannedAt": estimated,
                    }
                    for registration_id in registration_ids
                ],
            }
        )

    def sync(batch: dict[str, Any]) -> tuple[dict[str, Any], float]:
        started_at = time.perf_counter()
        response = client.post(
            f"/scanner/events/{event_id}/attendance/sync",
            headers=auth_headers,
            json=batch,
        )
        assert response.status_code == 201, response.text
        return response.json(), (time.perf_counter() - started_at) * 1_000

    with ThreadPoolExecutor(max_workers=4) as executor:
        scanner_results = list(executor.map(sync, scanner_batches))
    statuses = [
        item["status"]
        for response, _ in scanner_results
        for item in response["results"]
    ]
    assert statuses.count("ACCEPTED") == len(registration_ids)
    assert statuses.count("REGISTRATION_ALREADY_ATTENDED") == len(registration_ids) * 3
    retried, _ = sync(scanner_batches[0])
    assert all(item["status"] == "ALREADY_PROCESSED" for item in retried["results"])

    sender_calls: Counter[str] = Counter()
    sender_calls_lock = threading.Lock()

    def sender(message: EmailMessage, _config: Any) -> str:
        identifier = str(message["Message-ID"])
        with sender_calls_lock:
            sender_calls[identifier] += 1
        return identifier

    smtp_config = client.app.state.settings.model_copy(
        update={"smtp_host": "smtp.invalid", "smtp_from_email": "load@example.com"}
    )

    def drain_email_queue() -> int:
        processed = 0
        while process_once(database, smtp_config, sender):
            processed += 1
        return processed

    email_started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=8) as executor:
        processed_by_workers = list(
            executor.map(lambda _: drain_email_queue(), range(8))
        )

    retry_attempts: dict[str, int] = {}
    retry_attempts_lock = threading.Lock()
    with database.transaction() as connection:
        retry_ids = list(
            connection.execute(
                text("SELECT id FROM email_deliveries ORDER BY id LIMIT 10")
            ).scalars()
        )
        retry_statement = text(
            """UPDATE email_deliveries SET status='QUEUED',attempts=0,sent_at=NULL,
               provider_message_id=NULL WHERE id IN :ids"""
        ).bindparams(bindparam("ids", expanding=True))
        connection.execute(retry_statement, {"ids": retry_ids})

    def retry_sender(message: EmailMessage, _config: Any) -> str:
        identifier = str(message["Message-ID"])
        with retry_attempts_lock:
            retry_attempts[identifier] = retry_attempts.get(identifier, 0) + 1
            attempt = retry_attempts[identifier]
        if attempt == 1:
            raise TimeoutError("synthetic provider timeout")
        return identifier

    retry_processed = 0
    while process_once(database, smtp_config, retry_sender):
        retry_processed += 1
    email_seconds = time.perf_counter() - email_started

    with database.connect() as connection:
        delivery_statuses = dict(
            connection.execute(
                text("SELECT status,count(*) FROM email_deliveries GROUP BY status")
            ).all()
        )
        retry_count = int(
            connection.execute(
                text("SELECT count(*) FROM email_deliveries WHERE attempts > 1")
            ).scalar_one()
        )
        attendance_rows = int(
            connection.execute(
                text("SELECT count(*) FROM attendance_events WHERE event_id=:event"),
                {"event": event_id},
            ).scalar_one()
        )
        mysql_version = str(connection.execute(text("SELECT VERSION()")).scalar_one())

    assert delivery_statuses.get("QUEUED", 0) == 0
    assert delivery_statuses.get("SENDING", 0) == 0
    assert delivery_statuses.get("FAILED", 0) == 0
    assert delivery_statuses.get("SENT", 0) == capacity + len(repeat_payloads)
    assert sum(processed_by_workers) == capacity + len(repeat_payloads), {
        "processed": sum(processed_by_workers),
        "senderCalls": sum(sender_calls.values()),
        "uniqueMessages": len(sender_calls),
    }
    assert len(sender_calls) == capacity + len(repeat_payloads)
    assert max(sender_calls.values()) == 1
    assert retry_processed == len(retry_ids) * 2
    assert retry_count == len(retry_ids)
    assert attendance_rows == len(registration_ids) * 4

    latencies = [result[2] for result in registration_results]
    report = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "mysqlVersion": mysql_version,
        "profile": {
            "registrations": registration_count,
            "capacity": capacity,
            "workers": workers,
            "scannerDevices": len(scanner_batches),
        },
        "registration": {
            "created": len(created),
            "capacityRejected": len(full),
            "seconds": round(registration_seconds, 2),
            "requestsPerSecond": round(registration_count / registration_seconds, 2),
            "latencyMs": {
                "p50": _percentile(latencies, 0.50),
                "p95": _percentile(latencies, 0.95),
                "p99": _percentile(latencies, 0.99),
            },
        },
        "attendance": {
            "events": attendance_rows,
            "batchLatencyMs": [round(item[1], 2) for item in scanner_results],
            "idempotentRetryEvents": len(retried["results"]),
        },
        "email": {
            "sent": delivery_statuses.get("SENT", 0),
            "retried": retry_count,
            "seconds": round(email_seconds, 2),
        },
    }
    report_path = Path(
        os.getenv("EVENT_LOAD_REPORT", ".runtime/release-load-report.json")
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf8")
    print(f"\nRelease load report: {report_path.resolve()}")
    print(json.dumps(report, ensure_ascii=False, indent=2))
