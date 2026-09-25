from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError

from ..database import Database, execute, row, rows
from ..dependencies import Staff, administrator, csrf_super_admin, database
from ..errors import ApiError
from ..scoring_v2 import calculate_participation, decimal_string
from ..scoring_v2_schemas import (
    AssignPolicy,
    PolicyCreate,
    PolicyVersionValues,
    PublishVersion,
    ScoringPreview,
    StatusAssignment,
)
from ..service_utils import audit, naive_utc, serial
from ..tenant_scope import require_person_in_tenant

router = APIRouter(prefix="/admin/activity/scoring-v2", tags=["scoring-v2"])


def _status_retirement_boundary(
    valid_from: date, valid_to: date | None, today: date
) -> date:
    if valid_from > today:
        return valid_from
    boundary = today + timedelta(days=1)
    if valid_to is not None:
        boundary = min(boundary, valid_to + timedelta(days=1))
    return boundary


def _policy(connection: Connection, identity: str, staff: Staff, lock: bool = False):  # type: ignore[no-untyped-def]
    item = row(
        connection,
        "SELECT * FROM scoring_policies WHERE id=:id AND organization_id=:organization"
        + (" FOR UPDATE" if lock else ""),
        {"id": identity, "organization": staff.organization_id},
    )
    if not item:
        raise ApiError(404, "SCORING_POLICY_NOT_FOUND", "Scoring policy not found")
    return item


def _version(connection: Connection, identity: str, staff: Staff, lock: bool = False):  # type: ignore[no-untyped-def]
    item = row(
        connection,
        """SELECT v.* FROM scoring_policy_versions v JOIN scoring_policies p ON p.id=v.scoring_policy_id
        WHERE v.id=:id AND p.organization_id=:organization"""
        + (" FOR UPDATE" if lock else ""),
        {"id": identity, "organization": staff.organization_id},
    )
    if not item:
        raise ApiError(
            404, "SCORING_POLICY_VERSION_NOT_FOUND", "Scoring policy version not found"
        )
    return item


def _locked_version_with_policy(connection: Connection, identity: str, staff: Staff):  # type: ignore[no-untyped-def]
    probe = _version(connection, identity, staff)
    _policy(connection, str(probe["scoring_policy_id"]), staff, True)
    locked = row(
        connection,
        "SELECT * FROM scoring_policy_versions WHERE id=:id FOR UPDATE",
        {"id": identity},
    )
    assert locked is not None
    return locked


def _invalid_policy(message: str) -> ApiError:
    return ApiError(409, "SCORING_POLICY_INVALID", message)


