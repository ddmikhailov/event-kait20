"""Fail closed before starting or migrating the isolated Amvera beta."""

import os
import time

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, OperationalError

EXPECTED_HOST = "amvera-ddmikhailov-run-eventki20betadb"
EXPECTED_DATABASE = "event_registration"
EXPECTED_USER = "event_app"
EXPECTED_VERSION = "8.1.0"
CONNECTION_ATTEMPTS = 6
RETRY_SECONDS = 5


def validate_database_url(value: str) -> str:
    try:
        url = make_url(value)
    except ArgumentError:
        raise RuntimeError("Amvera beta DATABASE_URL is invalid") from None
    if (
        url.drivername != "mysql"
        or url.host != EXPECTED_HOST
        or url.database != EXPECTED_DATABASE
        or url.username != EXPECTED_USER
        or not url.password
        or url.port not in (None, 3306)
    ):
        raise RuntimeError(
            "Amvera beta DATABASE_URL does not identify the dedicated beta MySQL"
        )
    return value.replace("mysql://", "mysql+pymysql://", 1)


def validate_server_identity(version: str, database: str | None) -> None:
    if version.split("-", 1)[0] != EXPECTED_VERSION or database != EXPECTED_DATABASE:
        raise RuntimeError("Amvera beta MySQL version or selected database is wrong")


def transient_connect_error(error: OperationalError) -> bool:
    """Retry only a temporarily unavailable MySQL endpoint, not credentials."""
    arguments = getattr(error.orig, "args", ())
    return bool(arguments and arguments[0] in (2003, 2005))


def main() -> None:
    database_url = os.environ.get("DATABASE_URL", "")
    engine = create_engine(
        validate_database_url(database_url),
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5},
    )
    try:
        for attempt in range(CONNECTION_ATTEMPTS):
            try:
                with engine.connect() as connection:
                    version, database = connection.execute(
                        text("SELECT VERSION(), DATABASE()")
                    ).one()
                    validate_server_identity(version, database)
                return
            except OperationalError as error:
                if (
                    not transient_connect_error(error)
                    or attempt + 1 == CONNECTION_ATTEMPTS
                ):
                    raise
                time.sleep(RETRY_SECONDS)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
