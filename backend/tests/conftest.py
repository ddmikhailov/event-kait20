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
    configured_home = os.getenv("MYSQL_HOME")
    root = (
        Path(configured_home)
        if configured_home
        else Path(os.getenv("LOCALAPPDATA", ""))
        / "event-registration-test"
        / "mysql-8.1.0-winx64"
    )
    executable = "mysqld.exe" if os.name == "nt" else "mysqld"
    mysqld = next(
        (
            candidate
            for candidate in (root / "bin" / executable, root / "sbin" / executable)
            if candidate.exists()
        ),
        None,
    )
    if mysqld is None:
        pytest.fail("MySQL 8.1.0 is required; set TEST_DATABASE_URL or MYSQL_HOME")
    version = subprocess.run(  # noqa: S603 - executable is an explicit local path
        [str(mysqld), "--version"], check=True, capture_output=True, text=True
    )
    if "Ver 8.1.0" not in f"{version.stdout}{version.stderr}":
        pytest.fail("The disposable integration database must be exactly MySQL 8.1.0")
    temporary = Path(tempfile.mkdtemp(prefix="event-registration-python-mysql-"))
    data = temporary / "data"
    layout_options: list[str] = []
    runtime_options = (
        [f"--socket={temporary / 'mysql.sock'}"] if os.name != "nt" else []
    )
    messages = root / "share" / "mysql-8.1"
    plugins = root / "lib" / "mysql" / "plugin"
    if messages.exists():
        layout_options.append(f"--lc-messages-dir={messages}")
    if plugins.exists():
        layout_options.append(f"--plugin-dir={plugins}")
    subprocess.run(  # noqa: S603 - executable is a verified local MySQL binary
        [
            str(mysqld),
            "--no-defaults",
            f"--basedir={root}",
            f"--datadir={data}",
            *layout_options,
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
            *layout_options,
            *runtime_options,
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
        output, _ = server.communicate(timeout=5)
        diagnostics = output.decode(errors="replace")[-4000:] if output else ""
        pytest.fail(
            f"Disposable MySQL 8.1.0 did not start. Last server output:\n{diagnostics}"
        )
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
    media_root = tempfile.mkdtemp(prefix="event-registration-media-")
    os.environ.update(
        DATABASE_URL=database_url,
        NODE_ENV="test",
        CORS_ORIGINS="http://localhost:5173,http://localhost:5174",
        SESSION_SECRET="s" * 32,
        AUTH_LINK_SECRET="a" * 32,
        AUTH_LINK_BASE_URL="http://localhost:5173/auth",
        QR_SIGNING_SECRET="q" * 32,
        PUBLIC_WEB_BASE_URL="http://localhost:5173",
        CONSENT_URL="https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf",
        PRIVACY_POLICY_URL="https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf",
        CONSENT_VERSION="test-v1",
        AUTH_RATE_LIMIT_MAX="10000",
        MEDIA_ROOT=media_root,
    )
    from event_api.config import get_settings

    get_settings.cache_clear()
    from event_api.migrate import apply_migrations

    apply_migrations()
    from event_api.bootstrap import create_activation_token
    from event_api.main import create_app
    from event_api.security import token_hash

    with TestClient(create_app()) as test_client:
        database = test_client.app.state.database
        config = test_client.app.state.settings
        raw_activation = create_activation_token("admin@example.com", database, config)
        with database.connect() as connection:
            invitation_hash = connection.exec_driver_sql(
                "SELECT token_hash FROM staff_invitations WHERE role='SUPER_ADMIN'"
            ).scalar_one()
        assert invitation_hash == token_hash(raw_activation)
        assert raw_activation != invitation_hash
        activated = test_client.post(
            f"/auth/invitations/{raw_activation}/accept",
            headers={"Origin": "http://localhost:5173"},
            json={"password": "correct horse battery"},
        )
        assert activated.status_code == 200, activated.text
        test_client.app.state.bootstrap_test = {
            "rawActivation": raw_activation,
            "invitationHash": invitation_hash,
        }
        yield test_client
    shutil.rmtree(media_root, ignore_errors=True)
