from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.engine import Connection, RowMapping

from .database import execute, row, rows
from .errors import ApiError

SCALE = Decimal("0.0001")


def decimal_string(value: Decimal | int | str | None) -> str:
    return str(Decimal(str(value or 0)).quantize(SCALE, rounding=ROUND_HALF_UP))


def _utc_iso(value: datetime) -> str:
    value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return value.isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class ScoringInput:
    role: dict[str, str]
    level: dict[str, str]
    statuses: tuple[dict[str, str], ...]
    newcomer: dict[str, str | int]
    result: dict[str, str] | None


def calculate(values: ScoringInput) -> tuple[Decimal, dict[str, Any]]:
    role = Decimal(values.role["value"])
    level = Decimal(values.level["value"])
    score = role * level
    for status in values.statuses:
        score *= Decimal(status["value"])
    newcomer = Decimal(str(values.newcomer["value"]))
    score *= newcomer
    multiplicative_subtotal = score
    bonus = Decimal(values.result["value"]) if values.result else Decimal("0")
    total = (score + bonus).quantize(SCALE, rounding=ROUND_HALF_UP)
    snapshot = {
        "formula": "roleBase * levelMultiplier * statusMultipliers * newcomerMultiplier + resultBonus",
        "roundingMode": "ROUND_HALF_UP",
        "role": values.role,
        "level": values.level,
        "statuses": list(values.statuses),
        "newcomer": values.newcomer,
        "result": values.result,
        "resultBonus": decimal_string(bonus),
        "multiplicativeSubtotal": decimal_string(multiplicative_subtotal),
        "finalPoints": decimal_string(total),
        "total": decimal_string(total),
    }
    return total, snapshot


def _local_date(value: datetime) -> str:
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware.astimezone(ZoneInfo("Europe/Moscow")).date().isoformat()


def policy_version_for_event(
    connection: Connection, policy_id: str, event_start: datetime
) -> RowMapping | None:
    matches = rows(
        connection,
        """SELECT * FROM scoring_policy_versions
        WHERE scoring_policy_id=:policy AND status IN ('PUBLISHED','RETIRED')
          AND effective_from<=:at AND (effective_to IS NULL OR effective_to>:at)
        ORDER BY version DESC""",
        {"policy": policy_id, "at": event_start},
    )
    if len(matches) > 1:
        raise ApiError(409, "SCORING_POLICY_AMBIGUOUS", "Policy periods overlap")
    return matches[0] if matches else None


def _component(
    connection: Connection, table: str, version_id: str, key: str, identity: str
) -> RowMapping | None:
    allowed = {
        "scoring_policy_role_bases": "role_id",
        "scoring_policy_level_multipliers": "level_id",
        "scoring_policy_result_bonuses": "result_id",
    }
    if allowed.get(table) != key:
        raise RuntimeError("Unsupported scoring component")
    return row(
        connection,
        f"SELECT value FROM {table} WHERE policy_version_id=:version AND {key}=:identity",
        {"version": version_id, "identity": identity},
    )


def assign_scoring_sequence(
    connection: Connection, participation: RowMapping, persist: bool
) -> int:
    if participation["scoring_sequence"]:
        return int(participation["scoring_sequence"])
    row(
        connection,
        "SELECT id FROM persons WHERE id=:id FOR UPDATE",
        {"id": participation["person_id"]},
    )
    baseline = row(
        connection,
        """SELECT COUNT(DISTINCT p.id) AS historical_count,
          COALESCE(MAX(p.scoring_sequence),0) AS max_sequence
        FROM participations p JOIN events e ON e.id=p.event_id
        WHERE p.person_id=:person AND e.season_id IS NOT NULL AND p.id<>:participation
          AND (
            p.status='CONFIRMED'
            OR EXISTS (
              SELECT 1 FROM score_transactions st
              WHERE st.participation_id=p.id AND st.transaction_type='AWARD'
                AND st.source='SCORING_ENGINE'
                AND st.scoring_engine_version IN ('V1','V2')
            )
          )""",
        {"person": participation["person_id"], "participation": participation["id"]},
    )
    assert baseline is not None
    sequence = max(int(baseline["historical_count"]), int(baseline["max_sequence"])) + 1
    if persist:
        execute(
            connection,
            "UPDATE participations SET scoring_sequence=:sequence WHERE id=:id AND scoring_sequence IS NULL",
            {"sequence": sequence, "id": participation["id"]},
        )
    return sequence


