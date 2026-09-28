from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import OperationalError

from event_api import amvera_beta
from event_api.amvera_beta import validate_database_url, validate_server_identity


def test_beta_url_accepts_only_the_dedicated_mysql() -> None:
    valid = "mysql://event_app:password@amvera-ddmikhailov-run-eventki20betadb/event_registration"
    assert validate_database_url(valid).startswith("mysql+pymysql://")

    for invalid in (
        valid.replace("eventki20betadb", "mysqlseetskait20"),
        valid.replace("/event_registration", "/production"),
        valid.replace("event_app", "root"),
        valid.replace("mysql://", "postgresql://"),
    ):
        with pytest.raises(RuntimeError, match="dedicated beta MySQL"):
            validate_database_url(invalid)
    with pytest.raises(RuntimeError, match="DATABASE_URL is invalid"):
        validate_database_url("")


def test_beta_server_requires_exact_mysql_version_and_schema() -> None:
    validate_server_identity("8.1.0-community", "event_registration")
    with pytest.raises(RuntimeError, match="version or selected database"):
        validate_server_identity("8.4.0", "event_registration")
    with pytest.raises(RuntimeError, match="version or selected database"):
        validate_server_identity("8.1.0", "production")


def test_beta_start_retries_temporary_dns_failure_only(monkeypatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "mysql://event_app:password@amvera-ddmikhailov-run-eventki20betadb/event_registration",
    )
    attempts = []
    pauses = []

    class FakeEngine:
        @contextmanager
        def connect(self):
            attempts.append(True)
            if len(attempts) < 3:
                raise OperationalError(None, None, Exception(2003, "DNS failure"))
            yield SimpleNamespace(
                execute=lambda _query: SimpleNamespace(
                    one=lambda: ("8.1.0-community", "event_registration")
                )
            )

        def dispose(self):
            self.disposed = True

    engine = FakeEngine()
    monkeypatch.setattr(amvera_beta, "create_engine", lambda *_args, **_kwargs: engine)
    monkeypatch.setattr(amvera_beta.time, "sleep", pauses.append)
    amvera_beta.main()
    assert len(attempts) == 3
    assert pauses == [5, 5]
    assert engine.disposed


def test_beta_start_does_not_retry_bad_credentials(monkeypatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "mysql://event_app:password@amvera-ddmikhailov-run-eventki20betadb/event_registration",
    )
    attempts = []

    class FakeEngine:
        def connect(self):
            attempts.append(True)
            raise OperationalError(None, None, Exception(1045, "Access denied"))

        def dispose(self):
            pass

    monkeypatch.setattr(
        amvera_beta, "create_engine", lambda *_args, **_kwargs: FakeEngine()
    )
    monkeypatch.setattr(
        amvera_beta.time,
        "sleep",
        lambda _seconds: pytest.fail("Credential error was retried"),
    )
    with pytest.raises(OperationalError):
        amvera_beta.main()
    assert len(attempts) == 1
