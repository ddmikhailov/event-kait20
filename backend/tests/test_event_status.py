from datetime import UTC, datetime, timedelta, timezone

import pytest

from event_api.event_status import effective_status

START = datetime(2027, 9, 1, 9, tzinfo=UTC)
EVENT = {
    "status": "REGISTRATION_OPEN",
    "start_at": START,
    "end_at": START + timedelta(hours=2),
    "registration_deadline": START - timedelta(hours=1),
}


@pytest.mark.parametrize(
    ("time", "expected"),
    [
        (START - timedelta(hours=1, microseconds=1), "REGISTRATION_OPEN"),
        (START - timedelta(hours=1), "REGISTRATION_CLOSED"),
        (START - timedelta(microseconds=1), "REGISTRATION_CLOSED"),
        (START, "ACTIVE"),
        (START + timedelta(hours=2) - timedelta(microseconds=1), "ACTIVE"),
        (START + timedelta(hours=2), "COMPLETED"),
    ],
)
def test_exact_status_boundaries(time: datetime, expected: str) -> None:
    assert effective_status(EVENT, time) == expected
    assert (
        effective_status(EVENT, time.astimezone(timezone(timedelta(hours=3))))
        == expected
    )


@pytest.mark.parametrize("status", ["DRAFT", "ARCHIVED", "COMPLETED"])
def test_automatic_status_never_republishes_hidden_or_manually_finished_event(
    status: str,
) -> None:
    assert effective_status({**EVENT, "status": status}, START) == status


def test_manual_close_and_naive_mysql_utc_dates() -> None:
    assert (
        effective_status(
            {**EVENT, "status": "REGISTRATION_CLOSED"}, START - timedelta(days=1)
        )
        == "REGISTRATION_CLOSED"
    )
    naive = {
        key: value.replace(tzinfo=None) if isinstance(value, datetime) else value
        for key, value in EVENT.items()
    }
    assert effective_status(naive, START) == "ACTIVE"