def _validate_publishable(
    connection: Connection, version_id: str, policy_code: str
) -> None:
    specifications = (
        (
            "scoring_policy_role_bases",
            "participation_roles",
            "role_id",
            True,
            "Role base",
        ),
        (
            "scoring_policy_level_multipliers",
            "event_levels",
            "level_id",
            False,
            "Level multiplier",
        ),
        (
            "scoring_policy_status_multipliers",
            "person_status_types",
            "status_type_id",
            False,
            "Status multiplier",
        ),
        (
            "scoring_policy_result_bonuses",
            "participation_results",
            "result_id",
            True,
            "Result bonus",
        ),
    )
    for component_table, classifier_table, key, zero_allowed, label in specifications:
        items = rows(
            connection,
            f"""SELECT c.value,d.id,d.code,d.active FROM {component_table} c
            LEFT JOIN {classifier_table} d ON d.id=c.{key}
            WHERE c.policy_version_id=:version""",
            {"version": version_id},
        )
        if (
            component_table
            in {
                "scoring_policy_role_bases",
                "scoring_policy_level_multipliers",
            }
            and not items
        ):
            raise _invalid_policy(f"{label} components are required")
        for item in items:
            if not item["id"] or not bool(item["active"]):
                raise _invalid_policy(f"{label} references an unavailable classifier")
            value = Decimal(str(item["value"]))
            if value < 0 or (not zero_allowed and value == 0):
                raise _invalid_policy(f"{label} has an invalid value")

    tiers = rows(
        connection,
        """SELECT sequence_from,sequence_to,value FROM scoring_policy_newcomer_tiers
        WHERE policy_version_id=:version ORDER BY sequence_from""",
        {"version": version_id},
    )
    if not tiers or int(tiers[0]["sequence_from"]) != 1:
        raise _invalid_policy("Newcomer tiers must start at sequence 1")
    expected = 1
    for index, tier in enumerate(tiers):
        if int(tier["sequence_from"]) != expected or Decimal(str(tier["value"])) <= 0:
            raise _invalid_policy("Newcomer tiers must be positive and gap-free")
        end = tier["sequence_to"]
        if end is None:
            if index != len(tiers) - 1:
                raise _invalid_policy("Only the final newcomer tier may be open-ended")
            expected = -1
        else:
            expected = int(end) + 1
    if expected != -1:
        raise _invalid_policy("Final newcomer tier must cover the infinite tail")

    if policy_code != "KAIT20_DEFAULT":
        return
    required = {
        "scoring_policy_role_bases": {
            "PARTICIPANT",
            "SPECTATOR",
            "VOLUNTEER",
            "CO_ORGANIZER",
            "ORGANIZER",
            "COORDINATOR",
        },
        "scoring_policy_level_multipliers": {
            "DEPARTMENT",
            "COLLEGE",
            "CITY",
            "DISTRICT",
            "FEDERAL",
        },
        "scoring_policy_status_multipliers": {"PROFESSION_AMBASSADOR"},
        "scoring_policy_result_bonuses": {
            "LAUREATE",
            "DIPLOMANT",
            "ACKNOWLEDGEMENT",
            "PRIZE_3",
            "LAUREATE_III",
            "PRIZE_2",
            "LAUREATE_II",
            "WINNER",
            "LAUREATE_I",
            "GRAND_PRIX",
            "ABSOLUTE_WINNER",
        },
    }
    classifier_by_table = {
        "scoring_policy_role_bases": ("participation_roles", "role_id"),
        "scoring_policy_level_multipliers": ("event_levels", "level_id"),
        "scoring_policy_status_multipliers": ("person_status_types", "status_type_id"),
        "scoring_policy_result_bonuses": ("participation_results", "result_id"),
    }
    for table, required_codes in required.items():
        classifier, key = classifier_by_table[table]
        actual = {
            str(item["code"])
            for item in rows(
                connection,
                f"""SELECT d.code FROM {table} c JOIN {classifier} d ON d.id=c.{key}
                WHERE c.policy_version_id=:version AND d.active=true""",
                {"version": version_id},
            )
        }
        if not required_codes.issubset(actual):
            raise _invalid_policy(
                "KAIT20_DEFAULT is missing approved components: "
                + ", ".join(sorted(required_codes - actual))
            )


def _replace_components(
    connection: Connection, version_id: str, values: PolicyVersionValues
) -> None:
    tables = (
        "scoring_policy_role_bases",
        "scoring_policy_level_multipliers",
        "scoring_policy_status_multipliers",
        "scoring_policy_newcomer_tiers",
        "scoring_policy_result_bonuses",
    )
    for table in tables:
        execute(
            connection,
            f"DELETE FROM {table} WHERE policy_version_id=:version",
            {"version": version_id},
        )
    mappings = (
        ("scoring_policy_role_bases", "role_id", values.role_bases),
        ("scoring_policy_level_multipliers", "level_id", values.level_multipliers),
        (
            "scoring_policy_status_multipliers",
            "status_type_id",
            values.status_multipliers,
        ),
        ("scoring_policy_result_bonuses", "result_id", values.result_bonuses),
    )
    for table, key, items in mappings:
        for component in items:
            execute(
                connection,
                f"INSERT INTO {table} (policy_version_id,{key},value) VALUES (:version,:classifier,:value)",
                {
                    "version": version_id,
                    "classifier": str(component.classifier_id),
                    "value": component.value,
                },
            )
    for tier in values.newcomer_tiers:
        execute(
            connection,
            "INSERT INTO scoring_policy_newcomer_tiers (policy_version_id,sequence_from,sequence_to,value) VALUES (:version,:start,:end,:value)",
            {
                "version": version_id,
                "start": tier.sequence_from,
                "end": tier.sequence_to,
                "value": tier.value,
            },
        )


def _policy_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "organizationId": item["organization_id"],
        "code": item["code"],
        "name": item["name"],
        "active": bool(item["active"]),
        "createdAt": serial(item["created_at"]),
        "updatedAt": serial(item["updated_at"]),
    }


def _version_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "scoringPolicyId": item["scoring_policy_id"],
        "version": int(item["version"]),
        "status": item["status"],
        "effectiveFrom": serial(item["effective_from"]),
        "effectiveTo": serial(item["effective_to"]),
        "createdAt": serial(item["created_at"]),
        "publishedAt": serial(item["published_at"]),
        "retiredAt": serial(item["retired_at"]),
        "createdBy": item["created_by"],
    }


