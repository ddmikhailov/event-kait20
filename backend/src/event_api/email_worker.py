from __future__ import annotations

import html
import smtplib
import ssl
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any

from sqlalchemy import text

from .config import Settings, get_settings
from .database import Database
from .registration_service import ticket_url
from .security import AuthPurpose, auth_link_token


@dataclass(frozen=True)
class Delivery:
    id: str
    type: str
    recipient: str
    attempts: int
    event_title: str | None
    event_start: datetime | None
    event_location: str | None
    public_id: str | None
    participant_name: str | None
    invitation_id: str | None
    invitation_expires: datetime | None
    reset_id: str | None
    reset_expires: datetime | None
    invitation_role: str | None = None


def _load_delivery(database: Database, delivery_id: str, attempts: int) -> Delivery:
    with database.engine.connect().execution_options(
        isolation_level="READ COMMITTED"
    ) as connection:
        item = (
            connection.execute(
                text(
                    """SELECT d.id,d.type,d.recipient_email,
                              CASE WHEN s.id IS NULL THEN e.title ELSE CONCAT(e.title,' — ',s.title) END AS event_title,
                              COALESCE(s.start_at,e.start_at) AS event_start,
                              e.location AS event_location,r.public_id,
                              CONCAT_WS(' ',r.last_name,r.first_name,r.middle_name) AS participant_name,
                              i.id AS invitation_id,i.expires_at AS invitation_expires,i.role AS invitation_role,
                              p.id AS reset_id,p.expires_at AS reset_expires
                       FROM email_deliveries d
                       LEFT JOIN events e ON e.id=d.event_id
                       LEFT JOIN registrations r ON r.id=d.registration_id
                       LEFT JOIN event_streams s ON s.id=r.stream_id
                       LEFT JOIN staff_invitations i ON i.id=d.staff_invitation_id
                       LEFT JOIN password_reset_tokens p ON p.id=d.password_reset_token_id
                       WHERE d.id=:id"""
                ),
                {"id": delivery_id},
            )
            .mappings()
            .one()
        )
    return Delivery(
        id=item["id"],
        type=item["type"],
        recipient=item["recipient_email"],
        attempts=attempts,
        event_title=item["event_title"],
        event_start=item["event_start"],
        event_location=item["event_location"],
        public_id=item["public_id"],
        participant_name=item["participant_name"],
        invitation_id=item["invitation_id"],
        invitation_expires=item["invitation_expires"],
        reset_id=item["reset_id"],
        reset_expires=item["reset_expires"],
        invitation_role=item["invitation_role"],
    )


def _claim(database: Database) -> Delivery | None:
    for _ in range(3):
        claimed_item: Any = None
        with (
            database.engine.connect().execution_options(
                isolation_level="READ COMMITTED"
            ) as connection,
            connection.begin(),
        ):
            item = (
                connection.execute(
                    text(
                        """SELECT id,attempts FROM email_deliveries
                               WHERE (status='QUEUED' AND
                                 (next_attempt_at IS NULL OR next_attempt_at<=UTC_TIMESTAMP(3))) OR
                                 (status='SENDING' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
                               ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED"""
                    )
                )
                .mappings()
                .first()
            )
            if not item:
                return None
            claimed = connection.execute(
                text(
                    """UPDATE email_deliveries SET status='SENDING',attempts=attempts+1,
                           last_error_code=NULL,next_attempt_at=NULL,updated_at=UTC_TIMESTAMP(3)
                           WHERE id=:id AND (status='QUEUED' OR
                             (status='SENDING' AND updated_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)))"""
                ),
                {"id": item["id"]},
            )
            if claimed.rowcount == 1:
                claimed_item = item
        if claimed_item:
            return _load_delivery(
                database, claimed_item["id"], int(claimed_item["attempts"]) + 1
            )
    return None


def _auth_url(
    config: Settings, purpose: AuthPurpose, record_id: str, expires: datetime
) -> str:
    token = auth_link_token(purpose, record_id, expires, config.auth_link_secret)
    base = str(config.auth_link_base_url).rstrip("/")
    route = "invitation" if purpose == "invitation" else "password-reset"
    return f"{base}/{route}/{token}"


