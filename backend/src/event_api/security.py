import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime
from typing import Literal

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import text

from .config import Settings
from .database import Database
from .errors import ApiError

PASSWORD_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=19_456,
    parallelism=1,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def session_token() -> str:
    return b64url(secrets.token_bytes(32))


def token_hash(token: str) -> str:
    return b64url(hashlib.sha256(token.encode()).digest())


def csrf_token(raw_session: str, secret: str) -> str:
    return b64url(
        hmac.new(
            secret.encode(), f"csrf:{raw_session}".encode(), hashlib.sha256
        ).digest()
    )


def verify_csrf(raw_session: str, supplied: str, secret: str) -> bool:
    return hmac.compare_digest(csrf_token(raw_session, secret), supplied)


AuthPurpose = Literal["invitation", "password-reset"]


def utc_iso(value: datetime) -> str:
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def mysql_millis(value: datetime) -> datetime:
    """Avoid MySQL DATETIME(3) rounding changing signed timestamp material."""
    return value.replace(microsecond=(value.microsecond // 1_000) * 1_000)


def auth_link_token(
    purpose: AuthPurpose, record_id: str, expires_at: datetime, secret: str
) -> str:
    material = f"{purpose}:{record_id}:{utc_iso(expires_at)}"
    signature = b64url(
        hmac.new(secret.encode(), material.encode(), hashlib.sha256).digest()
    )
    return f"{record_id}.{signature}"


def auth_link_record_id(token: str) -> str | None:
    parts = token.split(".")
    return parts[0] if len(parts) == 2 and all(parts) else None


def verify_auth_link(
    token: str,
    purpose: AuthPurpose,
    record_id: str,
    expires_at: datetime,
    stored_hash: str,
    secret: str,
) -> bool:
    expected = auth_link_token(purpose, record_id, expires_at, secret)
    return hmac.compare_digest(token, expected) and hmac.compare_digest(
        token_hash(token), stored_hash
    )


def registration_signature(public_id: str, secret: str) -> str:
    return b64url(
        hmac.new(
            secret.encode(), f"registration:{public_id}".encode(), hashlib.sha256
        ).digest()
    )


def registration_qr(public_id: str, secret: str) -> str:
    return f"{public_id}.{registration_signature(public_id, secret)}"


def verify_registration(public_id: str, signature: str, secret: str) -> bool:
    return hmac.compare_digest(registration_signature(public_id, secret), signature)


class RateLimiter:
    """A shared MySQL-backed limiter that works across API instances.

    Bucket identifiers are HMACed before persistence so client IP addresses and
    account identifiers do not become a second store of personal data.
    """

    def __init__(self, settings: Settings, database: Database) -> None:
        self.max = settings.auth_rate_limit_max
        self.window = settings.auth_rate_limit_window_seconds
        self.secret = settings.session_secret
        self.database = database

    def _key(self, scope: str, client: str) -> str:
        material = f"rate-limit:{scope}:{client.strip().lower()}"
        return hmac.new(
            self.secret.encode(), material.encode(), hashlib.sha256
        ).hexdigest()

    def consume(self, scope: str, client: str) -> None:
        key = self._key(scope, client)
        with self.database.transaction() as connection:
            connection.exec_driver_sql(
                "DELETE FROM security_rate_limits WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 100"
            )
            connection.execute(
                text(
                    """INSERT INTO security_rate_limits
                       (bucket_key,attempts,expires_at,updated_at)
                       VALUES (:key,1,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL :window SECOND),UTC_TIMESTAMP(3))
                       ON DUPLICATE KEY UPDATE
                         attempts=IF(expires_at <= UTC_TIMESTAMP(3),1,LEAST(attempts+1,:ceiling)),
                         expires_at=IF(expires_at <= UTC_TIMESTAMP(3),
                           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL :window SECOND),expires_at),
                         updated_at=UTC_TIMESTAMP(3)"""
                ),
                {"key": key, "window": self.window, "ceiling": self.max + 1},
            )
            attempts = connection.execute(
                text("SELECT attempts FROM security_rate_limits WHERE bucket_key=:key"),
                {"key": key},
            ).scalar_one()
            if int(attempts) > self.max:
                raise ApiError(429, "RATE_LIMITED", "Too many requests")
