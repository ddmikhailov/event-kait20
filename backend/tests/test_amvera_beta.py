import pytest

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
