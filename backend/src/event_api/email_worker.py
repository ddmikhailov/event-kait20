from __future__ import annotations

import time

from sqlalchemy import text

from .config import get_settings
from .database import Database


def process_once() -> int:
    """Reserve durable delivery intents without implementing a provider."""
    database = Database(get_settings())
    with database.transaction() as connection:
        deliveries = (
            connection.execute(
                text(
                    "SELECT id FROM email_deliveries WHERE status = 'QUEUED' ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED"
                )
            )
            .mappings()
            .all()
        )
        # Provider integration is intentionally a deployment gate. Keeping records
        # pending guarantees that registration is never rolled back by email.
        count = len(deliveries)
    database.dispose()
    return count


def main() -> None:
    while True:
        process_once()
        time.sleep(5)


if __name__ == "__main__":
    main()
