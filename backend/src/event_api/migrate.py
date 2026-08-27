from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import text

from .config import Settings, get_settings
from .database import Database


def migration_dir(config: Settings) -> Path:
    return config.migrations_dir or Path(__file__).resolve().parents[2] / "migrations"


def apply_migrations() -> None:
    config = get_settings()
    database = Database(config)
    with database.transaction() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))"
        )
        applied = {
            row[0]: row[1]
            for row in connection.execute(
                text("SELECT name, checksum FROM schema_migrations")
            )
        }
        for path in sorted(migration_dir(config).glob("*.sql")):
            source = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(source.encode()).hexdigest()
            if path.name in applied:
                if applied[path.name] != checksum:
                    raise RuntimeError(f"Applied migration was modified: {path.name}")
                continue
            executable = "\n".join(
                line
                for line in source.splitlines()
                if not line.lstrip().startswith("--")
            )
            for statement in (part.strip() for part in executable.split(";")):
                if statement:
                    connection.exec_driver_sql(statement)
            connection.execute(
                text(
                    "INSERT INTO schema_migrations(name, checksum) VALUES (:name, :checksum)"
                ),
                {"name": path.name, "checksum": checksum},
            )
    database.dispose()


if __name__ == "__main__":
    apply_migrations()
