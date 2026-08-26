from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import pymysql
import pytest
from fastapi.testclient import TestClient


def _free_port() -> int:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return int(server.getsockname()[1])


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    configured = os.getenv("TEST_DATABASE_URL")
    if configured:
        yield configured
        return
    root = (
        Path(os.getenv("LOCALAPPDATA", ""))
        / "event-registration-test"
        / "mysql-8.1.0-winx64"
    )
    mysqld = root / "bin" / "mysqld.exe"
    if not mysqld.exists():
        pytest.fail(
            "MySQL 8.1.0 is required; set TEST_DATABASE_URL or install the test binary"
        )
    temporary = Path(tempfile.mkdtemp(prefix="event-registration-python-mysql-"))
    data = temporary / "data"
    subprocess.run(  # noqa: S603 - executable is a verified local MySQL binary
        [
            str(mysqld),
            "--no-defaults",
            f"--basedir={root}",
            f"--datadir={data}",
            "--initialize-insecure",
            "--console",
        ],
        check=True,
        capture_output=True,
    )
    port = _free_port()
    server = subprocess.Popen(  # noqa: S603 - executable is a verified local MySQL binary
        [
            str(mysqld),
            "--no-defaults",
            f"--basedir={root}",
            f"--datadir={data}",
            f"--port={port}",
            "--bind-address=127.0.0.1",
            "--mysqlx=0",
            "--skip-log-bin",
            "--default-time-zone=+00:00",
            "--character-set-server=utf8mb4",
            "--collation-server=utf8mb4_unicode_ci",
            "--console",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    connection = None
    for _ in range(200):
        try:
            connection = pymysql.connect(
                host="127.0.0.1", port=port, user="root", autocommit=True
            )
            break
        except pymysql.MySQLError:
            time.sleep(0.1)
    if connection is None:
        server.kill()
        pytest.fail("Disposable MySQL 8.1.0 did not start")
    with connection, connection.cursor() as cursor:
        cursor.execute("SELECT VERSION()")
        assert str(cursor.fetchone()[0]).startswith("8.1.0")
        cursor.execute(
            "CREATE DATABASE event_registration_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
    yield f"mysql://root@127.0.0.1:{port}/event_registration_test"
    try:
        shutdown = pymysql.connect(
            host="127.0.0.1", port=port, user="root", autocommit=True
        )
        with shutdown:
            shutdown.cursor().execute("SHUTDOWN")
    except pymysql.MySQLError:
        server.kill()
    server.wait(timeout=15)
    shutil.rmtree(temporary, ignore_errors=True)


@pytest.fixture(scope="session")
def client(database_url: str) -> Iterator[TestClient]:
    os.environ.update(
        DATABASE_URL=database_url,
        NODE_ENV="test",
        CORS_ORIGINS="http://localhost:5173,http://localhost:5174",
        SESSION_SECRET="s" * 32,
        AUTH_LINK_SECRET="a" * 32,
        AUTH_LINK_BASE_URL="http://localhost:5173/auth",
        QR_SIGNING_SECRET="q" * 32,
        PUBLIC_WEB_BASE_URL="http://localhost:5173",
        CONSENT_URL="http://localhost:5173/consent",
        CONSENT_VERSION="test-v1",
        AUTH_RATE_LIMIT_MAX="10000",
    )
    from event_api.config import get_settings

    get_settings.cache_clear()
    from event_api.migrate import apply_migrations

    apply_migrations()
    from event_api.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
