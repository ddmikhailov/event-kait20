from __future__ import annotations

import argparse
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import text

from .config import Settings, get_settings
from .database import Database
from .security import auth_link_token, mysql_millis, token_hash
from .tenant_scope import default_tenant_scope

BOOTSTRAP_LOCK = "event-registration-super-admin-bootstrap"


def _activation_token(
    email: str, database: Database, config: Settings, *, recover_pending: bool
) -> str | None:
    """Create or recover the first-admin link while holding the bootstrap lock."""
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
                scope = default_tenant_scope(connection)
                count = connection.execute(
                    text(
                        "SELECT COUNT(*) FROM staff_users WHERE system_role = 'SUPER_ADMIN'"
                    )
                ).scalar_one()
                if count:
                    if recover_pending:
                        return None
                    raise SystemExit("SUPER_ADMIN already exists; bootstrap refused")
                pending = connection.execute(
                    text(
                        """SELECT id,email_normalized,token_hash,expires_at
                           FROM staff_invitations
                           WHERE role='SUPER_ADMIN' AND invited_by IS NULL
                             AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP(3)
                           ORDER BY created_at DESC LIMIT 1"""
                    )
                ).mappings().first()
                if pending:
                    if recover_pending and pending["email_normalized"] == email:
                        existing = auth_link_token(
                            "invitation",
                            pending["id"],
                            pending["expires_at"],
                            config.auth_link_secret,
                        )
                        if token_hash(existing) != pending["token_hash"]:
                            raise SystemExit("Pending activation link cannot be recovered")
                        return existing
                    raise SystemExit(
                        "A valid SUPER_ADMIN activation link already exists; bootstrap refused"
                    )
                connection.execute(
                    text(
                        """INSERT INTO staff_invitations
                           (id,tenant_id,organization_id,email_normalized,token_hash,invited_by,event_id,role,
                            expires_at,created_at)
                           VALUES (:id,:tenant,:organization,:email,:hash,NULL,NULL,'SUPER_ADMIN',
                                   :expires,UTC_TIMESTAMP(3))"""
                    ),
                    {
                        "id": record_id,
                        "tenant": scope.tenant_id,
                        "organization": scope.organization_id,
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


def create_activation_token(email: str, database: Database, config: Settings) -> str:
    """Create the only pending first-admin invitation and return its raw token once."""
    token = _activation_token(email, database, config, recover_pending=False)
    assert token is not None
    return token


def _write_private_link(path: Path, link: str) -> None:
    """Atomically replace a private link file outside the public document root."""
    descriptor, temporary_name = tempfile.mkstemp(prefix=".bootstrap-", dir=path.parent)
    try:
        os.chmod(temporary_name, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(f"{link}\n")
        os.replace(temporary_name, path)
    finally:
        Path(temporary_name).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first SUPER_ADMIN safely")
    parser.add_argument("--email", required=True)
    parser.add_argument("--output-file", type=Path)
    args = parser.parse_args()
    try:
        email = str(TypeAdapter(EmailStr).validate_python(args.email.strip())).lower()
    except ValidationError as error:
        raise SystemExit("A valid email address is required") from error
    config = get_settings()
    database = Database(config)
    try:
        token = _activation_token(
            email, database, config, recover_pending=args.output_file is not None
        )
    finally:
        database.dispose()
    if token is None:
        if args.output_file is not None:
            args.output_file.unlink(missing_ok=True)
            return
        raise SystemExit("SUPER_ADMIN already exists; bootstrap refused")
    base_url = str(config.auth_link_base_url).rstrip("/")
    link = f"{base_url}/invitation/{token}"
    if args.output_file is not None:
        _write_private_link(args.output_file, link)
        return
    print("Open this one-time link to set the first SUPER_ADMIN password:")
    print(link)
    print(
        "The raw activation token is shown only now and is not stored in the database."
    )


if __name__ == "__main__":
    main()
