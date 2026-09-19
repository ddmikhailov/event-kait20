import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from event_api.activity_service import award_score
from event_api.database import Database
from event_api.routers.scoring_v2 import _status_retirement_boundary
from event_api.scoring_v2 import (
    ScoringInput,
    _local_date,
    calculate,
    decimal_string,
)

ORIGIN = {"Origin": "http://localhost:5173"}


def login(client: TestClient) -> dict[str, str]:
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def policy_values(role_value: str = "3.0000") -> dict[str, object]:
    return {
        "roleBases": [
            {
                "classifierId": "30000000-0000-4000-8000-000000000004",
                "value": role_value,
            }
        ],
        "levelMultipliers": [
            {
                "classifierId": "20000000-0000-4000-8000-000000000003",
                "value": "2.0000",
            }
        ],
        "statusMultipliers": [
            {
                "classifierId": "62000000-0000-4000-8000-000000000001",
                "value": "1.5000",
            }
        ],
        "newcomerTiers": [
            {"sequenceFrom": 1, "sequenceTo": 1, "value": "1.5000"},
            {"sequenceFrom": 2, "sequenceTo": 2, "value": "1.3000"},
            {"sequenceFrom": 3, "sequenceTo": 3, "value": "1.2000"},
            {"sequenceFrom": 4, "sequenceTo": None, "value": "1.0000"},
        ],
        "resultBonuses": [
            {
                "classifierId": "40000000-0000-4000-8000-000000000001",
                "value": "5.0000",
            }
        ],
    }


def create_policy(
    client: TestClient,
    headers: dict[str, str],
    *,
    role_value: str = "3.0000",
    effective_from: str = "2026-01-01T00:00:00Z",
    effective_to: str | None = None,
    publish: bool = True,
) -> tuple[str, str]:
    policy = client.post(
        "/admin/activity/scoring-v2/policies",
        headers=headers,
        json={"code": f"TEST_{uuid4().hex[:10].upper()}", "name": "Test policy"},
    )
    assert policy.status_code == 201, policy.text
    version = client.post(
        f"/admin/activity/scoring-v2/policies/{policy.json()['id']}/versions",
        headers=headers,
        json=policy_values(role_value),
    )
    assert version.status_code == 201, version.text
    if publish:
        payload: dict[str, str] = {"effectiveFrom": effective_from}
        if effective_to:
            payload["effectiveTo"] = effective_to
        response = client.post(
            f"/admin/activity/scoring-v2/versions/{version.json()['id']}/publish",
            headers=headers,
            json=payload,
        )
        assert response.status_code == 200, response.text
    return policy.json()["id"], version.json()["id"]


