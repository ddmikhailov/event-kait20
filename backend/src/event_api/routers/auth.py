from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response

from ..config import Settings
from ..database import Database, execute, row
from ..dependencies import Staff, csrf_staff, current_staff, database, settings
from ..errors import ApiError
from ..schemas import (
    InvitationAcceptRequest,
    LoginRequest,
    PasswordForgotRequest,
    PasswordResetRequest,
)
from ..security import (
    RateLimiter,
    auth_link_record_id,
    auth_link_token,
    csrf_token,
    hash_password,
    mysql_millis,
    session_token,
    token_hash,
    utc_iso,
    verify_auth_link,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "staff_session"


def invalid_link() -> ApiError:
    return ApiError(
        400, "AUTH_LINK_INVALID", "Authentication link is invalid or expired"
    )


def limit(request: Request, scope: str, account: str | None = None) -> None:
    limiter: RateLimiter = request.app.state.rate_limiter
    limiter.consume(f"{scope}:ip", request.client.host if request.client else "unknown")
    if account:
        limiter.consume(f"{scope}:account", account)


def set_cookie(
    response: Response, token: str, expires: datetime, config: Settings
) -> None:
    response.set_cookie(
        COOKIE,
        token,
        expires=expires.replace(tzinfo=UTC),
        httponly=True,
        secure=config.production,
        samesite="lax",
        path="/",
    )


@router.post("/login")
def login(
    values: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, object]:
    limit(request, "login", str(values.email))
    with db.connect() as connection:
        user = row(
            connection,
            """SELECT id, email, password_hash, system_role, active
               FROM staff_users WHERE email_normalized = :email""",
            {"email": str(values.email).lower()},
        )
    if not user:
        hash_password(values.password)
        raise ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password")
    if (
        not verify_password(user["password_hash"], values.password)
        or not user["active"]
    ):
        raise ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password")

    raw = session_token()
    expires = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        seconds=config.session_ttl_seconds
    )
    old = request.cookies.get(COOKIE)
    with db.transaction() as connection:
        if old:
            execute(
                connection,
                "UPDATE sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE token_hash=:hash AND revoked_at IS NULL",
                {"hash": token_hash(old)},
            )
        execute(
            connection,
            """INSERT INTO sessions
               (id,user_id,token_hash,expires_at,created_at,last_used_at)
               VALUES (:id,:user,:hash,:expires,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": str(uuid4()),
                "user": user["id"],
                "hash": token_hash(raw),
                "expires": expires,
            },
        )
        execute(
            connection,
            "UPDATE staff_users SET last_login_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": user["id"]},
        )
    set_cookie(response, raw, expires, config)
    return {
        "authenticated": True,
        "csrfToken": csrf_token(raw, config.session_secret),
        "expiresAt": utc_iso(expires),
        "user": {"id": user["id"], "email": user["email"], "role": user["system_role"]},
    }


@router.post("/logout")
def logout(
    response: Response,
    staff: Annotated[Staff, Depends(csrf_staff)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, str]:
    with db.transaction() as connection:
        execute(
            connection,
            "UPDATE sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=:id AND revoked_at IS NULL",
            {"id": staff.session_id},
        )
    response.delete_cookie(
        COOKIE, path="/", httponly=True, secure=config.production, samesite="lax"
    )
    return {"status": "accepted"}


@router.get("/session")
def session(staff: Annotated[Staff, Depends(current_staff)]) -> dict[str, object]:
    return {
        "authenticated": True,
        "csrfToken": staff.csrf,
        "expiresAt": utc_iso(staff.expires_at),
        "user": {"id": staff.id, "email": staff.email, "role": staff.role},
    }


@router.post("/password/forgot", status_code=202)
def forgot_password(
    values: PasswordForgotRequest,
    request: Request,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, str]:
    limit(request, "password-forgot")
    with db.connect() as connection:
        user = row(
            connection,
            "SELECT id,email FROM staff_users WHERE email_normalized=:email AND active=true",
            {"email": str(values.email).lower()},
        )
    if not user:
        return {"status": "accepted"}
    record_id = str(uuid4())
    expires = mysql_millis(
        datetime.now(UTC).replace(tzinfo=None)
        + timedelta(seconds=config.password_reset_ttl_seconds)
    )
    token = auth_link_token(
        "password-reset", record_id, expires, config.auth_link_secret
    )
    with db.transaction() as connection:
        execute(
            connection,
            "UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP(3) WHERE user_id=:id AND used_at IS NULL",
            {"id": user["id"]},
        )
        execute(
            connection,
            """INSERT INTO password_reset_tokens
               (id,user_id,token_hash,expires_at,created_at)
               VALUES (:id,:user,:hash,:expires,UTC_TIMESTAMP(3))""",
            {
                "id": record_id,
                "user": user["id"],
                "hash": token_hash(token),
                "expires": expires,
            },
        )
        execute(
            connection,
            """INSERT INTO email_deliveries
               (id,idempotency_key,type,recipient_email,staff_user_id,
                password_reset_token_id,status,attempts,queued_at,created_at,updated_at)
               VALUES (:delivery,:key,'PASSWORD_RESET',:email,:user,:record,
                       'QUEUED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "delivery": str(uuid4()),
                "key": f"password-reset:{record_id}",
                "email": user["email"],
                "user": user["id"],
                "record": record_id,
            },
        )
    return {"status": "accepted"}


