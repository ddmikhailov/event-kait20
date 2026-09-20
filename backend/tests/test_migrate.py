from __future__ import annotations

import hashlib
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from event_api import migrate as migrate_module
from event_api.database import Database
from event_api.migrate import apply_migrations


def test_apply_migrations_rejects_missing_migrations_dir(
    client: TestClient, tmp_path: Path
) -> None:
    missing = tmp_path / "does-not-exist"
    config = client.app.state.settings.model_copy(update={"migrations_dir": missing})
    with pytest.raises(RuntimeError, match="MIGRATIONS_DIR"):
        apply_migrations(config, client.app.state.database)


def test_apply_migrations_rejects_concurrent_run(client: TestClient) -> None:
    database: Database = client.app.state.database
    config = client.app.state.settings
    with (
        database.connect() as holder,
        patch.object(migrate_module, "MIGRATOR_LOCK_TIMEOUT_SECONDS", 1),
    ):
        holder.execute(
            text("SELECT GET_LOCK(:name, 1)"),
            {"name": migrate_module.MIGRATOR_LOCK_NAME},
        )
        holder.commit()
        try:
            with pytest.raises(RuntimeError, match="migrator lock"):
                apply_migrations(config, database)
        finally:
            holder.execute(
                text("SELECT RELEASE_LOCK(:name)"),
                {"name": migrate_module.MIGRATOR_LOCK_NAME},
            )
            holder.commit()


def test_apply_migrations_resumes_after_interruption(
    client: TestClient, tmp_path: Path
) -> None:
    database: Database = client.app.state.database
    config = client.app.state.settings.model_copy(update={"migrations_dir": tmp_path})
    name = "999999_r28_resume_probe.sql"
    source = (
        "CREATE TABLE r28_resume_probe (id INT PRIMARY KEY);\n"
        "ALTER TABLE r28_resume_probe ADD COLUMN a INT NULL;\n"
        "ALTER TABLE r28_resume_probe ADD COLUMN b INT NULL;\n"
    )
    (tmp_path / name).write_text(source, encoding="utf-8")
    checksum = hashlib.sha256(source.encode()).hexdigest()
    with database.transaction() as connection:
        connection.exec_driver_sql("DROP TABLE IF EXISTS r28_resume_probe")
        connection.execute(
            text("DELETE FROM schema_migrations WHERE name=:name"), {"name": name}
        )
    # Simulate a crash that happened after statement 0 committed (MySQL DDL
    # auto-commits per statement) but before the process could run statement 1.
    with database.transaction() as connection:
        connection.exec_driver_sql("CREATE TABLE r28_resume_probe (id INT PRIMARY KEY)")
        connection.execute(
            text(
                "INSERT INTO schema_migrations(name, checksum, statements_applied) "
                "VALUES (:name, :checksum, 1)"
            ),
            {"name": name, "checksum": checksum},
        )
    try:
        # If this re-ran statement 0, MySQL would reject the duplicate
        # CREATE TABLE and this call would raise instead of completing.
        apply_migrations(config, database)
        with database.connect() as connection:
            columns = {
                row[0]
                for row in connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema=DATABASE() AND table_name='r28_resume_probe'"
                    )
                )
            }
        assert {"id", "a", "b"} <= columns
        with database.connect() as connection:
            applied = connection.execute(
                text(
                    "SELECT statements_applied FROM schema_migrations WHERE name=:name"
                ),
                {"name": name},
            ).scalar_one()
        assert applied == 3
    finally:
        with database.transaction() as connection:
            connection.exec_driver_sql("DROP TABLE IF EXISTS r28_resume_probe")
            connection.execute(
                text("DELETE FROM schema_migrations WHERE name=:name"), {"name": name}
            )
