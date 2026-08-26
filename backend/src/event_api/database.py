from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, RowMapping

from .config import Settings


class Database:
    def __init__(self, settings: Settings) -> None:
        url = str(settings.database_url).replace("mysql://", "mysql+pymysql://", 1)
        self.engine: Engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_recycle=1_800,
            connect_args={
                "connect_timeout": settings.database_connect_timeout_ms // 1_000,
                "charset": "utf8mb4",
            },
        )

    @contextmanager
    def connect(self) -> Iterator[Connection]:
        with self.engine.connect() as connection:
            yield connection

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        with self.engine.begin() as connection:
            yield connection

    def dispose(self) -> None:
        self.engine.dispose()


def rows(
    connection: Connection,
    query: str,
    parameters: Mapping[str, Any] | None = None,
) -> Sequence[RowMapping]:
    return connection.execute(text(query), parameters or {}).mappings().all()


def row(
    connection: Connection,
    query: str,
    parameters: Mapping[str, Any] | None = None,
) -> RowMapping | None:
    return connection.execute(text(query), parameters or {}).mappings().first()


def execute(
    connection: Connection,
    query: str,
    parameters: Mapping[str, Any] | None = None,
) -> int:
    result = connection.execute(text(query), parameters or {})
    return result.rowcount


def execute_many(
    connection: Connection,
    query: str,
    parameters: Sequence[Mapping[str, Any]],
) -> int:
    result = connection.execute(text(query), list(parameters))
    return result.rowcount