def create_season(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"S_{uuid4().hex[:10].upper()}",
            "name": "Scoring test",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2031-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def activate_policy(
    client: TestClient,
    headers: dict[str, str],
    season_id: str,
    policy_id: str,
    effective_from: str,
) -> None:
    response = client.post(
        f"/admin/activity/scoring-v2/seasons/{season_id}/policy",
        headers=headers,
        json={"scoringPolicyId": policy_id, "effectiveFrom": effective_from},
    )
    assert response.status_code == 200, response.text


def create_event(
    client: TestClient,
    headers: dict[str, str],
    season_id: str,
    start_at: str,
) -> str:
    end_at = (
        (datetime.fromisoformat(start_at.replace("Z", "+00:00")) + timedelta(hours=2))
        .isoformat()
        .replace("+00:00", "Z")
    )
    response = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Scoring event",
            "slug": f"scoring-{uuid4().hex[:12]}",
            "description": "Scoring test",
            "startAt": start_at,
            "endAt": end_at,
            "registrationDeadline": start_at,
            "timezone": "Europe/Moscow",
            "location": "КАИТ №20",
            "capacity": 50,
            "status": "DRAFT",
            "seasonId": season_id,
            "levelId": "20000000-0000-4000-8000-000000000003",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_v1_rule(
    client: TestClient, headers: dict[str, str], season_id: str, points: int = 7
) -> None:
    response = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season_id,
            "eventCategoryId": None,
            "eventLevelId": None,
            "participationRoleId": "30000000-0000-4000-8000-000000000004",
            "participationResultId": None,
            "points": points,
            "priority": 1,
            "active": True,
            "validFrom": "2026-01-01T00:00:00Z",
            "validTo": "2027-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 201, response.text


def create_registration(
    database: Database, event_id: str, person_id: str | None = None
) -> tuple[str, str]:
    person = person_id or str(uuid4())
    registration = str(uuid4())
    with database.transaction() as connection:
        if person_id is None:
            connection.execute(
                text("""INSERT INTO persons
                (id,tenant_id,last_name,first_name,email,email_normalized,person_type,
                 dedup_review_required,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001','Тестов','Score',
                        :email,:email,'KAIT_STUDENT',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
                {"id": person, "email": f"{person}@example.test"},
            )
        connection.execute(
            text("""INSERT INTO registrations
            (id,public_id,event_id,person_id,source,status,last_name,first_name,email,
             person_type,consent_accepted,registered_at,first_attended_at,created_at,updated_at)
            VALUES (:id,:public,:event,:person,'ADMIN_MANUAL','ACTIVE','Тестов','Score',
                    :email,'KAIT_STUDENT',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "id": registration,
                "public": str(uuid4()),
                "event": event_id,
                "person": person,
                "email": f"{person}@example.test",
            },
        )
    return registration, person


def assign_participation(
    client: TestClient, headers: dict[str, str], event_id: str, registration_id: str
) -> str:
    response = client.post(
        f"/admin/events/{event_id}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
            "reason": "Scoring test",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["participationIds"][0]


def scoring_input(
    *,
    role: str = "3.0000",
    level: str = "2.0000",
    statuses: tuple[str, ...] = ("1.5000",),
    newcomer: str = "1.3000",
    result: str | None = "5.0000",
    sequence: int = 2,
) -> ScoringInput:
    return ScoringInput(
        role={"id": "role", "code": "ORGANIZER", "name": "Organizer", "value": role},
        level={"id": "level", "code": "CITY", "name": "City", "value": level},
        statuses=tuple(
            {
                "id": f"status-{index}",
                "code": f"STATUS_{index}",
                "name": "Status",
                "value": value,
            }
            for index, value in enumerate(statuses)
        ),
        newcomer={"sequence": sequence, "value": newcomer},
        result=(
            {"id": "result", "code": "WINNER", "name": "Winner", "value": result}
            if result is not None
            else None
        ),
    )


def test_formula_is_exact_and_bonus_is_added_after_multipliers() -> None:
    total, snapshot = calculate(scoring_input())
    assert total == Decimal("16.7000")
    assert snapshot["total"] == "16.7000"
    assert total != Decimal("20.8000")  # (role + bonus) * modifiers


def test_status_date_uses_moscow_calendar_boundary() -> None:
    assert _local_date(datetime(2026, 12, 31, 20, 59, tzinfo=UTC)) == "2026-12-31"
    assert _local_date(datetime(2026, 12, 31, 21, 0, tzinfo=UTC)) == "2027-01-01"


@pytest.mark.parametrize(
    ("value", "expected"),
    [("0.5", "0.5000"), ("1", "1.0000"), ("3", "3.0000"), ("5", "5.0000")],
)
def test_role_base_values(value: str, expected: str) -> None:
    total, _ = calculate(
        scoring_input(role=value, level="1", statuses=(), newcomer="1", result=None)
    )
    assert decimal_string(total) == expected


@pytest.mark.parametrize(
    ("sequence", "multiplier"),
    [(1, "1.5"), (2, "1.3"), (3, "1.2"), (4, "1"), (10, "1")],
)
def test_newcomer_tiers(sequence: int, multiplier: str) -> None:
    total, _ = calculate(
        scoring_input(
            role="1",
            level="1",
            statuses=(),
            newcomer=multiplier,
            result=None,
            sequence=sequence,
        )
    )
    assert total == Decimal(multiplier).quantize(Decimal("0.0001"))


def test_mysql_migration_preserves_legacy_decimal_and_seeds_policy(
    client: TestClient,
) -> None:
    database: Database = client.app.state.database
    with database.connect() as connection:
        column = (
            connection.execute(
                text("""SELECT DATA_TYPE,NUMERIC_PRECISION,NUMERIC_SCALE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='score_transactions' AND COLUMN_NAME='points'""")
            )
            .mappings()
            .one()
        )
        assert dict(column) == {
            "DATA_TYPE": "decimal",
            "NUMERIC_PRECISION": 12,
            "NUMERIC_SCALE": 4,
        }
        policy = connection.execute(
            text(
                "SELECT code FROM scoring_policies WHERE id='60000000-0000-4000-8000-000000000001'"
            )
        ).scalar_one()
        version = connection.execute(
            text(
                "SELECT status FROM scoring_policy_versions WHERE id='61000000-0000-4000-8000-000000000001'"
            )
        ).scalar_one()
        assert policy == "KAIT20_DEFAULT"
        assert version == "DRAFT"
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM seasons WHERE scoring_policy_id IS NOT NULL")
            ).scalar_one()
            == 0
        )


def test_seeded_classifier_values_are_exact(client: TestClient) -> None:
    database: Database = client.app.state.database
    with database.connect() as connection:
        roles = dict(
            connection.execute(
                text("""SELECT r.code,b.value FROM scoring_policy_role_bases b
          JOIN participation_roles r ON r.id=b.role_id WHERE b.policy_version_id='61000000-0000-4000-8000-000000000001'""")
            ).all()
        )
        levels = dict(
            connection.execute(
                text("""SELECT l.code,m.value FROM scoring_policy_level_multipliers m
          JOIN event_levels l ON l.id=m.level_id WHERE m.policy_version_id='61000000-0000-4000-8000-000000000001'""")
            ).all()
        )
    assert {key: decimal_string(value) for key, value in roles.items()} == {
        "PARTICIPANT": "0.5000",
        "SPECTATOR": "0.5000",
        "VOLUNTEER": "1.0000",
        "CO_ORGANIZER": "2.0000",
        "ORGANIZER": "3.0000",
        "COORDINATOR": "5.0000",
    }
    assert {key: decimal_string(value) for key, value in levels.items()} == {
        "DEPARTMENT": "0.5000",
        "COLLEGE": "1.0000",
        "CITY": "2.0000",
        "DISTRICT": "3.0000",
        "FEDERAL": "5.0000",
    }


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("LAUREATE", "2.0000"),
        ("DIPLOMANT", "2.0000"),
        ("ACKNOWLEDGEMENT", "2.0000"),
        ("PRIZE_3", "3.0000"),
        ("LAUREATE_III", "3.0000"),
        ("PRIZE_2", "4.0000"),
        ("LAUREATE_II", "4.0000"),
        ("WINNER", "5.0000"),
        ("LAUREATE_I", "5.0000"),
        ("GRAND_PRIX", "10.0000"),
        ("ABSOLUTE_WINNER", "10.0000"),
    ],
)
def test_kait20_result_mappings(client: TestClient, code: str, expected: str) -> None:
    database: Database = client.app.state.database
    with database.connect() as connection:
        value = connection.execute(
            text("""SELECT b.value FROM scoring_policy_result_bonuses b
            JOIN participation_results r ON r.id=b.result_id
            WHERE b.policy_version_id='61000000-0000-4000-8000-000000000001'
              AND r.code=:code"""),
            {"code": code},
        ).scalar_one()
    assert decimal_string(value) == expected


def test_publish_rejects_incomplete_newcomer_coverage(client: TestClient) -> None:
    headers = login(client)
    _, version_id = create_policy(client, headers, publish=False)
    database: Database = client.app.state.database
    with database.transaction() as connection:
        connection.execute(
            text("""DELETE FROM scoring_policy_newcomer_tiers
            WHERE policy_version_id=:version AND sequence_from=2"""),
            {"version": version_id},
        )
    response = client.post(
        f"/admin/activity/scoring-v2/versions/{version_id}/publish",
        headers=headers,
        json={"effectiveFrom": "2028-01-01T00:00:00Z"},
    )
    assert (response.status_code, response.json()["error"]["code"]) == (
        409,
        "SCORING_POLICY_INVALID",
    )


