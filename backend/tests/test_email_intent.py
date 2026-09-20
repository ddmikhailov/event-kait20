"""Targeted, DB-free tests for `intent_cancellation_reason` — the single
function that decides SEND vs CANCEL for a claimed email delivery. Every
scenario is expressed directly as a `Delivery` value, since the function is
pure and the decision logic lives entirely in it; DB-backed tests in
`test_backend.py` separately prove the worker/router wiring around it."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from event_api.email_worker import (
    INVITATION_ACCEPTED,
    INVITATION_EXPIRED,
    INVITATION_MISSING,
    REGISTRATION_CANCELLED,
    REGISTRATION_MISSING,
    RESET_TOKEN_EXPIRED,
    RESET_TOKEN_MISSING,
    RESET_TOKEN_SUPERSEDED,
    RESET_TOKEN_USED,
    Delivery,
    intent_cancellation_reason,
)

NOW = datetime.now(UTC).replace(tzinfo=None)
FUTURE = NOW + timedelta(hours=1)
PAST = NOW - timedelta(hours=1)


def _delivery(**overrides: object) -> Delivery:
    fields: dict[str, object] = {
        "id": "delivery-id",
        "type": "PASSWORD_RESET",
        "recipient": "person@example.org",
        "attempts": 1,
        "event_title": None,
        "event_start": None,
        "event_location": None,
        "public_id": None,
        "registration_status": None,
        "participant_name": None,
        "invitation_id": None,
        "invitation_expires": None,
        "invitation_accepted_at": None,
        "reset_id": None,
        "reset_expires": None,
        "reset_used_at": None,
        "reset_superseded": False,
        "invitation_role": None,
    }
    fields.update(overrides)
    return Delivery(**fields)  # type: ignore[arg-type]


# --- A/D: password reset --------------------------------------------------


def test_a_current_valid_password_reset_is_sendable() -> None:
    delivery = _delivery(
        type="PASSWORD_RESET", reset_id="reset-1", reset_expires=FUTURE
    )
    assert intent_cancellation_reason(delivery) is None


def test_b_superseded_reset_is_cancelled_with_superseded_reason() -> None:
    delivery = _delivery(
        type="PASSWORD_RESET",
        reset_id="reset-1",
        reset_expires=FUTURE,
        reset_used_at=NOW,
        reset_superseded=True,
    )
    assert intent_cancellation_reason(delivery) == RESET_TOKEN_SUPERSEDED


def test_c_already_used_reset_is_cancelled_with_used_reason() -> None:
    delivery = _delivery(
        type="PASSWORD_RESET",
        reset_id="reset-1",
        reset_expires=FUTURE,
        reset_used_at=NOW,
        reset_superseded=False,
    )
    assert intent_cancellation_reason(delivery) == RESET_TOKEN_USED


def test_d_expired_reset_is_cancelled_with_expired_reason() -> None:
    delivery = _delivery(type="PASSWORD_RESET", reset_id="reset-1", reset_expires=PAST)
    assert intent_cancellation_reason(delivery) == RESET_TOKEN_EXPIRED


def test_reset_missing_source_row_is_cancelled_defensively() -> None:
    # Not reachable today (FK RESTRICT prevents deleting a referenced token
    # row), but the join can legitimately return NULL, so this must fail
    # closed rather than crash or assume sendable.
    delivery = _delivery(type="PASSWORD_RESET", reset_id=None)
    assert intent_cancellation_reason(delivery) == RESET_TOKEN_MISSING


# --- staff invitation -------------------------------------------------


def test_current_valid_invitation_is_sendable() -> None:
    delivery = _delivery(
        type="STAFF_INVITATION", invitation_id="invite-1", invitation_expires=FUTURE
    )
    assert intent_cancellation_reason(delivery) is None


def test_accepted_invitation_is_cancelled() -> None:
    delivery = _delivery(
        type="STAFF_INVITATION",
        invitation_id="invite-1",
        invitation_expires=FUTURE,
        invitation_accepted_at=NOW,
    )
    assert intent_cancellation_reason(delivery) == INVITATION_ACCEPTED


def test_expired_invitation_is_cancelled() -> None:
    delivery = _delivery(
        type="STAFF_INVITATION", invitation_id="invite-1", invitation_expires=PAST
    )
    assert intent_cancellation_reason(delivery) == INVITATION_EXPIRED


def test_invitation_missing_source_row_is_cancelled_defensively() -> None:
    delivery = _delivery(type="STAFF_INVITATION", invitation_id=None)
    assert intent_cancellation_reason(delivery) == INVITATION_MISSING


# --- H: registration ticket ---------------------------------------------


def test_active_registration_ticket_is_sendable() -> None:
    delivery = _delivery(
        type="REGISTRATION_TICKET",
        public_id="public-1",
        registration_status="ACTIVE",
    )
    assert intent_cancellation_reason(delivery) is None


def test_h_cancelled_registration_ticket_is_cancelled() -> None:
    delivery = _delivery(
        type="REGISTRATION_TICKET",
        public_id="public-1",
        registration_status="ANNULLED",
    )
    assert intent_cancellation_reason(delivery) == REGISTRATION_CANCELLED


def test_registration_missing_source_row_is_cancelled_defensively() -> None:
    delivery = _delivery(type="REGISTRATION_TICKET", public_id=None)
    assert intent_cancellation_reason(delivery) == REGISTRATION_MISSING


def test_registration_ticket_ignores_cosmetic_event_changes() -> None:
    # event_title/event_location changing is not modeled as an intent input
    # at all — the function only ever looks at registration_status for this
    # type, so a cosmetic Event edit can never appear as a cancellation.
    delivery = _delivery(
        type="REGISTRATION_TICKET",
        public_id="public-1",
        registration_status="ACTIVE",
        event_title="Renamed after ticket was queued",
        event_location="A different room now",
    )
    assert intent_cancellation_reason(delivery) is None


# --- G: types with no source intent ---------------------------------------


def test_g_unknown_or_future_snapshot_type_is_always_sendable() -> None:
    # No generic/manual/snapshot email type exists in this codebase today;
    # this proves the fallback a future one would get is "always sendable",
    # not "always cancelled" or a crash.
    delivery = _delivery(type="FUTURE_ANNOUNCEMENT_TYPE")
    assert intent_cancellation_reason(delivery) is None


# --- I: reason codes never carry token/secret material ---------------------


def test_i_reason_codes_are_fixed_strings_without_recipient_or_token_data() -> None:
    secret_recipient = "victim+SuperSecretToken123@example.org"  # noqa: S105 - fixture value, not a real credential
    for delivery, expected in (
        (
            _delivery(
                type="PASSWORD_RESET",
                recipient=secret_recipient,
                reset_id="reset-1",
                reset_expires=FUTURE,
                reset_used_at=NOW,
                reset_superseded=True,
            ),
            RESET_TOKEN_SUPERSEDED,
        ),
        (
            _delivery(
                type="STAFF_INVITATION",
                recipient=secret_recipient,
                invitation_id="invite-1",
                invitation_expires=FUTURE,
                invitation_accepted_at=NOW,
            ),
            INVITATION_ACCEPTED,
        ),
        (
            _delivery(
                type="REGISTRATION_TICKET",
                recipient=secret_recipient,
                public_id="public-1",
                registration_status="ANNULLED",
            ),
            REGISTRATION_CANCELLED,
        ),
    ):
        reason = intent_cancellation_reason(delivery)
        assert reason == expected
        assert secret_recipient not in reason
        assert "SuperSecretToken123" not in reason
        assert reason.isupper() and reason.replace("_", "").isalnum()
