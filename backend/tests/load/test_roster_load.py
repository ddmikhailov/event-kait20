"""Optional synthetic roster import load check on a disposable MySQL database."""

import io
import threading
import time
import tracemalloc
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import event

from event_api.routers.roster import HEADERS


@pytest.mark.load
def test_large_roster_import_keeps_public_reads_available(client: TestClient) -> None:
    client.cookies.clear()
    origin = {"Origin": "http://localhost:5173"}
    login = client.post(
        "/auth/login",
        headers=origin,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert login.status_code == 200
    headers = {**origin, "X-CSRF-Token": login.json()["csrfToken"]}
    book = Workbook(write_only=True)
    sheet = book.create_sheet()
    sheet.append(list(HEADERS))
    group = f"LOAD-{uuid4().hex[:8]}"
    for number in range(5000):
        sheet.append([f"Вымышленный{number}", "Студент", None, group])
    buffer = io.BytesIO()
    book.save(buffer)
    source = buffer.getvalue()
    files = {"file": ("roster.xlsx", source, "application/octet-stream")}
    preview = client.post(
        "/admin/activity/roster/preview", headers=headers, files=files
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["students"] == 5000

    query_count = 0
    guard = threading.Lock()

    def count_query(*_args) -> None:
        nonlocal query_count
        with guard:
            query_count += 1

    engine = client.app.state.database.engine
    event.listen(engine, "before_cursor_execute", count_query)
    tracemalloc.start()
    started = time.perf_counter()
    latencies: list[float] = []
    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            importing = workers.submit(
                client.post,
                "/admin/activity/roster/import",
                headers=headers,
                files=files,
                data={"fileHash": preview.json()["fileHash"]},
            )
            for _ in range(5):
                read_started = time.perf_counter()
                response = client.get("/public/events")
                latencies.append(time.perf_counter() - read_started)
                assert response.status_code == 200, response.text
            imported = importing.result()
        elapsed = time.perf_counter() - started
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
        event.remove(engine, "before_cursor_execute", count_query)
    assert imported.status_code == 201, imported.text
    assert imported.json() == {"created": 5000, "skipped": 0}
    assert query_count < 300
    print(
        f"roster import: {elapsed:.2f}s, peak Python allocation {peak / 1048576:.1f} MiB, "
        f"SQL statements {query_count}, max public read {max(latencies):.2f}s"
    )