def _status_type_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["name"],
        "active": bool(item["active"]),
    }


def _version_components(connection: Connection, version_id: str) -> dict[str, Any]:
    def component_list(table: str, key: str) -> list[dict[str, Any]]:
        items = rows(
            connection,
            f"SELECT value,{key} AS classifier_id FROM {table} WHERE policy_version_id=:version",
            {"version": version_id},
        )
        return [
            {
                "classifierId": item["classifier_id"],
                "value": decimal_string(item["value"]),
            }
            for item in items
        ]

    tiers = rows(
        connection,
        """SELECT sequence_from,sequence_to,value FROM scoring_policy_newcomer_tiers
        WHERE policy_version_id=:version ORDER BY sequence_from""",
        {"version": version_id},
    )
    return {
        "roleBases": component_list("scoring_policy_role_bases", "role_id"),
        "levelMultipliers": component_list(
            "scoring_policy_level_multipliers", "level_id"
        ),
        "statusMultipliers": component_list(
            "scoring_policy_status_multipliers", "status_type_id"
        ),
        "newcomerTiers": [
            {
                "sequenceFrom": int(tier["sequence_from"]),
                "sequenceTo": int(tier["sequence_to"])
                if tier["sequence_to"] is not None
                else None,
                "value": decimal_string(tier["value"]),
            }
            for tier in tiers
        ],
        "resultBonuses": component_list("scoring_policy_result_bonuses", "result_id"),
    }


