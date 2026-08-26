from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Cookie, Depends, Header, Request

from .config import Settings
from .database import Database, execute, row
from .errors import ApiError
from .security import csrf_token, token_hash, verify_csrf

Role = Literal["SUPER_ADMIN", "SCANNER"]


@dataclass(frozen=True)
class Staff:
    id: str
    email: str
    role: Role
    session_id: str
    expires_at: datetime
    raw_token: str
    csrf: str


def settings(request: Request) -> Settings:
    return request.app.state.settings


def database(request: Request) -> Database:
    return request.app.state.database


def current_staff(
    request: Request,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
    staff_session: Annotated[str | None, Cookie()] = None,
) -> Staff:
    if not staff_session:
        raise ApiError(401, "UNAUTHENTICATED", "Authentication required")
    with db.transaction() as connection:
        result = row(
            connection,
            """SELECT s.id AS session_id, s.expires_at, u.id, u.email,
                      u.system_role, u.active
               FROM sessions s JOIN staff_users u ON u.id = s.user_id
               WHERE s.token_hash = :token_hash AND s.revoked_at IS NULL
                 AND s.expires_at > UTC_TIMESTAMP(3) AND u.active = true""",
            {"token_hash": token_hash(staff_session)},
        )
        if not result:
            raise ApiError(401, "UNAUTHENTICATED", "Authentication required")
        execute(
            connection,
            "UPDATE sessions SET last_used_at = UTC_TIMESTAMP(3) WHERE id = :id",
            {"id": result["session_id"]},
        )
    return Staff(
        id=result["id"],
        email=result["email"],
        role=result["system_role"],
        session_id=result["session_id"],
        expires_at=result["expires_at"],
        raw_token=staff_session,
        csrf=csrf_token(staff_session, config.session_secret),
    )


def csrf_staff(
    request: Request,
    staff: Annotated[Staff, Depends(current_staff)],
    config: Annotated[Settings, Depends(settings)],
    x_csrf_token: Annotated[str | None, Header()] = None,
    origin: Annotated[str | None, Header()] = None,
) -> Staff:
    if origin not in config.cors_origins:
        raise ApiError(403, "ORIGIN_NOT_TRUSTED", "Request origin is not trusted")
    if not x_csrf_token or not verify_csrf(
        staff.raw_token, x_csrf_token, config.session_secret
    ):
        raise ApiError(403, "CSRF_INVALID", "CSRF validation failed")
    return staff


def super_admin(staff: Annotated[Staff, Depends(current_staff)]) -> Staff:
    if staff.role != "SUPER_ADMIN":
        raise ApiError(403, "FORBIDDEN", "Insufficient permission")
    return staff


def csrf_super_admin(staff: Annotated[Staff, Depends(csrf_staff)]) -> Staff:
    if staff.role != "SUPER_ADMIN":
        raise ApiError(403, "FORBIDDEN", "Insufficient permission")
    return staff