def calculate_participation(
    connection: Connection,
    participation: RowMapping,
    *,
    policy_version_id: str | None = None,
    persist_sequence: bool = False,
) -> tuple[Decimal, dict[str, Any], str]:
    sequence = assign_scoring_sequence(connection, participation, persist_sequence)
    if policy_version_id:
        version = row(
            connection,
            "SELECT * FROM scoring_policy_versions WHERE id=:id",
            {"id": policy_version_id},
        )
    else:
        if not participation["scoring_policy_id"]:
            raise ApiError(
                409,
                "SCORING_POLICY_NOT_ASSIGNED",
                "Season does not use Scoring Engine v2",
            )
        version = policy_version_for_event(
            connection,
            participation["scoring_policy_id"],
            participation["event_start_at"],
        )
    if not version:
        raise ApiError(
            409,
            "SCORING_POLICY_VERSION_NOT_FOUND",
            "No policy version applies to Event start",
        )
    role = _component(
        connection,
        "scoring_policy_role_bases",
        version["id"],
        "role_id",
        participation["role_id"],
    )
    level = _component(
        connection,
        "scoring_policy_level_multipliers",
        version["id"],
        "level_id",
        participation["level_id"],
    )
    if not role or not level:
        raise ApiError(
            409, "SCORING_COMPONENT_MISSING", "Role or level is not configured"
        )
    event_date = _local_date(participation["event_start_at"])
    statuses = rows(
        connection,
        """SELECT pst.id,pst.code,pst.name,m.value
        FROM person_status_assignments a
        JOIN person_status_types pst ON pst.id=a.status_type_id
        JOIN scoring_policy_status_multipliers m ON m.status_type_id=pst.id AND m.policy_version_id=:version
        WHERE a.person_id=:person AND a.valid_from<=:event_date
          AND (a.valid_to IS NULL OR a.valid_to>=:event_date)
          AND (a.retired_effective_on IS NULL OR a.retired_effective_on>:event_date)
        ORDER BY pst.code""",
        {
            "version": version["id"],
            "person": participation["person_id"],
            "event_date": event_date,
        },
    )
    tier = row(
        connection,
        """SELECT value FROM scoring_policy_newcomer_tiers
        WHERE policy_version_id=:version AND sequence_from<=:sequence
          AND (sequence_to IS NULL OR sequence_to>=:sequence)
        ORDER BY sequence_from DESC LIMIT 1""",
        {"version": version["id"], "sequence": sequence},
    )
    if not tier:
        raise ApiError(
            409, "SCORING_COMPONENT_MISSING", "Newcomer tier is not configured"
        )
    result_row = None
    if participation["result_id"]:
        result_row = _component(
            connection,
            "scoring_policy_result_bonuses",
            version["id"],
            "result_id",
            participation["result_id"],
        )
        if not result_row:
            raise ApiError(409, "SCORING_COMPONENT_MISSING", "Result is not configured")
    values = ScoringInput(
        role={
            "id": participation["role_id"],
            "code": participation["role_code"],
            "name": participation["role_name"],
            "value": decimal_string(role["value"]),
        },
        level={
            "id": participation["level_id"],
            "code": participation["level_code"],
            "name": participation["level_name"],
            "value": decimal_string(level["value"]),
        },
        statuses=tuple(
            {
                "id": item["id"],
                "code": item["code"],
                "name": item["name"],
                "value": decimal_string(item["value"]),
            }
            for item in statuses
        ),
        newcomer={"sequence": sequence, "value": decimal_string(tier["value"])},
        result=(
            {
                "id": participation["result_id"],
                "code": participation["result_code"],
                "name": participation["result_name"],
                "value": decimal_string(result_row["value"]),
            }
            if result_row
            else None
        ),
    )
    total, snapshot = calculate(values)
    snapshot.update(
        {
            "snapshotSchemaVersion": 1,
            "engineVersion": "V2",
            "scoringPolicyId": version["scoring_policy_id"],
            "policyVersionId": version["id"],
            "policyVersion": int(version["version"]),
            "policyVersionStatus": version["status"],
            "eventId": participation["event_id"],
            "eventStartAt": _utc_iso(participation["event_start_at"]),
            "eventMoscowDate": event_date,
            "seasonId": participation["season_id"],
            "participationId": participation["id"],
            "personId": participation["person_id"],
            "calculatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
    )
    return total, snapshot, str(version["id"])