@router.post("/password/reset")
def reset_password(
    values: PasswordResetRequest,
    request: Request,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, str]:
    limit(request, "password-reset")
    record_id = auth_link_record_id(values.token)
    if not record_id:
        raise invalid_link()
    password = hash_password(values.password)
    with db.transaction() as connection:
        record = row(
            connection,
            """SELECT id,user_id,token_hash,expires_at,used_at
               FROM password_reset_tokens WHERE id=:id FOR UPDATE""",
            {"id": record_id},
        )
        now = datetime.now(UTC).replace(tzinfo=None)
        if (
            not record
            or record["used_at"]
            or record["expires_at"] <= now
            or not verify_auth_link(
                values.token,
                "password-reset",
                record["id"],
                record["expires_at"],
                record["token_hash"],
                config.auth_link_secret,
            )
        ):
            raise invalid_link()
        changed = execute(
            connection,
            """UPDATE staff_users SET password_hash=:hash,
                      password_changed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
               WHERE id=:id AND active=true""",
            {"hash": password, "id": record["user_id"]},
        )
        if not changed:
            raise invalid_link()
        execute(
            connection,
            "UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": record_id},
        )
        execute(
            connection,
            "UPDATE sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE user_id=:id AND revoked_at IS NULL",
            {"id": record["user_id"]},
        )
    return {"status": "accepted"}


@router.post("/invitations/{token}/accept")
def accept_invitation(
    token: str,
    values: InvitationAcceptRequest,
    request: Request,
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, str]:
    limit(request, "invitation-accept")
    record_id = auth_link_record_id(token)
    if not record_id:
        raise invalid_link()
    password = hash_password(values.password)
    with db.transaction() as connection:
        invitation = row(
            connection,
            """SELECT id,email_normalized,event_id,role,token_hash,expires_at,
                      accepted_at,invited_by
               FROM staff_invitations WHERE id=:id FOR UPDATE""",
            {"id": record_id},
        )
        now = datetime.now(UTC).replace(tzinfo=None)
        if (
            not invitation
            or invitation["accepted_at"]
            or invitation["expires_at"] <= now
            or invitation["role"] != "SCANNER"
            or not verify_auth_link(
                token,
                "invitation",
                invitation["id"],
                invitation["expires_at"],
                invitation["token_hash"],
                config.auth_link_secret,
            )
        ):
            raise invalid_link()
        if row(
            connection,
            "SELECT id FROM staff_users WHERE email_normalized=:email",
            {"email": invitation["email_normalized"]},
        ):
            raise ApiError(409, "CONFLICT", "Account already exists")
        user_id = str(uuid4())
        execute(
            connection,
            """INSERT INTO staff_users
               (id,email,email_normalized,password_hash,system_role,active,
                password_changed_at,created_at,updated_at)
               VALUES (:id,:email,:email,:hash,'SCANNER',true,
                       UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {"id": user_id, "email": invitation["email_normalized"], "hash": password},
        )
        if invitation["event_id"]:
            execute(
                connection,
                """INSERT INTO event_access
                   (id,event_id,user_id,role,created_by,created_at)
                   VALUES (:id,:event,:user,'SCANNER',:actor,UTC_TIMESTAMP(3))""",
                {
                    "id": str(uuid4()),
                    "event": invitation["event_id"],
                    "user": user_id,
                    "actor": invitation["invited_by"],
                },
            )
        execute(
            connection,
            "UPDATE staff_invitations SET accepted_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": record_id},
        )
    return {"status": "accepted"}