def test_list_and_get_version_expose_camel_case_components(
    client: TestClient,
) -> None:
    headers = login(client)
    policy_id, version_id = create_policy(client, headers, publish=False)

    policies = client.get("/admin/activity/scoring-v2/policies", headers=headers)
    assert policies.status_code == 200, policies.text
    listed_policy = next(
        item for item in policies.json()["items"] if item["id"] == policy_id
    )
    assert listed_policy["organizationId"] and listed_policy["createdAt"]
    assert "organization_id" not in listed_policy

    versions = client.get(
        f"/admin/activity/scoring-v2/policies/{policy_id}/versions", headers=headers
    )
    assert versions.status_code == 200, versions.text
    listed_version = next(
        item for item in versions.json()["items"] if item["id"] == version_id
    )
    assert listed_version["scoringPolicyId"] == policy_id
    assert listed_version["status"] == "DRAFT"
    assert "scoring_policy_id" not in listed_version

    detail = client.get(
        f"/admin/activity/scoring-v2/versions/{version_id}", headers=headers
    )
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["status"] == "DRAFT"
    assert body["roleBases"] == [
        {"classifierId": "30000000-0000-4000-8000-000000000004", "value": "3.0000"}
    ]
    assert body["resultBonuses"] == [
        {"classifierId": "40000000-0000-4000-8000-000000000001", "value": "5.0000"}
    ]
    assert body["newcomerTiers"][0] == {
        "sequenceFrom": 1,
        "sequenceTo": 1,
        "value": "1.5000",
    }
    assert body["newcomerTiers"][-1]["sequenceTo"] is None

    statuses = client.get("/admin/activity/scoring-v2/status-types", headers=headers)
    assert statuses.status_code == 200, statuses.text
    codes = {item["code"] for item in statuses.json()["items"]}
    assert "PROFESSION_AMBASSADOR" in codes


def test_concurrent_overlapping_publish_is_serialized(client: TestClient) -> None:
    headers = login(client)
    policy_id, first_version = create_policy(client, headers, publish=False)
    second = client.post(
        f"/admin/activity/scoring-v2/policies/{policy_id}/versions",
        headers=headers,
        json=policy_values("4.0000"),
    )
    assert second.status_code == 201, second.text
    version_ids = (first_version, second.json()["id"])

    def publish(version_id: str) -> tuple[int, str | None]:
        response = client.post(
            f"/admin/activity/scoring-v2/versions/{version_id}/publish",
            headers=headers,
            json={
                "effectiveFrom": "2028-01-01T00:00:00Z",
                "effectiveTo": "2029-01-01T00:00:00Z",
            },
        )
        body = response.json()
        return response.status_code, body.get("error", {}).get("code")

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(publish, version_ids))
    assert sorted(outcomes) == [
        (200, None),
        (409, "SCORING_POLICY_PERIOD_CONFLICT"),
    ]
    database: Database = client.app.state.database
    with database.connect() as connection:
        published = connection.execute(
            text("""SELECT COUNT(*) FROM scoring_policy_versions
            WHERE scoring_policy_id=:policy AND status='PUBLISHED'"""),
            {"policy": policy_id},
        ).scalar_one()
    assert published == 1


def test_future_policy_retirement_is_controlled_and_idempotent(
    client: TestClient,
) -> None:
    headers = login(client)
    _, version_id = create_policy(
        client, headers, effective_from="2030-01-01T00:00:00Z"
    )
    route = f"/admin/activity/scoring-v2/versions/{version_id}/retire"
    first = client.post(route, headers=headers)
    second = client.post(route, headers=headers)
    assert first.status_code == second.status_code == 200
    database: Database = client.app.state.database
    with database.connect() as connection:
        version = (
            connection.execute(
                text("""SELECT status,effective_from,effective_to,retired_at
            FROM scoring_policy_versions WHERE id=:id"""),
                {"id": version_id},
            )
            .mappings()
            .one()
        )
        audits = connection.execute(
            text("""SELECT COUNT(*) FROM audit_log
            WHERE action='SCORING_POLICY_VERSION_CANCELLED' AND entity_id=:id"""),
            {"id": version_id},
        ).scalar_one()
    assert version["status"] == "CANCELLED"
    assert version["effective_to"] is None
    assert version["retired_at"] is not None
    assert audits == 1


def test_historical_engine_activation_boundary_preserves_v1(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = create_policy(client, headers)
    season_id = create_season(client, headers)
    rule = client.post(
        "/admin/activity/scoring-rules",
        headers=headers,
        json={
            "seasonId": season_id,
            "eventCategoryId": None,
            "eventLevelId": None,
            "participationRoleId": "30000000-0000-4000-8000-000000000004",
            "participationResultId": None,
            "points": 7,
            "priority": 1,
            "active": True,
            "validFrom": "2026-01-01T00:00:00Z",
            "validTo": "2027-01-01T00:00:00Z",
        },
    )
    assert rule.status_code == 201, rule.text
    activate_policy(client, headers, season_id, policy_id, "2026-09-15T00:00:00Z")
    old_event = create_event(client, headers, season_id, "2026-09-01T10:00:00Z")
    new_event = create_event(client, headers, season_id, "2026-09-20T10:00:00Z")
    old_registration, _ = create_registration(database, old_event)
    new_registration, _ = create_registration(database, new_event)
    old_participation = assign_participation(
        client, headers, old_event, old_registration
    )
    new_participation = assign_participation(
        client, headers, new_event, new_registration
    )
    for event_id, registration_id in (
        (old_event, old_registration),
        (new_event, new_registration),
    ):
        response = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={
                "registrationIds": [registration_id],
                "roleId": "30000000-0000-4000-8000-000000000004",
                "resultId": "40000000-0000-4000-8000-000000000001",
            },
        )
        assert response.status_code == 200, response.text
    with database.connect() as connection:
        awards = {
            item["participation_id"]: item
            for item in connection.execute(
                text("""SELECT participation_id,scoring_engine_version,points
                FROM score_transactions WHERE participation_id IN (:old,:new)
                  AND transaction_type='AWARD'"""),
                {"old": old_participation, "new": new_participation},
            ).mappings()
        }
    assert awards[old_participation]["scoring_engine_version"] == "V1"
    assert decimal_string(awards[old_participation]["points"]) == "7.0000"
    assert awards[new_participation]["scoring_engine_version"] == "V2"
    locked = client.post(
        f"/admin/activity/scoring-v2/seasons/{season_id}/policy",
        headers=headers,
        json={
            "scoringPolicyId": policy_id,
            "effectiveFrom": "2026-09-16T00:00:00Z",
        },
    )
    assert (locked.status_code, locked.json()["error"]["code"]) == (
        409,
        "SEASON_SCORING_POLICY_LOCKED",
    )


