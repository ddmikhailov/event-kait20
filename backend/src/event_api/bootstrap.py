from __future__ import annotations

import argparse
import getpass
import uuid

from sqlalchemy import text

from .config import get_settings
from .database import Database
from .security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first SUPER_ADMIN safely")
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    password = getpass.getpass("Password (minimum 12 characters): ")
    if len(password) < 12:
        raise SystemExit("Password must contain at least 12 characters")
    database = Database(get_settings())
    with database.transaction() as connection:
        count = connection.execute(
            text(
                "SELECT COUNT(*) FROM staff_users WHERE system_role = 'SUPER_ADMIN' FOR UPDATE"
            )
        ).scalar_one()
        if count:
            raise SystemExit("SUPER_ADMIN already exists; bootstrap refused")
        connection.execute(
            text(
                """INSERT INTO staff_users
                (id,email,email_normalized,password_hash,system_role,active,
                 password_changed_at,created_at,updated_at)
                VALUES (:id,:email,:normalized,:password,'SUPER_ADMIN',TRUE,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": str(uuid.uuid4()),
                "email": args.email.strip(),
                "normalized": args.email.strip().lower(),
                "password": hash_password(password),
            },
        )
    database.dispose()
    print("SUPER_ADMIN created")


if __name__ == "__main__":
    main()
