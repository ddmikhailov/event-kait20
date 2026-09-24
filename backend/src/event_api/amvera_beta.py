"""Fail closed before starting or migrating the isolated Amvera beta."""

import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

EXPECTED_HOST = "amvera-ddmikhailov-run-eventki20betadb"
EXPECTED_DATABASE = "event_registration"
EXPECTED_USER = "event_app"
EXPECTED_VERSION = "8.1.0"


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


def main() -> None:
    database_url = os.environ.get("DATABASE_URL", "")
    engine = create_engine(
        validate_database_url(database_url),
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5},
    )
    try:
        with engine.connect() as connection:
            version, database = connection.execute(
                text("SELECT VERSION(), DATABASE()")
            ).one()
            validate_server_identity(version, database)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
