import base64
import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

from .config import Settings
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


@dataclass
class Bucket:
    count: int
    reset_at: float


class RateLimiter:
    def __init__(self, settings: Settings) -> None:
        self.max = settings.auth_rate_limit_max
        self.window = settings.auth_rate_limit_window_seconds
        self.buckets: dict[str, Bucket] = {}
        self.lock = threading.Lock()

    def consume(self, scope: str, client: str) -> None:
        now = time.monotonic()
        key = f"{scope}:{client}"
        with self.lock:
            current = self.buckets.get(key)
            if current is None or current.reset_at <= now:
                self.buckets[key] = Bucket(1, now + self.window)
                return
            if current.count >= self.max:
                raise ApiError(429, "RATE_LIMITED", "Too many requests")
            current.count += 1