def test_v2_activation_cannot_cross_existing_v1_award(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = create_policy(client, headers)
    season_id = create_season(client, headers)
    create_v1_rule(client, headers, season_id)
    event_id = create_event(client, headers, season_id, "2026-09-01T10:00:00Z")
    first_registration, _ = create_registration(database, event_id)
    second_registration, _ = create_registration(database, event_id)
    first = assign_participation(client, headers, event_id, first_registration)
    second = assign_participation(client, headers, event_id, second_registration)

    first_confirmation = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [first_registration],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert first_confirmation.status_code == 200, first_confirmation.text

    retroactive = client.post(
        f"/admin/activity/scoring-v2/seasons/{season_id}/policy",
        headers=headers,
        json={
            "scoringPolicyId": policy_id,
            "effectiveFrom": "2026-09-01T00:00:00Z",
        },
    )
    assert (retroactive.status_code, retroactive.json()["error"]["code"]) == (
        409,
        "SEASON_SCORING_POLICY_RETROACTIVE_CONFLICT",
    )
    with database.connect() as connection:
        assignment = (
            connection.execute(
                text(
                    "SELECT scoring_policy_id,scoring_policy_effective_from FROM seasons WHERE id=:id"
                ),
                {"id": season_id},
            )
            .mappings()
            .one()
        )
    assert assignment["scoring_policy_id"] is None
    assert assignment["scoring_policy_effective_from"] is None

    delayed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [second_registration],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert delayed.status_code == 200, delayed.text
    with database.connect() as connection:
        engines = (
            connection.execute(
                text(
                    """SELECT scoring_engine_version FROM score_transactions
                WHERE participation_id IN (:first,:second)
                  AND transaction_type='AWARD' ORDER BY participation_id"""
                ),
                {"first": first, "second": second},
            )
            .scalars()
            .all()
        )
    assert engines == ["V1", "V1"]

    allowed = client.post(
        f"/admin/activity/scoring-v2/seasons/{season_id}/policy",
        headers=headers,
        json={
            "scoringPolicyId": policy_id,
            "effectiveFrom": "2026-09-02T00:00:00Z",
        },
    )
    assert allowed.status_code == 200, allowed.text


def test_reversed_v1_award_remains_in_newcomer_baseline(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = create_policy(client, headers)
    season_id = create_season(client, headers)
    create_v1_rule(client, headers, season_id)
    person_id: str | None = None
    history: list[tuple[str, str, str]] = []
    for day in (1, 2):
        event_id = create_event(
            client, headers, season_id, f"2026-08-{day:02d}T10:00:00Z"
        )
        registration_id, person_id = create_registration(database, event_id, person_id)
        participation_id = assign_participation(
            client, headers, event_id, registration_id
        )
        confirmed = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={
                "registrationIds": [registration_id],
                "roleId": "30000000-0000-4000-8000-000000000004",
                "resultId": "40000000-0000-4000-8000-000000000001",
            },
        )
        assert confirmed.status_code == 200, confirmed.text
        history.append((event_id, registration_id, participation_id))
    assert person_id is not None
    cancelled = client.post(
        f"/admin/events/{history[0][0]}/participations/cancel",
        headers=headers,
        json={"participationIds": [history[0][2]], "reason": "Historical baseline"},
    )
    assert cancelled.status_code == 200, cancelled.text

    activate_policy(client, headers, season_id, policy_id, "2026-09-01T00:00:00Z")
    event_id = create_event(client, headers, season_id, "2026-09-10T10:00:00Z")
    registration_id, _ = create_registration(database, event_id, person_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        sequence = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
    assert sequence == 3


def test_delayed_event_uses_historical_policy_version(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, version_one = create_policy(
        client,
        headers,
        role_value="3.0000",
        effective_from="2026-01-01T00:00:00Z",
        effective_to="2026-11-01T00:00:00Z",
    )
    version_two = client.post(
        f"/admin/activity/scoring-v2/policies/{policy_id}/versions",
        headers=headers,
        json=policy_values("4.0000"),
    )
    assert version_two.status_code == 201, version_two.text
    published = client.post(
        f"/admin/activity/scoring-v2/versions/{version_two.json()['id']}/publish",
        headers=headers,
        json={"effectiveFrom": "2026-11-01T00:00:00Z"},
    )
    assert published.status_code == 200, published.text
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    event_a = create_event(client, headers, season_id, "2026-10-15T10:00:00Z")
    event_b = create_event(client, headers, season_id, "2026-11-15T10:00:00Z")
    registration_a, _ = create_registration(database, event_a)
    registration_b, _ = create_registration(database, event_b)
    participation_a = assign_participation(client, headers, event_a, registration_a)
    participation_b = assign_participation(client, headers, event_b, registration_b)
    for event_id, registration_id in (
        (event_a, registration_a),
        (event_b, registration_b),
    ):
        response = client.post(
            f"/admin/events/{event_id}/participations/confirm",
            headers=headers,
            json={
                "registrationIds": [registration_id],
                "roleId": "30000000-0000-4000-8000-000000000004",
                "resultId": "40000000-0000-4000-8000-000000000001",
            },
        )
        assert response.status_code == 200, response.text
    with database.connect() as connection:
        awards = {
            item["participation_id"]: item
            for item in connection.execute(
                text("""SELECT participation_id,points,scoring_policy_version_id,
                calculation_snapshot FROM score_transactions
                WHERE participation_id IN (:first,:second) AND transaction_type='AWARD'"""),
                {"first": participation_a, "second": participation_b},
            ).mappings()
        }
    assert awards[participation_a]["scoring_policy_version_id"] == version_one
    assert decimal_string(awards[participation_a]["points"]) == "14.0000"
    assert decimal_string(awards[participation_b]["points"]) == "17.0000"
    first_snapshot = (
        json.loads(awards[participation_a]["calculation_snapshot"])
        if isinstance(awards[participation_a]["calculation_snapshot"], str)
        else awards[participation_a]["calculation_snapshot"]
    )
    assert first_snapshot["role"]["value"] == "3.0000"


def test_newcomer_concurrency_and_reversal_stability(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = create_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    first_event = create_event(client, headers, season_id, "2026-06-01T10:00:00Z")
    second_event = create_event(client, headers, season_id, "2026-06-02T10:00:00Z")
    first_registration, person_id = create_registration(database, first_event)
    second_registration, _ = create_registration(database, second_event, person_id)
    first = assign_participation(client, headers, first_event, first_registration)
    second = assign_participation(client, headers, second_event, second_registration)
    with database.connect() as connection:
        actor = connection.execute(
            text("SELECT id FROM staff_users WHERE system_role='SUPER_ADMIN' LIMIT 1")
        ).scalar_one()

    def confirm(participation_id: str) -> None:
        with database.transaction() as connection:
            connection.execute(
                text("""UPDATE participations SET status='CONFIRMED',scoring_cycle=1,
                confirmed_at=UTC_TIMESTAMP(3),confirmed_by=:actor WHERE id=:id"""),
                {"id": participation_id, "actor": actor},
            )
            award_score(connection, participation_id, actor)

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(confirm, (first, second)))
    with database.connect() as connection:
        sequences = dict(
            connection.execute(
                text(
                    "SELECT id,scoring_sequence FROM participations WHERE id IN (:first,:second)"
                ),
                {"first": first, "second": second},
            ).all()
        )
    assert sorted(sequences.values()) == [1, 2]

    cancelled = client.post(
        f"/admin/events/{first_event}/participations/cancel",
        headers=headers,
        json={"participationIds": [first], "reason": "Sequence stability"},
    )
    assert cancelled.status_code == 200, cancelled.text
    third_event = create_event(client, headers, season_id, "2026-06-03T10:00:00Z")
    third_registration, _ = create_registration(database, third_event, person_id)
    third = assign_participation(client, headers, third_event, third_registration)
    confirmed = client.post(
        f"/admin/events/{third_event}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [third_registration],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        stable = dict(
            connection.execute(
                text(
                    "SELECT id,scoring_sequence FROM participations WHERE id IN (:first,:second,:third)"
                ),
                {"first": first, "second": second, "third": third},
            ).all()
        )
    assert stable[first] == 1
    assert stable[second] == 2
    assert stable[third] == 3


def test_existing_history_sets_newcomer_baseline(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = create_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-09-01T00:00:00Z")
    history: list[tuple[str, str]] = []
    person_id: str | None = None
    for day in range(1, 6):
        event_id = create_event(
            client, headers, season_id, f"2026-08-{day:02d}T10:00:00Z"
        )
        registration_id, person_id = create_registration(database, event_id, person_id)
        participation_id = assign_participation(
            client, headers, event_id, registration_id
        )
        history.append((registration_id, participation_id))
    assert person_id is not None
    with database.transaction() as connection:
        for _registration_id, participation_id in history:
            connection.execute(
                text("""UPDATE participations SET status='CONFIRMED',scoring_cycle=1,
                confirmed_at=UTC_TIMESTAMP(3) WHERE id=:id"""),
                {"id": participation_id},
            )
    event_id = create_event(client, headers, season_id, "2026-09-10T10:00:00Z")
    registration_id, _ = create_registration(database, event_id, person_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)
    response = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert response.status_code == 200, response.text
    with database.connect() as connection:
        sequence = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
        points = connection.execute(
            text("""SELECT points FROM score_transactions
            WHERE participation_id=:id AND transaction_type='AWARD'"""),
            {"id": participation_id},
        ).scalar_one()
    assert sequence == 6
    assert decimal_string(points) == "11.0000"  # 3 * 2 * 1 + 5


def _create_no_result_policy(
    client: TestClient, headers: dict[str, str]
) -> tuple[str, str]:
    policy = client.post(
        "/admin/activity/scoring-v2/policies",
        headers=headers,
        json={"code": f"NO_RESULT_{uuid4().hex[:8].upper()}", "name": "No result"},
    )
    assert policy.status_code == 201, policy.text
    values = policy_values()
    values["resultBonuses"] = []
    version = client.post(
        f"/admin/activity/scoring-v2/policies/{policy.json()['id']}/versions",
        headers=headers,
        json=values,
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"/admin/activity/scoring-v2/versions/{version.json()['id']}/publish",
        headers=headers,
        json={"effectiveFrom": "2026-01-01T00:00:00Z"},
    )
    assert published.status_code == 200, published.text
    return policy.json()["id"], version.json()["id"]


def test_no_rule_persists_stable_newcomer_sequence(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = _create_no_result_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    event_id = create_event(client, headers, season_id, "2026-07-01T10:00:00Z")
    registration_id, person_id = create_registration(database, event_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)

    preview = client.post(
        "/admin/activity/scoring-v2/preview",
        headers=headers,
        json={"participationId": participation_id},
    )
    assert preview.status_code == 409, preview.text
    with database.connect() as connection:
        before_confirm = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
    assert before_confirm is None

    response = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert response.status_code == 200, response.text
    with database.connect() as connection:
        participation = (
            connection.execute(
                text(
                    "SELECT scoring_state,scoring_sequence FROM participations WHERE id=:id"
                ),
                {"id": participation_id},
            )
            .mappings()
            .one()
        )
        award_count = connection.execute(
            text(
                """SELECT COUNT(*) FROM score_transactions
                WHERE participation_id=:id AND transaction_type='AWARD'"""
            ),
            {"id": participation_id},
        ).scalar_one()
    assert dict(participation) == {"scoring_state": "NO_RULE", "scoring_sequence": 1}
    assert award_count == 0

    second_event = create_event(client, headers, season_id, "2026-07-02T10:00:00Z")
    second_registration, _ = create_registration(database, second_event, person_id)
    second_participation = assign_participation(
        client, headers, second_event, second_registration
    )
    second_response = client.post(
        f"/admin/events/{second_event}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [second_registration],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert second_response.status_code == 200, second_response.text
    with database.connect() as connection:
        second_sequence = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": second_participation},
        ).scalar_one()
    assert second_sequence == 2

    cancelled = client.post(
        f"/admin/events/{event_id}/participations/cancel",
        headers=headers,
        json={"participationIds": [participation_id], "reason": "Sequence stability"},
    )
    assert cancelled.status_code == 200, cancelled.text
    with database.connect() as connection:
        after_cancel = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
    assert after_cancel == 1


def test_no_rule_retry_after_repair_reuses_sequence_and_awards(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, version_id = _create_no_result_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    event_id = create_event(client, headers, season_id, "2026-07-01T10:00:00Z")
    registration_id, _ = create_registration(database, event_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)

    response = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert response.status_code == 200, response.text
    with database.connect() as connection:
        first_pass = (
            connection.execute(
                text(
                    "SELECT scoring_state,scoring_sequence FROM participations WHERE id=:id"
                ),
                {"id": participation_id},
            )
            .mappings()
            .one()
        )
    assert dict(first_pass) == {"scoring_state": "NO_RULE", "scoring_sequence": 1}

    # Simulate the missing component being repaired (production repair publishes a
    # corrected version; this targets the same read path without extra plumbing) and
    # retry scoring for the same, already-confirmed Participation.
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO scoring_policy_result_bonuses
                (policy_version_id,result_id,value)
                VALUES (:version,'40000000-0000-4000-8000-000000000001','5.0000')"""
            ),
            {"version": version_id},
        )
        actor = connection.execute(
            text("SELECT id FROM staff_users WHERE system_role='SUPER_ADMIN' LIMIT 1")
        ).scalar_one()
        award_score(connection, participation_id, actor)

    with database.connect() as connection:
        repaired = (
            connection.execute(
                text(
                    "SELECT scoring_state,scoring_sequence FROM participations WHERE id=:id"
                ),
                {"id": participation_id},
            )
            .mappings()
            .one()
        )
        award_points = connection.execute(
            text(
                """SELECT points FROM score_transactions
                WHERE participation_id=:id AND transaction_type='AWARD'"""
            ),
            {"id": participation_id},
        ).scalar_one()
    assert repaired["scoring_state"] == "AWARDED"
    assert repaired["scoring_sequence"] == 1
    assert decimal_string(award_points) == "14.0000"  # 3 * 2 * 1.5(seq#1) + 5


def test_person_status_retirement_is_historical_and_overlap_safe(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, version_id = create_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    # Dates are computed relative to the real run date rather than hardcoded,
    # since retirement's "valid through today" boundary (see
    # _status_retirement_boundary) is itself relative to whenever the test
    # actually executes - a fixed literal eventually collides with "today".
    # retire_status() computes "today" in Europe/Moscow, not system/UTC local
    # time, so this must match or the two disagree for part of every day.
    today = datetime.now(ZoneInfo("Europe/Moscow")).date()
    valid_from = today - timedelta(days=30)
    valid_to = today + timedelta(days=180)
    event_id = create_event(
        client, headers, season_id, f"{valid_from.isoformat()}T10:00:00Z"
    )
    registration_id, person_id = create_registration(database, event_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)
    assignment = client.post(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": valid_from.isoformat(),
            "validTo": valid_to.isoformat(),
        },
    )
    assert assignment.status_code == 201, assignment.text
    retired = client.delete(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses/{assignment.json()['id']}",
        headers=headers,
    )
    assert retired.status_code == 200, retired.text
    retirement_boundary = _status_retirement_boundary(valid_from, valid_to, today)

    def preview_at(value: str) -> dict[str, object]:
        with database.transaction() as connection:
            connection.execute(
                text(
                    "UPDATE events SET start_at=:start,end_at=DATE_ADD(:start,INTERVAL 2 HOUR) WHERE id=:id"
                ),
                {"id": event_id, "start": value},
            )
        response = client.post(
            "/admin/activity/scoring-v2/preview",
            headers=headers,
            json={"participationId": participation_id, "policyVersionId": version_id},
        )
        assert response.status_code == 200, response.text
        return response.json()["calculation"]

    before = preview_at(f"{today.isoformat()} 10:00:00")
    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        awarded_snapshot_raw = connection.execute(
            text("""SELECT calculation_snapshot FROM score_transactions
            WHERE participation_id=:id AND transaction_type='AWARD'"""),
            {"id": participation_id},
        ).scalar_one()
    awarded_snapshot = (
        json.loads(awarded_snapshot_raw)
        if isinstance(awarded_snapshot_raw, str)
        else awarded_snapshot_raw
    )
    assert [item["code"] for item in awarded_snapshot["statuses"]] == [
        "PROFESSION_AMBASSADOR"
    ]
    after = preview_at(f"{retirement_boundary.isoformat()} 10:00:00")
    assert [item["code"] for item in before["statuses"]] == ["PROFESSION_AMBASSADOR"]
    assert after["statuses"] == []
    overlap = client.post(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": (today - timedelta(days=5)).isoformat(),
            "validTo": (today + timedelta(days=10)).isoformat(),
        },
    )
    assert (overlap.status_code, overlap.json()["error"]["code"]) == (
        409,
        "PERSON_STATUS_PERIOD_CONFLICT",
    )

    future_from = today + timedelta(days=60)
    future = client.post(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": future_from.isoformat(),
            "validTo": None,
        },
    )
    assert future.status_code == 201, future.text
    cancelled = client.delete(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses/{future.json()['id']}",
        headers=headers,
    )
    assert cancelled.status_code == 200, cancelled.text
    later = preview_at(f"{(future_from + timedelta(days=1)).isoformat()} 10:00:00")
    assert later["statuses"] == []
    with database.connect() as connection:
        persisted_snapshot = connection.execute(
            text("""SELECT calculation_snapshot FROM score_transactions
            WHERE participation_id=:id AND transaction_type='AWARD'"""),
            {"id": participation_id},
        ).scalar_one()
    assert persisted_snapshot == awarded_snapshot_raw


def test_person_status_uses_real_moscow_date_boundary(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, version_id = create_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    event_id = create_event(client, headers, season_id, "2026-12-31T20:59:00Z")
    registration_id, person_id = create_registration(database, event_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)
    assigned = client.post(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": "2026-12-31",
            "validTo": "2026-12-31",
        },
    )
    assert assigned.status_code == 201, assigned.text

    def status_codes(start: str) -> list[str]:
        with database.transaction() as connection:
            connection.execute(
                text(
                    "UPDATE events SET start_at=:start,end_at=DATE_ADD(:start,INTERVAL 2 HOUR) WHERE id=:id"
                ),
                {"id": event_id, "start": start},
            )
        response = client.post(
            "/admin/activity/scoring-v2/preview",
            headers=headers,
            json={"participationId": participation_id, "policyVersionId": version_id},
        )
        assert response.status_code == 200, response.text
        return [item["code"] for item in response.json()["calculation"]["statuses"]]

    assert status_codes("2026-12-31 20:59:00") == ["PROFESSION_AMBASSADOR"]
    assert status_codes("2026-12-31 21:00:00") == []


def test_status_retirement_boundary_preserves_the_current_moscow_day() -> None:
    today = date(2026, 9, 18)
    assert _status_retirement_boundary(date(2026, 9, 1), None, today) == date(
        2026, 9, 19
    )
    assert _status_retirement_boundary(date(2026, 12, 1), None, today) == date(
        2026, 12, 1
    )
    assert _status_retirement_boundary(
        date(2026, 9, 1), date(2026, 9, 10), today
    ) == date(2026, 9, 11)


def test_inactive_status_type_preserves_historical_scoring(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    policy_id, _ = create_policy(client, headers)
    season_id = create_season(client, headers)
    activate_policy(client, headers, season_id, policy_id, "2026-01-01T00:00:00Z")
    event_id = create_event(client, headers, season_id, "2026-09-10T10:00:00Z")
    registration_id, person_id = create_registration(database, event_id)
    participation_id = assign_participation(client, headers, event_id, registration_id)
    assignment = client.post(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": "2026-09-01",
            "validTo": "2026-12-31",
        },
    )
    assert assignment.status_code == 201, assignment.text
    with database.transaction() as connection:
        connection.execute(
            text(
                """UPDATE person_status_types SET active=false,
                updated_at=UTC_TIMESTAMP(3)
                WHERE id='62000000-0000-4000-8000-000000000001'"""
            )
        )

    confirmed = client.post(
        f"/admin/events/{event_id}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        snapshot_value = connection.execute(
            text(
                """SELECT calculation_snapshot FROM score_transactions
                WHERE participation_id=:id AND transaction_type='AWARD'"""
            ),
            {"id": participation_id},
        ).scalar_one()
    snapshot = (
        json.loads(snapshot_value)
        if isinstance(snapshot_value, str)
        else snapshot_value
    )
    assert [item["code"] for item in snapshot["statuses"]] == ["PROFESSION_AMBASSADOR"]
    assert decimal_string(snapshot["statuses"][0]["value"]) == "1.5000"

    _, another_person = create_registration(database, event_id)
    rejected_assignment = client.post(
        f"/admin/activity/scoring-v2/people/{another_person}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": "2026-09-01",
            "validTo": None,
        },
    )
    assert (
        rejected_assignment.status_code,
        rejected_assignment.json()["error"]["code"],
    ) == (
        400,
        "INVALID_REFERENCE",
    )

    draft = client.post(
        f"/admin/activity/scoring-v2/policies/{policy_id}/versions",
        headers=headers,
        json=policy_values("4.0000"),
    )
    assert draft.status_code == 201, draft.text
    rejected_publish = client.post(
        f"/admin/activity/scoring-v2/versions/{draft.json()['id']}/publish",
        headers=headers,
        json={"effectiveFrom": "2028-01-01T00:00:00Z"},
    )
    assert (rejected_publish.status_code, rejected_publish.json()["error"]["code"]) == (
        409,
        "SCORING_POLICY_INVALID",
    )
    with database.transaction() as connection:
        connection.execute(
            text(
                """UPDATE person_status_types SET active=true,
                updated_at=UTC_TIMESTAMP(3)
                WHERE id='62000000-0000-4000-8000-000000000001'"""
            )
        )


def test_preview_production_parity_and_published_immutability(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    published = client.post(
        "/admin/activity/scoring-v2/versions/61000000-0000-4000-8000-000000000001/publish",
        headers=headers,
        json={"effectiveFrom": "2026-01-01T00:00:00Z"},
    )
    assert published.status_code == 200, published.text
    immutable = client.patch(
        "/admin/activity/scoring-v2/versions/61000000-0000-4000-8000-000000000001",
        headers=headers,
        json={
            "roleBases": [
                {
                    "classifierId": "30000000-0000-4000-8000-000000000004",
                    "value": "4.0000",
                }
            ],
            "levelMultipliers": [
                {
                    "classifierId": "20000000-0000-4000-8000-000000000003",
                    "value": "2.0000",
                }
            ],
            "newcomerTiers": [
                {"sequenceFrom": 1, "sequenceTo": None, "value": "1.0000"}
            ],
        },
    )
    assert (immutable.status_code, immutable.json()["error"]["code"]) == (
        409,
        "SCORING_POLICY_VERSION_IMMUTABLE",
    )

    season = client.post(
        "/admin/activity/seasons",
        headers=headers,
        json={
            "code": f"V2_{uuid4().hex[:8].upper()}",
            "name": "V2",
            "startsAt": "2026-01-01T00:00:00Z",
            "endsAt": "2027-01-01T00:00:00Z",
            "active": False,
        },
    )
    assert season.status_code == 201, season.text
    assigned_policy = client.post(
        f"/admin/activity/scoring-v2/seasons/{season.json()['id']}/policy",
        headers=headers,
        json={
            "scoringPolicyId": "60000000-0000-4000-8000-000000000001",
            "effectiveFrom": "2026-01-01T00:00:00Z",
        },
    )
    assert assigned_policy.status_code == 200, assigned_policy.text
    slug = f"v2-{uuid4().hex[:12]}"
    event = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "V2 scoring",
            "slug": slug,
            "description": "V2",
            "startAt": "2026-10-01T10:00:00Z",
            "endAt": "2026-10-01T12:00:00Z",
            "registrationDeadline": "2026-10-01T10:00:00Z",
            "timezone": "Europe/Moscow",
            "location": "КАИТ №20",
            "capacity": 10,
            "status": "DRAFT",
            "seasonId": season.json()["id"],
            "levelId": "20000000-0000-4000-8000-000000000003",
        },
    )
    assert event.status_code == 201, event.text
    person_id, registration_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO persons
          (id,tenant_id,last_name,first_name,email,email_normalized,person_type,dedup_review_required,created_at,updated_at)
          VALUES (:id,'50000000-0000-4000-8000-000000000001','Тестов','V2',:email,:email,'KAIT_STUDENT',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {"id": person_id, "email": f"{person_id}@example.test"},
        )
        connection.execute(
            text("""INSERT INTO registrations
          (id,public_id,event_id,person_id,source,status,last_name,first_name,email,person_type,consent_accepted,registered_at,first_attended_at,created_at,updated_at)
          VALUES (:id,:public,:event,:person,'ADMIN_MANUAL','ACTIVE','Тестов','V2',:email,'KAIT_STUDENT',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {
                "id": registration_id,
                "public": str(uuid4()),
                "event": event.json()["id"],
                "person": person_id,
                "email": f"{person_id}@example.test",
            },
        )
    status = client.post(
        f"/admin/activity/scoring-v2/people/{person_id}/statuses",
        headers=headers,
        json={
            "statusTypeId": "62000000-0000-4000-8000-000000000001",
            "validFrom": "2026-09-01",
            "validTo": "2026-12-31",
        },
    )
    assert status.status_code == 201, status.text
    assigned = client.post(
        f"/admin/events/{event.json()['id']}/participations/assign",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
            "reason": "V2 test",
        },
    )
    assert assigned.status_code == 200, assigned.text
    participation_id = assigned.json()["participationIds"][0]
    preview = client.post(
        "/admin/activity/scoring-v2/preview",
        headers=headers,
        json={"participationId": participation_id},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["points"] == "18.5000"  # 3 * 2 * 1.5 * 1.5 + 5
    confirmed = client.post(
        f"/admin/events/{event.json()['id']}/participations/confirm",
        headers=headers,
        json={
            "registrationIds": [registration_id],
            "roleId": "30000000-0000-4000-8000-000000000004",
            "resultId": "40000000-0000-4000-8000-000000000001",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    with database.connect() as connection:
        transaction = (
            connection.execute(
                text(
                    "SELECT points,calculation_snapshot,scoring_engine_version FROM score_transactions WHERE participation_id=:id AND transaction_type='AWARD'"
                ),
                {"id": participation_id},
            )
            .mappings()
            .one()
        )
    assert decimal_string(transaction["points"]) == preview.json()["points"]
    assert transaction["scoring_engine_version"] == "V2"
    snapshot = (
        json.loads(transaction["calculation_snapshot"])
        if isinstance(transaction["calculation_snapshot"], str)
        else transaction["calculation_snapshot"]
    )
    assert {
        "snapshotSchemaVersion",
        "engineVersion",
        "scoringPolicyId",
        "policyVersionId",
        "policyVersion",
        "eventId",
        "eventStartAt",
        "eventMoscowDate",
        "seasonId",
        "participationId",
        "personId",
        "role",
        "level",
        "statuses",
        "newcomer",
        "result",
        "multiplicativeSubtotal",
        "resultBonus",
        "finalPoints",
        "roundingMode",
        "calculatedAt",
    }.issubset(snapshot)
    assert snapshot["finalPoints"] == "18.5000"
    assert snapshot["eventStartAt"] == "2026-10-01T10:00:00Z"
    assert preview.json()["policyVersionStatus"] == "PUBLISHED"
    retirement = client.post(
        "/admin/activity/scoring-v2/versions/61000000-0000-4000-8000-000000000001/retire",
        headers=headers,
    )
    assert (retirement.status_code, retirement.json()["error"]["code"]) == (
        409,
        "SCORING_POLICY_RETROACTIVE_CONFLICT",
    )
    locked_assignment = client.post(
        f"/admin/activity/scoring-v2/seasons/{season.json()['id']}/policy",
        headers=headers,
        json={
            "scoringPolicyId": "60000000-0000-4000-8000-000000000001",
            "effectiveFrom": "2026-01-02T00:00:00Z",
        },
    )
    assert (
        locked_assignment.status_code,
        locked_assignment.json()["error"]["code"],
    ) == (409, "SEASON_SCORING_POLICY_LOCKED")
    cancelled = client.post(
        f"/admin/events/{event.json()['id']}/participations/cancel",
        headers=headers,
        json={"participationIds": [participation_id], "reason": "V2 reversal test"},
    )
    assert cancelled.status_code == 200, cancelled.text
    with database.connect() as connection:
        ledger = (
            connection.execute(
                text(
                    """SELECT transaction_type,points,original_transaction_id,
                    calculation_snapshot
                FROM score_transactions WHERE participation_id=:id ORDER BY created_at"""
                ),
                {"id": participation_id},
            )
            .mappings()
            .all()
        )
        sequence = connection.execute(
            text("SELECT scoring_sequence FROM participations WHERE id=:id"),
            {"id": participation_id},
        ).scalar_one()
    assert [
        (item["transaction_type"], decimal_string(item["points"])) for item in ledger
    ] == [
        ("AWARD", "18.5000"),
        ("REVERSAL", "-18.5000"),
    ]
    assert ledger[1]["original_transaction_id"]
    reversal_snapshot = (
        json.loads(ledger[1]["calculation_snapshot"])
        if isinstance(ledger[1]["calculation_snapshot"], str)
        else ledger[1]["calculation_snapshot"]
    )
    assert reversal_snapshot["transactionType"] == "REVERSAL"
    assert reversal_snapshot["originalFinalPoints"] == "18.5000"
    assert reversal_snapshot["reversalPoints"] == "-18.5000"
    assert reversal_snapshot["originalCalculation"]["finalPoints"] == "18.5000"
    assert sequence == 1
