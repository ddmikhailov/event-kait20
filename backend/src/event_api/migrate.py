from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Connection

from .config import Settings, get_settings
from .database import Database

MIGRATOR_LOCK_NAME = "event_registration_migrator"
MIGRATOR_LOCK_TIMEOUT_SECONDS = 10
LEGACY_MIGRATION_MARKER = -1


def migration_dir(config: Settings) -> Path:
    directory = (
        config.migrations_dir or Path(__file__).resolve().parents[2] / "migrations"
    )
    if not directory.is_dir():
        raise RuntimeError(
            f"MIGRATIONS_DIR does not exist or is not a directory: {directory}"
        )
    return directory


def _split_statements(source: str) -> list[str]:
    executable = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("--")
    )
    return [part.strip() for part in executable.split(";") if part.strip()]


def _acquire_migrator_lock(connection: Connection) -> None:
    acquired = connection.execute(
        text("SELECT GET_LOCK(:name, :timeout) AS acquired"),
        {"name": MIGRATOR_LOCK_NAME, "timeout": MIGRATOR_LOCK_TIMEOUT_SECONDS},
    ).scalar()
    connection.commit()
    if int(acquired or 0) != 1:
        raise RuntimeError(
            "Another migration run already holds the migrator lock; "
            "refusing to run concurrently"
        )


def _release_migrator_lock(connection: Connection) -> None:
    connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": MIGRATOR_LOCK_NAME})
    connection.commit()


def apply_migrations(
    config: Settings | None = None, database: Database | None = None
) -> None:
    config = config or get_settings()
    directory = migration_dir(config)
    owned = database is None
    database = database or Database(config)
    try:
        with database.connect() as connection:
            _acquire_migrator_lock(connection)
            try:
                _bootstrap_tracking_table(connection)
                for path in sorted(directory.glob("*.sql")):
                    _apply_one(connection, path)
            finally:
                _release_migrator_lock(connection)
    finally:
        if owned:
            database.dispose()


def _bootstrap_tracking_table(connection: Connection) -> None:
    connection.exec_driver_sql(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "name VARCHAR(255) PRIMARY KEY,"
        "checksum CHAR(64) NOT NULL,"
        "applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))"
    )
    # Additive: a database migrated before this tracking existed only has the
    # three original columns. MySQL has no ADD COLUMN IF NOT EXISTS (that is
    # a MariaDB extension), so check information_schema first. Rows
    # backfilled by this ALTER default to the legacy marker so already-
    # complete migrations are never mistaken for a partially-applied one and
    # re-run from statement zero.
    has_column = connection.execute(
        text(
            "SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() "
            "AND table_name='schema_migrations' AND column_name='statements_applied'"
        )
    ).first()
    if not has_column:
        connection.exec_driver_sql(
            "ALTER TABLE schema_migrations "
            f"ADD COLUMN statements_applied INT NOT NULL DEFAULT {LEGACY_MIGRATION_MARKER}"
        )
    connection.commit()


def _apply_one(connection: Connection, path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    checksum = hashlib.sha256(source.encode()).hexdigest()
    statements = _split_statements(source)
    existing = (
        connection.execute(
            text(
                "SELECT checksum, statements_applied FROM schema_migrations WHERE name=:name"
            ),
            {"name": path.name},
        )
        .mappings()
        .first()
    )
    if existing:
        if existing["checksum"] != checksum:
            raise RuntimeError(f"Applied migration was modified: {path.name}")
        applied = existing["statements_applied"]
        if applied == LEGACY_MIGRATION_MARKER or applied >= len(statements):
            return
        resume_from = applied
    else:
        connection.execute(
            text(
                "INSERT INTO schema_migrations(name, checksum, statements_applied) "
                "VALUES (:name, :checksum, 0)"
            ),
            {"name": path.name, "checksum": checksum},
        )
        connection.commit()
        resume_from = 0
    for index in range(resume_from, len(statements)):
        connection.exec_driver_sql(statements[index])
        connection.execute(
            text(
                "UPDATE schema_migrations SET statements_applied=:count WHERE name=:name"
            ),
            {"count": index + 1, "name": path.name},
        )
        connection.commit()


if __name__ == "__main__":
    apply_migrations()