def _message(delivery: Delivery, config: Settings) -> EmailMessage:
    if delivery.type == "REGISTRATION_TICKET" and delivery.public_id:
        link = ticket_url(delivery.public_id, config)
        subject = f"Билет: {delivery.event_title or 'мероприятие'}"
        lines = [
            f"Здравствуйте, {delivery.participant_name or 'участник'}!",
            f"Ваш билет на мероприятие «{delivery.event_title or ''}»: {link}",
        ]
        if delivery.event_start:
            start = delivery.event_start.replace(tzinfo=UTC).astimezone(
                timezone(timedelta(hours=3))
            )
            lines.append(
                f"Дата и время: {start:%d.%m.%Y %H:%M} — московское время (UTC+3)"
            )
        if delivery.event_location:
            lines.append(f"Место: {delivery.event_location}")
        lines.append("Откройте билет и покажите QR-код сотруднику на входе.")
    elif (
        delivery.type == "STAFF_INVITATION"
        and delivery.invitation_id
        and delivery.invitation_expires
    ):
        link = _auth_url(
            config, "invitation", delivery.invitation_id, delivery.invitation_expires
        )
        subject = "Приглашение в систему регистрации"
        lines = [
            "Вас пригласили в систему в роли "
            + {
                "SUPER_ADMIN": "суперадминистратора.",
                "ORGANIZER": "организатора.",
                "SCANNER": "сканировщика.",
            }.get(delivery.invitation_role or "", "сотрудника."),
            f"Задайте пароль по одноразовой ссылке: {link}",
            "Если вы не ожидали это письмо, проигнорируйте его.",
        ]
    elif (
        delivery.type == "PASSWORD_RESET"
        and delivery.reset_id
        and delivery.reset_expires
    ):
        link = _auth_url(
            config, "password-reset", delivery.reset_id, delivery.reset_expires
        )
        subject = "Восстановление пароля"
        lines = [
            f"Для установки нового пароля откройте одноразовую ссылку: {link}",
            "Если вы не запрашивали восстановление, проигнорируйте письмо.",
        ]
    else:
        raise ValueError("DELIVERY_CONTEXT_INVALID")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((config.smtp_from_name, config.smtp_from_email or ""))
    message["To"] = delivery.recipient
    message["Message-ID"] = f"<{delivery.id}@event-registration>"
    message.set_content("\n\n".join(lines))
    button = {
        "REGISTRATION_TICKET": "Открыть билет",
        "STAFF_INVITATION": "Активировать учётную запись",
        "PASSWORD_RESET": "Установить новый пароль",
    }[delivery.type]
    body = "".join(
        f'<p style="margin:0 0 16px;line-height:1.6">{html.escape(line.replace(link, ""))}</p>'
        for line in lines
    )
    safe_link = html.escape(link, quote=True)
    message.add_alternative(
        '<!doctype html><html lang="ru"><body style="margin:0;background:#f4f2f8;font-family:Arial,sans-serif;color:#242038">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px">'
        '<tr><td style="padding:28px;background:#50398b;color:#fff;border-radius:16px 16px 0 0;font-size:22px;font-weight:bold">КАИТ №20 · Мероприятия</td></tr>'
        f'<tr><td style="padding:28px"><h1 style="font-size:24px;margin:0 0 24px">{html.escape(subject)}</h1>{body}'
        f'<p style="margin:28px 0"><a href="{safe_link}" style="display:inline-block;background:#50398b;color:#fff;padding:16px 24px;border-radius:8px;text-decoration:none;font-weight:bold">{button}</a></p>'
        '<p style="color:#625b70;font-size:13px">Ссылка персональная. Не пересылайте её посторонним.</p>'
        f'<p style="font-size:12px;overflow-wrap:anywhere">Если кнопка не работает: <a href="{safe_link}">{safe_link}</a></p>'
        "</td></tr></table></td></tr></table></body></html>",
        subtype="html",
    )
    return message


def _send(message: EmailMessage, config: Settings) -> str:
    if not config.smtp_host:
        raise RuntimeError("SMTP_NOT_CONFIGURED")
    with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=30) as smtp:
        if config.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if config.smtp_username:
            smtp.login(config.smtp_username, config.smtp_password or "")
        refused = smtp.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    return str(message["Message-ID"])


def process_once(
    database: Database | None = None,
    config: Settings | None = None,
    sender: Any = _send,
) -> int:
    config = config or get_settings()
    if not config.smtp_host:
        return 0
    owned = database is None
    database = database or Database(config)
    delivery = _claim(database)
    if not delivery:
        if owned:
            database.dispose()
        return 0
    try:
        provider_id = sender(_message(delivery, config), config)
    except Exception as error:
        code = type(error).__name__.upper()[:64]
        if isinstance(error, smtplib.SMTPResponseException):
            code = f"SMTP_{error.smtp_code}"
        status = (
            "FAILED" if delivery.attempts >= config.email_max_attempts else "QUEUED"
        )
        retry_at = (
            datetime.now(UTC).replace(tzinfo=None)
            + timedelta(seconds=min(60 * 2 ** min(delivery.attempts - 1, 6), 3600))
            if status == "QUEUED"
            else None
        )
        with database.transaction() as connection:
            connection.execute(
                text(
                    """UPDATE email_deliveries SET status=:status,last_error_code=:code,next_attempt_at=:retry,
                       updated_at=UTC_TIMESTAMP(3) WHERE id=:id"""
                ),
                {"status": status, "code": code, "id": delivery.id, "retry": retry_at},
            )
    else:
        with database.transaction() as connection:
            connection.execute(
                text(
                    """UPDATE email_deliveries SET status='SENT',provider_message_id=:provider,
                       sent_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=:id"""
                ),
                {"provider": provider_id[:255], "id": delivery.id},
            )
    finally:
        if owned:
            database.dispose()
    return 1


def main() -> None:
    config = get_settings()
    if config.production and not config.smtp_host:
        raise RuntimeError("SMTP_HOST is required in production")
    database = Database(config)
    try:
        while True:
            if not process_once(database, config):
                time.sleep(config.email_poll_interval_ms / 1_000)
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
