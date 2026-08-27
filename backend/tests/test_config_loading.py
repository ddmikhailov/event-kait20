from pathlib import Path

import pytest

from event_api.config import get_settings
from event_api.migrate import migration_dir


def test_explicit_protected_env_file_and_migrations_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    environment = tmp_path / "backend.env"
    environment.write_text(
        "\n".join(
            [
                "DATABASE_URL=mysql://test:test@127.0.0.1/event_registration",
                "NODE_ENV=test",
                "CORS_ORIGINS=http://localhost:5173",
                f"MIGRATIONS_DIR={migrations.as_posix()}",
                f"SESSION_SECRET={'s' * 43}",
                f"AUTH_LINK_SECRET={'a' * 43}",
                "AUTH_LINK_BASE_URL=http://localhost:5173/auth",
                f"QR_SIGNING_SECRET={'q' * 43}",
                "PUBLIC_WEB_BASE_URL=http://localhost:5173",
                "CONSENT_URL=http://localhost:5173/privacy",
                "CONSENT_VERSION=test",
            ]
        ),
        encoding="utf-8",
    )
    setting_names = (
        "DATABASE_URL",
        "NODE_ENV",
        "CORS_ORIGINS",
        "MIGRATIONS_DIR",
        "SESSION_SECRET",
        "AUTH_LINK_SECRET",
        "AUTH_LINK_BASE_URL",
        "QR_SIGNING_SECRET",
        "PUBLIC_WEB_BASE_URL",
        "CONSENT_URL",
        "CONSENT_VERSION",
    )
    for name in setting_names:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("EVENT_REGISTRATION_ENV_FILE", str(environment))
    get_settings.cache_clear()
    try:
        config = get_settings()
        assert migration_dir(config) == migrations
        assert str(config.database_url).startswith("mysql://test:")
    finally:
        get_settings.cache_clear()


def test_explicit_env_file_must_exist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("EVENT_REGISTRATION_ENV_FILE", str(tmp_path / "missing.env"))
    get_settings.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="readable file"):
            get_settings()
    finally:
        get_settings.cache_clear()
