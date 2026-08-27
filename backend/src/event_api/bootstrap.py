from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import text

from .config import Settings, get_settings
from .database import Database
from .security import auth_link_token, mysql_millis, token_hash

BOOTSTRAP_LOCK = "event-registration-super-admin-bootstrap"


def create_activation_token(email: str, database: Database, config: Settings) -> str:
    """Create the only pending first-admin invitation and return its raw token once."""
    record_id = str(uuid4())
    expires = mysql_millis(
        datetime.now(UTC).replace(tzinfo=None)
        + timedelta(seconds=config.invitation_ttl_seconds)
    )
    raw_token = auth_link_token(
        "invitation", record_id, expires, config.auth_link_secret
    )
    with database.connect() as connection:
        acquired = connection.execute(
            text("SELECT GET_LOCK(:name, 10)"), {"name": BOOTSTRAP_LOCK}
        ).scalar_one()
        connection.commit()
        if acquired != 1:
            raise SystemExit("Could not acquire SUPER_ADMIN bootstrap lock")
        try:
            with connection.begin():
                count = connection.execute(
                    text(
                        "SELECT COUNT(*) FROM staff_users WHERE system_role = 'SUPER_ADMIN'"
                    )
                ).scalar_one()
                if count:
                    raise SystemExit("SUPER_ADMIN already exists; bootstrap refused")
                pending = connection.execute(
                    text(
                        """SELECT COUNT(*) FROM staff_invitations
                           WHERE role='SUPER_ADMIN' AND invited_by IS NULL
                             AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP(3)"""
                    )
                ).scalar_one()
                if pending:
                    raise SystemExit(
                        "A valid SUPER_ADMIN activation link already exists; bootstrap refused"
                    )
                connection.execute(
                    text(
                        """INSERT INTO staff_invitations
                           (id,email_normalized,token_hash,invited_by,event_id,role,
                            expires_at,created_at)
                           VALUES (:id,:email,:hash,NULL,NULL,'SUPER_ADMIN',
                                   :expires,UTC_TIMESTAMP(3))"""
                    ),
                    {
                        "id": record_id,
                        "email": email,
                        "hash": token_hash(raw_token),
                        "expires": expires,
                    },
                )
        finally:
            connection.execute(
                text("SELECT RELEASE_LOCK(:name)"), {"name": BOOTSTRAP_LOCK}
            )
            connection.commit()
    return raw_token


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first SUPER_ADMIN safely")
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    try:
        email = str(TypeAdapter(EmailStr).validate_python(args.email.strip())).lower()
    except ValidationError as error:
        raise SystemExit("A valid email address is required") from error
    config = get_settings()
    database = Database(config)
    try:
        token = create_activation_token(email, database, config)
    finally:
        database.dispose()
    base_url = str(config.auth_link_base_url).rstrip("/")
    print("Open this one-time link to set the first SUPER_ADMIN password:")
    print(f"{base_url}/invitation/{token}")
    print(
        "The raw activation token is shown only now and is not stored in the database."
    )


if __name__ == "__main__":
    main()