@router.get("/status-types")
def list_status_types(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(connection, "SELECT * FROM person_status_types ORDER BY code")
    return {"items": [_status_type_response(item) for item in items]}


@router.get("/policies")
def list_policies(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            "SELECT * FROM scoring_policies WHERE organization_id=:organization ORDER BY code",
            {"organization": staff.organization_id},
        )
    return {"items": [_policy_response(item) for item in items]}


@router.post("/policies", status_code=201)
def create_policy(
    values: PolicyCreate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    identity = str(uuid4())
    try:
        with db.transaction() as connection:
            execute(
                connection,
                "INSERT INTO scoring_policies (id,organization_id,code,name,active,created_at,updated_at) VALUES (:id,:organization,:code,:name,true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
                {
                    "id": identity,
                    "organization": staff.organization_id,
                    **values.model_dump(),
                },
            )
            audit(
                connection,
                staff.id,
                "SCORING_POLICY_CREATED",
                "ScoringPolicy",
                identity,
            )
    except IntegrityError as error:
        raise ApiError(
            409, "SCORING_POLICY_CONFLICT", "Policy code already exists"
        ) from error
    return {"id": identity}


@router.get("/policies/{policy_id}/versions")
def list_versions(
    policy_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        _policy(connection, str(policy_id), staff)
        items = rows(
            connection,
            "SELECT * FROM scoring_policy_versions WHERE scoring_policy_id=:policy ORDER BY version",
            {"policy": str(policy_id)},
        )
    return {"items": [_version_response(item) for item in items]}


@router.get("/versions/{version_id}")
def get_version(
    version_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        version = _version(connection, str(version_id), staff)
        components = _version_components(connection, str(version_id))
    return {**_version_response(version), **components}


@router.post("/policies/{policy_id}/versions", status_code=201)
def create_version(
    policy_id: UUID,
    values: PolicyVersionValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    with db.transaction() as connection:
        _policy(connection, str(policy_id), staff, True)
        latest = row(
            connection,
            "SELECT COALESCE(MAX(version),0) AS version FROM scoring_policy_versions WHERE scoring_policy_id=:policy",
            {"policy": str(policy_id)},
        )
        version = int(latest["version"] if latest else 0) + 1
        execute(
            connection,
            "INSERT INTO scoring_policy_versions (id,scoring_policy_id,version,status,created_at,created_by) VALUES (:id,:policy,:version,'DRAFT',UTC_TIMESTAMP(3),:actor)",
            {
                "id": identity,
                "policy": str(policy_id),
                "version": version,
                "actor": staff.id,
            },
        )
        _replace_components(connection, identity, values)
        audit(
            connection,
            staff.id,
            "SCORING_POLICY_VERSION_CREATED",
            "ScoringPolicyVersion",
            identity,
            {"version": version},
        )
    return {"id": identity, "version": version, "status": "DRAFT"}


@router.patch("/versions/{version_id}")
def update_version(
    version_id: UUID,
    values: PolicyVersionValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        version = _locked_version_with_policy(connection, str(version_id), staff)
        if version["status"] != "DRAFT":
            raise ApiError(
                409,
                "SCORING_POLICY_VERSION_IMMUTABLE",
                "Published policy versions are immutable",
            )
        _replace_components(connection, str(version_id), values)
        audit(
            connection,
            staff.id,
            "SCORING_POLICY_VERSION_UPDATED",
            "ScoringPolicyVersion",
            str(version_id),
        )
    return {"accepted": True}


@router.post("/versions/{version_id}/publish")
def publish_version(
    version_id: UUID,
    values: PublishVersion,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        version = _locked_version_with_policy(connection, str(version_id), staff)
        if version["status"] != "DRAFT":
            raise ApiError(
                409, "SCORING_POLICY_VERSION_IMMUTABLE", "Only a draft can be published"
            )
        start, end = (
            naive_utc(values.effective_from),
            naive_utc(values.effective_to) if values.effective_to else None,
        )
        policy = _policy(connection, str(version["scoring_policy_id"]), staff)
        _validate_publishable(connection, str(version_id), str(policy["code"]))
        overlap = row(
            connection,
            """SELECT id FROM scoring_policy_versions WHERE scoring_policy_id=:policy AND status IN ('PUBLISHED','RETIRED')
          AND (effective_to IS NULL OR effective_to>:start) AND (:end IS NULL OR effective_from<:end)
          LIMIT 1 FOR UPDATE""",
            {"policy": version["scoring_policy_id"], "start": start, "end": end},
        )
        if overlap:
            raise ApiError(
                409,
                "SCORING_POLICY_PERIOD_CONFLICT",
                "Policy effective periods overlap",
            )
        execute(
            connection,
            "UPDATE scoring_policy_versions SET status='PUBLISHED',effective_from=:start,effective_to=:end,published_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": str(version_id), "start": start, "end": end},
        )
        audit(
            connection,
            staff.id,
            "SCORING_POLICY_VERSION_PUBLISHED",
            "ScoringPolicyVersion",
            str(version_id),
        )
    return {"accepted": True}


@router.post("/versions/{version_id}/retire")
def retire_version(
    version_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        version = _locked_version_with_policy(connection, str(version_id), staff)
        if version["status"] in {"RETIRED", "CANCELLED"}:
            return {"accepted": True}
        if version["status"] != "PUBLISHED":
            raise ApiError(
                409,
                "SCORING_POLICY_VERSION_IMMUTABLE",
                "Only a published version can be retired",
            )
        now = datetime.now(UTC).replace(tzinfo=None)
        if version["effective_from"] > now:
            execute(
                connection,
                """UPDATE scoring_policy_versions SET status='CANCELLED',
                retired_at=UTC_TIMESTAMP(3) WHERE id=:id""",
                {"id": str(version_id)},
            )
            action = "SCORING_POLICY_VERSION_CANCELLED"
        else:
            boundary = min(
                item for item in (now, version["effective_to"]) if item is not None
            )
            conflicting = row(
                connection,
                """SELECT st.id FROM score_transactions st
                JOIN participations p ON p.id=st.participation_id
                JOIN events e ON e.id=p.event_id
                WHERE st.scoring_policy_version_id=:version
                  AND st.transaction_type='AWARD' AND e.start_at>=:boundary
                LIMIT 1""",
                {"version": str(version_id), "boundary": boundary},
            )
            if conflicting:
                raise ApiError(
                    409,
                    "SCORING_POLICY_RETROACTIVE_CONFLICT",
                    "Retirement would invalidate an existing score award",
                )
            execute(
                connection,
                """UPDATE scoring_policy_versions SET status='RETIRED',
                effective_to=:boundary,retired_at=UTC_TIMESTAMP(3) WHERE id=:id""",
                {"id": str(version_id), "boundary": boundary},
            )
            action = "SCORING_POLICY_VERSION_RETIRED"
        audit(
            connection,
            staff.id,
            action,
            "ScoringPolicyVersion",
            str(version_id),
        )
    return {"accepted": True}


@router.post("/seasons/{season_id}/policy")
def assign_policy(
    season_id: UUID,
    values: AssignPolicy,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        season = row(
            connection,
            "SELECT * FROM seasons WHERE id=:id AND organization_id=:organization FOR UPDATE",
            {"id": str(season_id), "organization": staff.organization_id},
        )
        if not season:
            raise ApiError(404, "SEASON_NOT_FOUND", "Season not found")
        boundary = naive_utc(values.effective_from) if values.effective_from else None
        desired_policy = (
            str(values.scoring_policy_id) if values.scoring_policy_id else None
        )
        has_v2_award = row(
            connection,
            """SELECT st.id FROM score_transactions st
            JOIN participations p ON p.id=st.participation_id
            JOIN events e ON e.id=p.event_id
            WHERE e.season_id=:season AND st.transaction_type='AWARD'
              AND st.scoring_engine_version='V2' LIMIT 1 FOR UPDATE""",
            {"season": str(season_id)},
        )
        assignment_changed = (
            season["scoring_policy_id"] != desired_policy
            or season["scoring_policy_effective_from"] != boundary
        )
        if has_v2_award and assignment_changed:
            raise ApiError(
                409,
                "SEASON_SCORING_POLICY_LOCKED",
                "Season scoring policy is locked after its first v2 award",
            )
        if desired_policy and boundary and assignment_changed:
            conflicting_v1_award = row(
                connection,
                """SELECT st.id FROM score_transactions st
                JOIN participations p ON p.id=st.participation_id
                JOIN events e ON e.id=p.event_id
                WHERE e.season_id=:season AND e.start_at>=:boundary
                  AND st.transaction_type='AWARD'
                  AND st.source='SCORING_ENGINE'
                  AND st.scoring_engine_version='V1'
                LIMIT 1 FOR UPDATE""",
                {"season": str(season_id), "boundary": boundary},
            )
            if conflicting_v1_award:
                raise ApiError(
                    409,
                    "SEASON_SCORING_POLICY_RETROACTIVE_CONFLICT",
                    "Policy activation would cross existing v1 award history",
                )
        if values.scoring_policy_id:
            _policy(connection, str(values.scoring_policy_id), staff)
            published = row(
                connection,
                """SELECT id FROM scoring_policy_versions
                WHERE scoring_policy_id=:policy AND status='PUBLISHED'
                  AND effective_from<=:boundary
                  AND (effective_to IS NULL OR effective_to>:boundary) LIMIT 1""",
                {"policy": str(values.scoring_policy_id), "boundary": boundary},
            )
            if not published:
                raise ApiError(
                    409,
                    "SCORING_POLICY_NOT_PUBLISHED",
                    "Policy has no published version",
                )
        execute(
            connection,
            """UPDATE seasons SET scoring_policy_id=:policy,
            scoring_policy_effective_from=:boundary,updated_at=UTC_TIMESTAMP(3)
            WHERE id=:id""",
            {
                "id": str(season_id),
                "policy": desired_policy,
                "boundary": boundary,
            },
        )
        audit(
            connection,
            staff.id,
            "SEASON_SCORING_POLICY_ASSIGNED",
            "Season",
            str(season_id),
            {
                "policyId": str(values.scoring_policy_id)
                if values.scoring_policy_id
                else None,
                "effectiveFrom": serial(boundary),
            },
        )
    return {"accepted": True}


@router.post("/preview")
def preview(
    values: ScoringPreview,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        participation = row(
            connection,
            """SELECT p.*,e.start_at AS event_start_at,e.level_id,e.season_id,e.boost_multiplier,
          s.scoring_policy_id,
          s.scoring_policy_effective_from,
          pr.code AS role_code,pr.name AS role_name,el.code AS level_code,el.name AS level_name,
          pres.code AS result_code,pres.name AS result_name
          FROM participations p JOIN events e ON e.id=p.event_id AND e.organization_id=:organization
          JOIN seasons s ON s.id=e.season_id LEFT JOIN participation_roles pr ON pr.id=p.role_id
          LEFT JOIN event_levels el ON el.id=e.level_id LEFT JOIN participation_results pres ON pres.id=p.result_id
          WHERE p.id=:id FOR UPDATE""",
            {"id": str(values.participation_id), "organization": staff.organization_id},
        )
        if not participation:
            raise ApiError(404, "PARTICIPATION_NOT_FOUND", "Participation not found")
        if values.policy_version_id:
            _version(connection, str(values.policy_version_id), staff)
        elif not (
            participation["scoring_policy_id"]
            and participation["scoring_policy_effective_from"]
            and participation["event_start_at"]
            >= participation["scoring_policy_effective_from"]
        ):
            raise ApiError(
                409,
                "SCORING_ENGINE_V1",
                "This Event uses legacy scoring v1",
            )
        points, snapshot, version_id = calculate_participation(
            connection,
            participation,
            policy_version_id=str(values.policy_version_id)
            if values.policy_version_id
            else None,
        )
    return {
        "points": decimal_string(points),
        "policyVersionId": version_id,
        "policyVersionStatus": snapshot["policyVersionStatus"],
        "calculation": snapshot,
    }


@router.post("/people/{person_id}/statuses", status_code=201)
def assign_status(
    person_id: UUID,
    values: StatusAssignment,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    identity = str(uuid4())
    with db.transaction() as connection:
        require_person_in_tenant(connection, str(person_id), staff.tenant_id, lock=True)
        status = row(
            connection,
            "SELECT id FROM person_status_types WHERE id=:id AND active=true",
            {"id": str(values.status_type_id)},
        )
        if not status:
            raise ApiError(400, "INVALID_REFERENCE", "Status type is unavailable")
        overlap = row(
            connection,
            """SELECT id FROM person_status_assignments
            WHERE person_id=:person AND status_type_id=:status
              AND (retired_effective_on IS NULL OR retired_effective_on>valid_from)
              AND valid_from<COALESCE(:new_end,DATE('9999-12-31'))
              AND :start<COALESCE(
                  LEAST(DATE_ADD(valid_to,INTERVAL 1 DAY),retired_effective_on),
                  DATE_ADD(valid_to,INTERVAL 1 DAY),retired_effective_on,
                  DATE('9999-12-31'))
            LIMIT 1 FOR UPDATE""",
            {
                "person": str(person_id),
                "status": str(values.status_type_id),
                "start": values.valid_from,
                "new_end": values.valid_to + timedelta(days=1)
                if values.valid_to
                else None,
            },
        )
        if overlap:
            raise ApiError(
                409, "PERSON_STATUS_PERIOD_CONFLICT", "Status periods overlap"
            )
        execute(
            connection,
            "INSERT INTO person_status_assignments (id,person_id,status_type_id,valid_from,valid_to,created_at,created_by) VALUES (:id,:person,:status,:start,:end,UTC_TIMESTAMP(3),:actor)",
            {
                "id": identity,
                "person": str(person_id),
                "status": str(values.status_type_id),
                "start": values.valid_from,
                "end": values.valid_to,
                "actor": staff.id,
            },
        )
        audit(
            connection,
            staff.id,
            "PERSON_STATUS_ASSIGNED",
            "PersonStatusAssignment",
            identity,
        )
    return {"id": identity}


@router.get("/people/{person_id}/statuses")
def list_statuses(
    person_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        require_person_in_tenant(connection, str(person_id), staff.tenant_id)
        items = rows(
            connection,
            """SELECT a.*,t.code,t.name FROM person_status_assignments a
            JOIN person_status_types t ON t.id=a.status_type_id
            WHERE a.person_id=:person ORDER BY a.valid_from DESC,a.id""",
            {"person": str(person_id)},
        )
    return {
        "items": [
            {
                "id": item["id"],
                "statusTypeId": item["status_type_id"],
                "code": item["code"],
                "name": item["name"],
                "validFrom": serial(item["valid_from"]),
                "validTo": serial(item["valid_to"]),
                "retiredAt": serial(item["retired_at"]),
                "retiredEffectiveOn": serial(item["retired_effective_on"]),
            }
            for item in items
        ]
    }


@router.delete("/people/{person_id}/statuses/{assignment_id}")
def retire_status(
    person_id: UUID,
    assignment_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        require_person_in_tenant(connection, str(person_id), staff.tenant_id, lock=True)
        assignment = row(
            connection,
            """SELECT * FROM person_status_assignments
            WHERE id=:id AND person_id=:person FOR UPDATE""",
            {"id": str(assignment_id), "person": str(person_id)},
        )
        if not assignment:
            raise ApiError(
                404, "PERSON_STATUS_NOT_FOUND", "Status assignment not found"
            )
        if assignment["retired_at"]:
            return {"accepted": True}
        today = datetime.now(ZoneInfo("Europe/Moscow")).date()
        boundary = _status_retirement_boundary(
            assignment["valid_from"], assignment["valid_to"], today
        )
        execute(
            connection,
            """UPDATE person_status_assignments
            SET retired_at=UTC_TIMESTAMP(3),retired_effective_on=:boundary
            WHERE id=:id""",
            {"id": str(assignment_id), "boundary": boundary},
        )
        audit(
            connection,
            staff.id,
            "PERSON_STATUS_RETIRED",
            "PersonStatusAssignment",
            str(assignment_id),
            {"effectiveOn": boundary.isoformat()},
        )
    return {"accepted": True}
