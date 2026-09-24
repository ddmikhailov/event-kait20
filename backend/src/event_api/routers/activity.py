from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError

from ..activity_schemas import (
    AchievementDecision,
    AchievementValues,
    ManualAdjustmentRequest,
    ParticipationAssignRequest,
    ParticipationCancelRequest,
    ParticipationConfirmRequest,
    ParticipationUpdate,
    ProfileConsentRequest,
    ProfileUpdate,
    ReferenceUpdate,
    ReferenceValues,
    ScoringRuleValues,
    SeasonValues,
    StudentMembershipCloseRequest,
    StudentMembershipTransferRequest,
    StudentMembershipValues,
)
from ..activity_service import (
    PARTICIPATION_SELECT,
    cancel_participation,
    confirm_registration,
    get_participation,
    outbox,
    participation_response,
    reference,
    scoped_reference,
    update_participation,
)
from ..database import Database, execute, row, rows
from ..dependencies import (
    Staff,
    administrator,
    csrf_administrator,
    csrf_super_admin,
    database,
)
from ..errors import ApiError
from ..scoring_v2 import decimal_string
from ..service_utils import audit, db_json, json_value, naive_utc, serial
from ..tenant_scope import require_event_for_staff, require_person_in_tenant
from .participants import search_pattern

admin = APIRouter(prefix="/admin/activity", tags=["activity"])
event_admin = APIRouter(prefix="/admin/events", tags=["participations"])
person_admin = APIRouter(prefix="/admin/people", tags=["person-activity"])
public = APIRouter(prefix="/public", tags=["active-public"])


def reference_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["name"],
        "description": item["description"],
        "active": bool(item["active"]),
        "sortOrder": item["sort_order"],
        "builtIn": bool(item.get("built_in", False)),
    }


def list_reference(db: Database, table: str) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(connection, f"SELECT * FROM {table} ORDER BY sort_order,code")
    return {"items": [reference_response(item) for item in items]}


def create_reference(
    db: Database, table: str, values: ReferenceValues, staff: Staff
) -> dict[str, Any]:
    identity = str(uuid4())
    try:
        with db.transaction() as connection:
            execute(
                connection,
                f"""INSERT INTO {table}
                (id,code,name,description,active,sort_order,created_at,updated_at)
                VALUES (:id,:code,:name,:description,:active,:sort_order,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {"id": identity, **values.model_dump()},
            )
            audit(
                connection,
                staff.id,
                "ACTIVITY_REFERENCE_CREATED",
                table,
                identity,
                {"code": values.code},
            )
    except IntegrityError as error:
        raise ApiError(
            409, "REFERENCE_CONFLICT", "Reference code already exists"
        ) from error
    with db.connect() as connection:
        item = row(connection, f"SELECT * FROM {table} WHERE id=:id", {"id": identity})
    assert item is not None
    return reference_response(item)


def update_reference_value(
    db: Database, table: str, identity: str, values: ReferenceUpdate, staff: Staff
) -> dict[str, Any]:
    with db.transaction() as connection:
        existing = row(
            connection,
            f"SELECT * FROM {table} WHERE id=:id FOR UPDATE",
            {"id": identity},
        )
        if not existing:
            raise ApiError(404, "REFERENCE_NOT_FOUND", "Reference value not found")
        changes = values.model_dump(exclude_unset=True)
        data = {
            "id": identity,
            "name": changes.get("name", existing["name"]),
            "description": changes.get("description", existing["description"]),
            "sort_order": changes.get("sort_order", existing["sort_order"]),
            "active": changes.get("active", existing["active"]),
        }
        execute(
            connection,
            f"""UPDATE {table} SET name=:name,description=:description,sort_order=:sort_order,
            active=:active,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            data,
        )
        audit(
            connection,
            staff.id,
            "ACTIVITY_REFERENCE_UPDATED",
            table,
            identity,
            {"fields": sorted(values.model_fields_set)},
        )
        item = row(connection, f"SELECT * FROM {table} WHERE id=:id", {"id": identity})
    assert item is not None
    return reference_response(item)


@admin.get("/roles")
def roles(
    _staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return list_reference(db, "participation_roles")


@admin.post("/roles", status_code=201)
def create_role(
    values: ReferenceValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return create_reference(db, "participation_roles", values, staff)


@admin.patch("/roles/{identity}")
def update_role(
    identity: UUID,
    values: ReferenceUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return update_reference_value(
        db, "participation_roles", str(identity), values, staff
    )


@admin.get("/results")
def results(
    _staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return list_reference(db, "participation_results")


@admin.post("/results", status_code=201)
def create_result(
    values: ReferenceValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return create_reference(db, "participation_results", values, staff)


@admin.patch("/results/{identity}")
def update_result(
    identity: UUID,
    values: ReferenceUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return update_reference_value(
        db, "participation_results", str(identity), values, staff
    )


@admin.get("/categories")
def categories(
    _staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return list_reference(db, "event_categories")


@admin.post("/categories", status_code=201)
def create_category(
    values: ReferenceValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return create_reference(db, "event_categories", values, staff)


@admin.patch("/categories/{identity}")
def update_category(
    identity: UUID,
    values: ReferenceUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return update_reference_value(db, "event_categories", str(identity), values, staff)


@admin.get("/levels")
def levels(
    _staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return list_reference(db, "event_levels")


@admin.post("/levels", status_code=201)
def create_level(
    values: ReferenceValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return create_reference(db, "event_levels", values, staff)


@admin.patch("/levels/{identity}")
def update_level(
    identity: UUID,
    values: ReferenceUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    return update_reference_value(db, "event_levels", str(identity), values, staff)


def season_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["name"],
        "startsAt": serial(item["starts_at"]),
        "endsAt": serial(item["ends_at"]),
        "active": bool(item["active"]),
        "scoringPolicyId": item["scoring_policy_id"],
        "scoringPolicyEffectiveFrom": serial(item["scoring_policy_effective_from"])
        if item["scoring_policy_effective_from"]
        else None,
    }


@admin.get("/seasons")
def seasons(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            "SELECT * FROM seasons WHERE organization_id=:organization ORDER BY starts_at DESC,id",
            {"organization": staff.organization_id},
        )
    return {"items": [season_response(item) for item in items]}


def save_season(
    connection: Connection,
    identity: str,
    values: SeasonValues,
    actor_id: str,
    organization_id: str,
    existing: RowMapping | None = None,
) -> None:
    if values.active:
        execute(
            connection,
            "UPDATE seasons SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE active=true AND organization_id=:organization AND id<>:id",
            {"id": identity, "organization": organization_id},
        )
    data = {
        "id": identity,
        "code": values.code,
        "name": values.name,
        "starts": naive_utc(values.starts_at),
        "ends": naive_utc(values.ends_at),
        "active": values.active,
        "organization": organization_id,
    }
    if existing:
        execute(
            connection,
            """UPDATE seasons SET code=:code,name=:name,starts_at=:starts,ends_at=:ends,
            active=:active,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            data,
        )
    else:
        execute(
            connection,
            """INSERT INTO seasons (id,organization_id,code,name,starts_at,ends_at,active,created_at,updated_at)
            VALUES (:id,:organization,:code,:name,:starts,:ends,:active,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            data,
        )
    audit(
        connection,
        actor_id,
        "SEASON_UPDATED" if existing else "SEASON_CREATED",
        "Season",
        identity,
        {"active": values.active},
    )


@admin.post("/seasons", status_code=201)
def create_season(
    values: SeasonValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    try:
        with db.transaction() as connection:
            save_season(connection, identity, values, staff.id, staff.organization_id)
            item = row(
                connection, "SELECT * FROM seasons WHERE id=:id", {"id": identity}
            )
    except IntegrityError as error:
        raise ApiError(
            409, "SEASON_CONFLICT", "Season code or active season conflicts"
        ) from error
    assert item is not None
    return season_response(item)


@admin.patch("/seasons/{identity}")
def update_season(
    identity: UUID,
    values: SeasonValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        existing = row(
            connection,
            "SELECT * FROM seasons WHERE id=:id FOR UPDATE",
            {"id": str(identity)},
        )
        if not existing:
            raise ApiError(404, "SEASON_NOT_FOUND", "Season not found")
        if existing["organization_id"] != staff.organization_id:
            raise ApiError(404, "SEASON_NOT_FOUND", "Season not found")
        save_season(
            connection, str(identity), values, staff.id, staff.organization_id, existing
        )
        item = row(
            connection, "SELECT * FROM seasons WHERE id=:id", {"id": str(identity)}
        )
    assert item is not None
    return season_response(item)


def rule_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "seasonId": item["season_id"],
        "eventCategoryId": item["event_category_id"],
        "eventLevelId": item["event_level_id"],
        "participationRoleId": item["participation_role_id"],
        "participationResultId": item["participation_result_id"],
        "points": item["points"],
        "priority": item["priority"],
        "active": bool(item["active"]),
        "validFrom": serial(item["valid_from"]) if item["valid_from"] else None,
        "validTo": serial(item["valid_to"]) if item["valid_to"] else None,
        "version": item["version"],
    }


@admin.get("/scoring-rules")
def scoring_rules(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    season_id: Annotated[UUID | None, Query(alias="seasonId")] = None,
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT sr.* FROM scoring_rules sr JOIN seasons s ON s.id=sr.season_id
            WHERE s.organization_id=:organization
              AND (:season IS NULL OR sr.season_id=:season)
            ORDER BY sr.active DESC,sr.priority DESC,sr.version DESC,sr.created_at DESC""",
            {
                "organization": staff.organization_id,
                "season": str(season_id) if season_id else None,
            },
        )
    return {"items": [rule_response(item) for item in items]}


def rule_overlap(left: Any, right: Any) -> bool:
    dimensions = (
        "event_category_id",
        "event_level_id",
        "participation_role_id",
        "participation_result_id",
    )
    return all(
        not left[key] or not right[key] or left[key] == right[key] for key in dimensions
    )


def validity_overlap(left: Any, right: Any) -> bool:
    return (
        left["valid_to"] is None
        or right["valid_from"] is None
        or right["valid_from"] < left["valid_to"]
    ) and (
        right["valid_to"] is None
        or left["valid_from"] is None
        or left["valid_from"] < right["valid_to"]
    )


def lock_scoring_season(
    connection: Connection, season_id: str, organization_id: str
) -> None:
    if not row(
        connection,
        "SELECT id FROM seasons WHERE id=:season AND organization_id=:organization FOR UPDATE",
        {"season": season_id, "organization": organization_id},
    ):
        raise ApiError(400, "INVALID_REFERENCE", "Referenced value is unavailable")


def assert_no_rule_conflict(
    connection: Connection,
    values: dict[str, Any],
    organization_id: str,
    exclude_id: str | None = None,
) -> None:
    if not values["active"]:
        return
    # The parent Season row is the concurrency lock for all rule writes in that season.
    # A gap/range lock over an empty candidate set alone would not protect this check.
    lock_scoring_season(connection, values["season_id"], organization_id)
    candidates = rows(
        connection,
        """SELECT * FROM scoring_rules WHERE active=true AND season_id=:season
        AND priority=:priority AND (:exclude IS NULL OR id<>:exclude) FOR UPDATE""",
        {
            "season": values["season_id"],
            "priority": values["priority"],
            "exclude": exclude_id,
        },
    )
    specificity = sum(
        values[key] is not None
        for key in (
            "event_category_id",
            "event_level_id",
            "participation_role_id",
            "participation_result_id",
        )
    )
    for candidate in candidates:
        other_specificity = sum(
            candidate[key] is not None
            for key in (
                "event_category_id",
                "event_level_id",
                "participation_role_id",
                "participation_result_id",
            )
        )
        if (
            specificity == other_specificity
            and rule_overlap(values, candidate)
            and validity_overlap(values, candidate)
        ):
            raise ApiError(
                409,
                "SCORING_RULE_CONFLICT",
                "An equally specific overlapping rule already exists at this priority",
            )


def rule_data(values: ScoringRuleValues) -> dict[str, Any]:
    data = values.model_dump()
    for key in (
        "season_id",
        "event_category_id",
        "event_level_id",
        "participation_role_id",
        "participation_result_id",
    ):
        data[key] = str(data[key]) if data[key] else None
    data["valid_from"] = naive_utc(data["valid_from"]) if data["valid_from"] else None
    data["valid_to"] = naive_utc(data["valid_to"]) if data["valid_to"] else None
    return data


def validate_rule_references(
    connection: Connection, data: dict[str, Any], organization_id: str
) -> None:
    scoped_reference(
        connection, "seasons", data["season_id"], organization_id, active=False
    )
    for table, key in (
        ("event_categories", "event_category_id"),
        ("event_levels", "event_level_id"),
        ("participation_roles", "participation_role_id"),
        ("participation_results", "participation_result_id"),
    ):
        if data[key]:
            reference(connection, table, data[key])


def insert_rule(
    connection: Connection,
    identity: str,
    data: dict[str, Any],
    version: int,
    actor_id: str,
) -> None:
    execute(
        connection,
        """INSERT INTO scoring_rules
        (id,season_id,event_category_id,event_level_id,participation_role_id,
         participation_result_id,points,priority,active,valid_from,valid_to,version,
         created_at,updated_at,created_by,updated_by)
        VALUES (:id,:season_id,:event_category_id,:event_level_id,:participation_role_id,
                :participation_result_id,:points,:priority,:active,:valid_from,:valid_to,:version,
                UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),:actor,:actor)""",
        {**data, "id": identity, "version": version, "actor": actor_id},
    )


@admin.post("/scoring-rules", status_code=201)
def create_scoring_rule(
    values: ScoringRuleValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity, data = str(uuid4()), rule_data(values)
    with db.transaction() as connection:
        lock_scoring_season(connection, data["season_id"], staff.organization_id)
        validate_rule_references(connection, data, staff.organization_id)
        assert_no_rule_conflict(connection, data, staff.organization_id)
        insert_rule(connection, identity, data, 1, staff.id)
        audit(connection, staff.id, "SCORING_RULE_CREATED", "ScoringRule", identity)
        item = row(
            connection, "SELECT * FROM scoring_rules WHERE id=:id", {"id": identity}
        )
    assert item is not None
    return rule_response(item)


@admin.patch("/scoring-rules/{identity}", status_code=201)
def replace_scoring_rule(
    identity: UUID,
    values: ScoringRuleValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    new_id, data = str(uuid4()), rule_data(values)
    with db.transaction() as connection:
        existing_hint = row(
            connection,
            "SELECT season_id FROM scoring_rules WHERE id=:id",
            {"id": str(identity)},
        )
        if not existing_hint:
            raise ApiError(404, "SCORING_RULE_NOT_FOUND", "Scoring rule not found")
        # A rule id is a bare UUID with no scope of its own; its season is the
        # only thing that ties it to an Organization, so that boundary has to
        # be checked before anything else uses this rule's identity.
        if not row(
            connection,
            "SELECT id FROM seasons WHERE id=:season AND organization_id=:organization",
            {
                "season": existing_hint["season_id"],
                "organization": staff.organization_id,
            },
        ):
            raise ApiError(404, "SCORING_RULE_NOT_FOUND", "Scoring rule not found")
        if data["season_id"] != existing_hint["season_id"]:
            raise ApiError(
                409,
                "SCORING_RULE_SEASON_IMMUTABLE",
                "A scoring rule version cannot move to another season",
            )
        lock_scoring_season(
            connection, existing_hint["season_id"], staff.organization_id
        )
        existing = row(
            connection,
            "SELECT * FROM scoring_rules WHERE id=:id FOR UPDATE",
            {"id": str(identity)},
        )
        if not existing:
            raise ApiError(404, "SCORING_RULE_NOT_FOUND", "Scoring rule not found")
        if not data["active"]:
            raise ApiError(
                409,
                "SCORING_RULE_RETIRE_REQUIRED",
                "Use the scoring-rule deactivate endpoint to retire a rule",
            )
        validate_rule_references(connection, data, staff.organization_id)
        boundary = data["valid_from"]
        current = row(connection, "SELECT UTC_TIMESTAMP(3) AS current_value")
        assert current is not None
        if boundary is None:
            boundary = current["current_value"]
            data["valid_from"] = boundary
        if existing["valid_from"] is not None and boundary <= existing["valid_from"]:
            raise ApiError(
                409,
                "SCORING_RULE_VERSION_PERIOD_INVALID",
                "A replacement rule must start after the previous version",
            )
        if data["valid_to"] is not None and data["valid_to"] <= boundary:
            raise ApiError(
                409,
                "SCORING_RULE_VERSION_PERIOD_INVALID",
                "A replacement rule must end after it starts",
            )
        if boundary < current["current_value"] and row(
            connection,
            """SELECT st.id FROM score_transactions st
            JOIN participations p ON p.id=st.participation_id
            JOIN events e ON e.id=p.event_id
            WHERE st.scoring_rule_id=:rule AND st.transaction_type='AWARD'
              AND e.start_at>=:boundary LIMIT 1""",
            {"rule": str(identity), "boundary": boundary},
        ):
            raise ApiError(
                409,
                "SCORING_RULE_RETROACTIVE_CONFLICT",
                "The new validity boundary crosses an existing score award",
            )
        if existing["active"] and (
            existing["valid_to"] is None or existing["valid_to"] > boundary
        ):
            execute(
                connection,
                """UPDATE scoring_rules SET valid_to=:boundary,updated_at=UTC_TIMESTAMP(3),
                updated_by=:actor WHERE id=:id""",
                {
                    "id": str(identity),
                    "boundary": boundary,
                    "actor": staff.id,
                },
            )
        assert_no_rule_conflict(connection, data, staff.organization_id)
        insert_rule(connection, new_id, data, int(existing["version"]) + 1, staff.id)
        audit(
            connection,
            staff.id,
            "SCORING_RULE_UPDATED",
            "ScoringRule",
            new_id,
            {"previousRuleId": str(identity)},
        )
        item = row(
            connection, "SELECT * FROM scoring_rules WHERE id=:id", {"id": new_id}
        )
    assert item is not None
    return rule_response(item)


@admin.delete("/scoring-rules/{identity}")
def deactivate_scoring_rule(
    identity: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        existing_hint = row(
            connection,
            "SELECT season_id FROM scoring_rules WHERE id=:id",
            {"id": str(identity)},
        )
        if not existing_hint:
            raise ApiError(404, "SCORING_RULE_NOT_FOUND", "Scoring rule not found")
        if not row(
            connection,
            "SELECT id FROM seasons WHERE id=:season AND organization_id=:organization",
            {
                "season": existing_hint["season_id"],
                "organization": staff.organization_id,
            },
        ):
            raise ApiError(404, "SCORING_RULE_NOT_FOUND", "Scoring rule not found")
        lock_scoring_season(
            connection, existing_hint["season_id"], staff.organization_id
        )
        existing = row(
            connection,
            "SELECT active,valid_from,valid_to FROM scoring_rules WHERE id=:id FOR UPDATE",
            {"id": str(identity)},
        )
        if not existing:
            raise ApiError(404, "SCORING_RULE_NOT_FOUND", "Scoring rule not found")
        if not existing["active"]:
            return {"accepted": True}
        current = row(connection, "SELECT UTC_TIMESTAMP(3) AS current_value")
        assert current is not None
        retired_at = current["current_value"]
        has_award = bool(
            row(
                connection,
                """SELECT id FROM score_transactions
                WHERE scoring_rule_id=:rule AND transaction_type='AWARD' LIMIT 1""",
                {"rule": str(identity)},
            )
        )
        has_started = (
            existing["valid_from"] is None or existing["valid_from"] <= retired_at
        )
        if not has_started and has_award:
            raise ApiError(
                409,
                "SCORING_RULE_RETROACTIVE_CONFLICT",
                "A future scoring rule with existing awards cannot be deactivated",
            )
        if has_started:
            previous_valid_to = existing["valid_to"]
            if previous_valid_to is None or previous_valid_to > retired_at:
                execute(
                    connection,
                    """UPDATE scoring_rules SET valid_to=:retired_at,
                    updated_at=UTC_TIMESTAMP(3),updated_by=:actor WHERE id=:id""",
                    {
                        "id": str(identity),
                        "retired_at": retired_at,
                        "actor": staff.id,
                    },
                )
                audit(
                    connection,
                    staff.id,
                    "SCORING_RULE_RETIRED",
                    "ScoringRule",
                    str(identity),
                    {
                        "ruleId": str(identity),
                        "retiredAt": serial(retired_at),
                        "previousValidTo": serial(previous_valid_to),
                        "historical": True,
                    },
                )
        else:
            execute(
                connection,
                """UPDATE scoring_rules SET active=false,
                updated_at=UTC_TIMESTAMP(3),updated_by=:actor WHERE id=:id""",
                {"id": str(identity), "actor": staff.id},
            )
            audit(
                connection,
                staff.id,
                "SCORING_RULE_DEACTIVATED",
                "ScoringRule",
                str(identity),
            )
    return {"accepted": True}


@admin.get("/participations")
def search_participations(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    query: str = Query("", max_length=200),
    status: str | None = Query(None, pattern="^(DRAFT|CONFIRMED|CANCELLED)$"),
    scoring_state: str | None = Query(
        None, alias="scoringState", pattern="^(NOT_SCORED|AWARDED|NO_RULE|REVERSED)$"
    ),
    season_id: UUID | None = Query(None, alias="seasonId"),  # noqa: B008 - Query default
    direction_id: UUID | None = Query(None, alias="directionId"),  # noqa: B008
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    # Cross-Event: unlike list_event_participations (scoped to one Event by
    # its URL), this browses across the whole organisation, so it must do
    # its own scoping. Organization is the trusted boundary (never
    # client-supplied — taken from staff.organization_id, mirroring the
    # pattern in scoring_v2.py/structure.py); tenant check stays as
    # defense-in-depth alongside it.
    where = """o.tenant_id=:tenant AND e.organization_id=:organization AND r.status='ACTIVE'
        AND (:query='' OR concat_ws(' ',r.last_name,r.first_name,r.middle_name) LIKE :search
             OR coalesce(r.email,'') LIKE :search OR coalesce(r.phone,'') LIKE :search
             OR coalesce(r.study_group,'') LIKE :search)
        AND (:status IS NULL OR COALESCE(p.status,'DRAFT')=:status)
        AND (:scoring_state IS NULL OR COALESCE(p.scoring_state,'NOT_SCORED')=:scoring_state)
        AND (:season_id IS NULL OR e.season_id=:season_id)
        AND (:direction_id IS NULL OR e.direction_id=:direction_id)"""
    params = {
        "tenant": staff.tenant_id,
        "organization": staff.organization_id,
        "query": query,
        "search": search_pattern(query),
        "status": status,
        "scoring_state": scoring_state,
        "season_id": str(season_id) if season_id else None,
        "direction_id": str(direction_id) if direction_id else None,
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    with db.connect() as connection:
        items = rows(
            connection,
            PARTICIPATION_SELECT
            + f" JOIN organizations o ON o.id=e.organization_id WHERE {where}"
            " ORDER BY e.start_at DESC,r.last_name,r.first_name,r.id LIMIT :limit OFFSET :offset",
            params,
        )
        count = row(
            connection,
            f"""SELECT COUNT(*) AS total FROM registrations r
            JOIN events e ON e.id=r.event_id
            JOIN organizations o ON o.id=e.organization_id
            LEFT JOIN participations p ON p.registration_id=r.id
            WHERE {where}""",
            params,
        )
    return {
        "items": [participation_response(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": int(count["total"] if count else 0),
    }


@event_admin.get("/{event_id}/participations")
def list_event_participations(
    event_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, alias="pageSize", ge=1, le=200),
) -> dict[str, Any]:
    params = {
        "event": str(event_id),
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    with db.connect() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id
        )
        items = rows(
            connection,
            PARTICIPATION_SELECT
            + " WHERE r.event_id=:event AND r.status='ACTIVE' ORDER BY r.last_name,r.first_name,r.id LIMIT :limit OFFSET :offset",
            params,
        )
        count = row(
            connection,
            "SELECT COUNT(*) AS total FROM registrations WHERE event_id=:event AND status='ACTIVE'",
            params,
        )
    return {
        "items": [participation_response(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": int(count["total"] if count else 0),
    }


@event_admin.post("/{event_id}/participations/assign")
def assign_participations(
    event_id: UUID,
    values: ParticipationAssignRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    assigned: list[str] = []
    with db.transaction() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id, lock=True
        )
        role = reference(connection, "participation_roles", str(values.role_id))
        if values.result_id:
            reference(connection, "participation_results", str(values.result_id))
        for registration_id in values.registration_ids:
            registration = row(
                connection,
                "SELECT * FROM registrations WHERE id=:id AND event_id=:event AND status='ACTIVE' FOR UPDATE",
                {"id": str(registration_id), "event": str(event_id)},
            )
            if not registration:
                raise ApiError(
                    404, "REGISTRATION_NOT_FOUND", "Active registration not found"
                )
            existing = row(
                connection,
                "SELECT * FROM participations WHERE registration_id=:id FOR UPDATE",
                {"id": str(registration_id)},
            )
            if existing:
                update_participation(
                    connection,
                    existing["id"],
                    staff.id,
                    str(values.role_id),
                    str(values.result_id) if values.result_id else None,
                    {"role_id", "result_id"},
                    values.reason,
                )
                assigned.append(existing["id"])
                continue
            identity = str(uuid4())
            execute(
                connection,
                """INSERT INTO participations
                (id,person_id,event_id,registration_id,stream_id,role_id,result_id,status,source,
                 scoring_state,scoring_cycle,created_at,updated_at)
                VALUES (:id,:person,:event,:registration,:stream,:role,:result,'DRAFT','ADMIN',
                        'NOT_SCORED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    "id": identity,
                    "person": registration["person_id"],
                    "event": str(event_id),
                    "registration": str(registration_id),
                    "stream": registration["stream_id"],
                    "role": role["id"],
                    "result": str(values.result_id) if values.result_id else None,
                },
            )
            audit(
                connection,
                staff.id,
                "PARTICIPATION_UPDATED",
                "Participation",
                identity,
                {"reason": values.reason, "status": "DRAFT"},
            )
            assigned.append(identity)
    return {"accepted": True, "participationIds": assigned}


@event_admin.post("/{event_id}/participations/confirm")
def confirm_participations(
    event_id: UUID,
    values: ParticipationConfirmRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    confirmed: list[str] = []
    with db.transaction() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id, lock=True
        )
        for registration_id in values.registration_ids:
            confirmed.append(
                confirm_registration(
                    connection,
                    str(event_id),
                    str(registration_id),
                    staff.id,
                    str(values.role_id) if values.role_id else None,
                    str(values.result_id) if values.result_id else None,
                    values.source,
                    values.confirm_without_attendance,
                    values.override_reason,
                )
            )
    return {"accepted": True, "participationIds": confirmed}


@event_admin.patch("/{event_id}/participations/{participation_id}")
def patch_participation(
    event_id: UUID,
    participation_id: UUID,
    values: ParticipationUpdate,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id, lock=True
        )
        target = row(
            connection,
            "SELECT event_id FROM participations WHERE id=:id",
            {"id": str(participation_id)},
        )
        if not target or target["event_id"] != str(event_id):
            raise ApiError(404, "PARTICIPATION_NOT_FOUND", "Participation not found")
        update_participation(
            connection,
            str(participation_id),
            staff.id,
            str(values.role_id) if values.role_id else None,
            str(values.result_id) if values.result_id else None,
            values.model_fields_set,
            values.reason,
        )
        return get_participation(connection, str(participation_id))


@event_admin.post("/{event_id}/participations/cancel")
def cancel_participations(
    event_id: UUID,
    values: ParticipationCancelRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        require_event_for_staff(
            connection, str(event_id), staff.tenant_id, staff.organization_id, lock=True
        )
        for participation_id in values.participation_ids:
            target = row(
                connection,
                "SELECT event_id FROM participations WHERE id=:id",
                {"id": str(participation_id)},
            )
            if not target or target["event_id"] != str(event_id):
                raise ApiError(
                    404, "PARTICIPATION_NOT_FOUND", "Participation not found"
                )
            cancel_participation(
                connection, str(participation_id), staff.id, values.reason
            )
    return {"accepted": True}


@admin.post("/score-adjustments", status_code=201)
def manual_adjustment(
    values: ManualAdjustmentRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    key = f"manual:{values.request_id}"
    expected = {
        "person_id": str(values.person_id),
        "season_id": str(values.season_id),
        "points": values.points,
        "reason": values.reason,
    }
    with db.transaction() as connection:
        require_person_in_tenant(
            connection, str(values.person_id), staff.tenant_id, lock=True
        )
        scoped_reference(
            connection,
            "seasons",
            str(values.season_id),
            staff.organization_id,
            active=False,
        )
        existing = row(
            connection,
            "SELECT * FROM score_transactions WHERE idempotency_key=:key FOR UPDATE",
            {"key": key},
        )
        created = False
        if not existing:
            created = True
            try:
                execute(
                    connection,
                    """INSERT INTO score_transactions
                    (id,person_id,season_id,transaction_type,points,reason,source,idempotency_key,created_at,created_by)
                    VALUES (:id,:person,:season,'MANUAL_ADJUSTMENT',:points,:reason,'ADMIN',:key,UTC_TIMESTAMP(3),:actor)""",
                    {
                        "id": identity,
                        "person": expected["person_id"],
                        "season": expected["season_id"],
                        "points": expected["points"],
                        "reason": expected["reason"],
                        "key": key,
                        "actor": staff.id,
                    },
                )
            except IntegrityError:
                existing = row(
                    connection,
                    "SELECT * FROM score_transactions WHERE idempotency_key=:key",
                    {"key": key},
                )
                if not existing:
                    raise
                created = False
        if existing:
            actual = {
                "person_id": existing["person_id"],
                "season_id": existing["season_id"],
                "points": existing["points"],
                "reason": existing["reason"],
            }
            if (
                actual != expected
                or existing["transaction_type"] != "MANUAL_ADJUSTMENT"
            ):
                raise ApiError(
                    409,
                    "IDEMPOTENCY_KEY_REUSED",
                    "This request ID was already used for a different adjustment",
                )
            identity = existing["id"]
        if created:
            audit(
                connection,
                staff.id,
                "SCORE_MANUAL_ADJUSTMENT",
                "ScoreTransaction",
                identity,
                {"points": decimal_string(values.points), "reason": values.reason},
            )
    return {"id": identity, "accepted": True}


def profile_response(item: RowMapping, consent: RowMapping | None) -> dict[str, Any]:
    return {
        "id": item["id"],
        "personId": item["person_id"],
        "publicSlug": item["public_slug"],
        "visibility": item["visibility"],
        "consent": (
            {
                "consentVersion": consent["consent_version"],
                "allowedFields": json_value(consent["allowed_fields"]),
                "acceptedAt": serial(consent["accepted_at"]),
            }
            if consent
            else None
        ),
    }


def load_profile(
    connection: Connection, person_id: str, tenant_id: str
) -> tuple[RowMapping, RowMapping | None]:
    """Upsert-and-read: creates the StudentProfile row (default PRIVATE) if it
    doesn't exist yet, locking it either way. For mutating endpoints only —
    GET must stay read-only, see read_profile() below.
    """
    require_person_in_tenant(connection, person_id, tenant_id, lock=True)
    identity = str(uuid4())
    execute(
        connection,
        """INSERT INTO student_profiles (id,person_id,visibility,created_at,updated_at)
        VALUES (:id,:person,'PRIVATE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE person_id=VALUES(person_id)""",
        {"id": identity, "person": person_id},
    )
    profile = row(
        connection,
        "SELECT * FROM student_profiles WHERE person_id=:person FOR UPDATE",
        {"person": person_id},
    )
    assert profile is not None
    consent = row(
        connection,
        """SELECT * FROM profile_publication_consents
        WHERE person_id=:person AND withdrawn_at IS NULL ORDER BY accepted_at DESC,id DESC LIMIT 1""",
        {"person": person_id},
    )
    return profile, consent


def read_profile(
    connection: Connection, person_id: str, tenant_id: str
) -> tuple[RowMapping | None, RowMapping | None]:
    """Read-only counterpart of load_profile(): never creates a row, so GET
    stays a safe method with no side effect. Returns (None, None) when no
    StudentProfile exists yet for this Person.
    """
    require_person_in_tenant(connection, person_id, tenant_id)
    profile = row(
        connection,
        "SELECT * FROM student_profiles WHERE person_id=:person",
        {"person": person_id},
    )
    if not profile:
        return None, None
    consent = row(
        connection,
        """SELECT * FROM profile_publication_consents
        WHERE person_id=:person AND withdrawn_at IS NULL ORDER BY accepted_at DESC,id DESC LIMIT 1""",
        {"person": person_id},
    )
    return profile, consent


@person_admin.get("/{person_id}/profile")
def get_profile_admin(
    person_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        profile, consent = read_profile(connection, str(person_id), staff.tenant_id)
        if profile is None:
            return {
                "id": None,
                "personId": str(person_id),
                "publicSlug": None,
                "visibility": "PRIVATE",
                "consent": None,
            }
        return profile_response(profile, consent)


@person_admin.patch("/{person_id}/profile")
def update_profile_admin(
    person_id: UUID,
    values: ProfileUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        profile, consent = load_profile(connection, str(person_id), staff.tenant_id)
        if values.visibility != "PRIVATE" and not consent:
            raise ApiError(
                409, "PUBLICATION_CONSENT_REQUIRED", "Publication consent is required"
            )
        slug = profile["public_slug"]
        if values.visibility != "PRIVATE" and not slug:
            slug = "active-" + secrets.token_urlsafe(18).rstrip("=")
        execute(
            connection,
            "UPDATE student_profiles SET visibility=:visibility,public_slug=:slug,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": profile["id"], "visibility": values.visibility, "slug": slug},
        )
        audit(
            connection,
            staff.id,
            "PROFILE_VISIBILITY_CHANGED",
            "StudentProfile",
            profile["id"],
            {"before": profile["visibility"], "after": values.visibility},
        )
        outbox(
            connection,
            "profile.visibility.changed",
            "StudentProfile",
            profile["id"],
            {"profileId": profile["id"], "visibility": values.visibility},
        )
        updated, consent = load_profile(connection, str(person_id), staff.tenant_id)
        return profile_response(updated, consent)


@person_admin.post("/{person_id}/profile/consent", status_code=201)
def grant_profile_consent(
    person_id: UUID,
    values: ProfileConsentRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        _profile, _ = load_profile(connection, str(person_id), staff.tenant_id)
        execute(
            connection,
            "UPDATE profile_publication_consents SET withdrawn_at=UTC_TIMESTAMP(3) WHERE person_id=:person AND withdrawn_at IS NULL",
            {"person": str(person_id)},
        )
        consent_id = str(uuid4())
        execute(
            connection,
            """INSERT INTO profile_publication_consents
            (id,person_id,consent_version,allowed_fields,accepted_at,source,created_at)
            VALUES (:id,:person,:version,:fields,UTC_TIMESTAMP(3),:source,UTC_TIMESTAMP(3))""",
            {
                "id": consent_id,
                "person": str(person_id),
                "version": values.consent_version,
                "fields": db_json(values.allowed_fields),
                "source": values.source,
            },
        )
        audit(
            connection,
            staff.id,
            "PROFILE_CONSENT_GRANTED",
            "ProfilePublicationConsent",
            consent_id,
            {"allowedFields": values.allowed_fields},
        )
        updated, consent = load_profile(connection, str(person_id), staff.tenant_id)
        return profile_response(updated, consent)


@person_admin.delete("/{person_id}/profile/consent")
def withdraw_profile_consent(
    person_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        profile, consent = load_profile(connection, str(person_id), staff.tenant_id)
        if consent:
            execute(
                connection,
                "UPDATE profile_publication_consents SET withdrawn_at=UTC_TIMESTAMP(3) WHERE id=:id",
                {"id": consent["id"]},
            )
        execute(
            connection,
            "UPDATE student_profiles SET visibility='PRIVATE',updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": profile["id"]},
        )
        audit(
            connection,
            staff.id,
            "PROFILE_CONSENT_WITHDRAWN",
            "StudentProfile",
            profile["id"],
        )
        outbox(
            connection,
            "profile.visibility.changed",
            "StudentProfile",
            profile["id"],
            {"profileId": profile["id"], "visibility": "PRIVATE"},
        )
    return {"accepted": True}


MEMBERSHIP_SELECT = """SELECT sm.*,o.name AS organization
FROM student_memberships sm
JOIN organizations o ON o.id=sm.organization_id
LEFT JOIN study_groups sg ON sg.id=sm.study_group_id
LEFT JOIN departments d ON d.id=sm.department_id"""


def membership_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "personId": item["person_id"],
        "organizationId": item["organization_id"],
        "organization": item["organization"],
        "departmentId": item["department_id"],
        "studyGroupId": item["study_group_id"],
        "studyGroup": item["study_group"],
        "department": item["department"],
        "course": item["course"],
        "validFrom": item["valid_from"].isoformat(),
        "validTo": item["valid_to"].isoformat() if item["valid_to"] else None,
    }


@person_admin.get("/{person_id}/memberships")
def list_memberships(
    person_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    # StudentMembership belongs to Organization (Event/StudyGroup/Department
    # do too; Person itself is Tenant-canonical - see the Security Boundary
    # Gate). Scoping this history to staff.organization_id keeps Organization
    # A from seeing Organization B's membership rows for a Person just
    # because the Person identity happens to be shared tenant-wide.
    with db.connect() as connection:
        if not row(
            connection,
            "SELECT 1 FROM persons WHERE id=:id AND tenant_id=:tenant",
            {"id": str(person_id), "tenant": staff.tenant_id},
        ):
            raise ApiError(404, "PERSON_NOT_FOUND", "Person not found")
        items = rows(
            connection,
            MEMBERSHIP_SELECT
            + " WHERE sm.person_id=:person AND sm.organization_id=:organization"
            " ORDER BY valid_from DESC,id",
            {"person": str(person_id), "organization": staff.organization_id},
        )
    return {"items": [membership_response(item) for item in items]}


@person_admin.post("/{person_id}/memberships", status_code=201)
def create_membership(
    person_id: UUID,
    values: StudentMembershipValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    with db.transaction() as connection:
        if not row(
            connection,
            """SELECT id FROM persons
            WHERE id=:id AND tenant_id=:tenant FOR UPDATE""",
            {"id": str(person_id), "tenant": staff.tenant_id},
        ):
            raise ApiError(404, "PERSON_NOT_FOUND", "Person not found")
        group = row(
            connection,
            """SELECT sg.id,sg.organization_id,sg.department_id,sg.name,sg.course,
            d.name AS department FROM study_groups sg
            JOIN organizations o ON o.id=sg.organization_id
            JOIN departments d ON d.id=sg.department_id
            WHERE sg.id=:id AND sg.organization_id=:organization AND sg.active=true
              AND d.active=true FOR UPDATE""",
            {"id": str(values.study_group_id), "organization": staff.organization_id},
        )
        if not group or group["course"] is None:
            raise ApiError(404, "STUDY_GROUP_NOT_FOUND", "Study group not found")
        overlap = row(
            connection,
            """SELECT id FROM student_memberships
            WHERE person_id=:person
              AND valid_from<=COALESCE(:valid_to,DATE('9999-12-31'))
              AND (valid_to IS NULL OR valid_to>=:valid_from)
            LIMIT 1 FOR UPDATE""",
            {
                "person": str(person_id),
                "valid_from": values.valid_from,
                "valid_to": values.valid_to,
            },
        )
        if overlap:
            raise ApiError(
                409,
                "MEMBERSHIP_PERIOD_OVERLAP",
                "The person already has a study membership for this period",
            )
        execute(
            connection,
            """INSERT INTO student_memberships
            (id,person_id,organization_id,department_id,study_group_id,course,
             study_group,department,valid_from,valid_to,created_at,updated_at)
            VALUES (:id,:person,:organization,:department_id,:study_group_id,:course,
                    :study_group,:department,:valid_from,:valid_to,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": identity,
                "person": str(person_id),
                "organization": group["organization_id"],
                "department_id": group["department_id"],
                "study_group_id": group["id"],
                "course": group["course"],
                "study_group": group["name"],
                "department": group["department"],
                "valid_from": values.valid_from,
                "valid_to": values.valid_to,
            },
        )
        audit(
            connection,
            staff.id,
            "STUDENT_MEMBERSHIP_CREATED",
            "StudentMembership",
            identity,
            {"validFrom": values.valid_from.isoformat()},
        )
        item = row(connection, MEMBERSHIP_SELECT + " WHERE sm.id=:id", {"id": identity})
    assert item is not None
    return membership_response(item)


def assert_membership_history_unambiguous(
    connection: Connection, person_id: str
) -> None:
    """Data Integrity Gate proved the API's own writes can never create an
    overlapping pair, but pre-existing/legacy data could still be ambiguous.
    Shared by every membership lifecycle mutation (transfer, close, ...) so
    none of them ever guesses, picks a row, or partially repairs corrupted
    history - they all refuse outright instead. Deliberately Person-wide
    (not scoped to staff.organization_id): the N18 overlap invariant is
    Tenant-wide per Person, so an overlap involving a foreign Organization's
    membership is still an integrity conflict for this Person, even though
    its details are never disclosed to the caller. Call this AFTER the
    Person row lock, so concurrent writes for the same Person stay
    serialized against this guard.
    """
    corrupted = row(
        connection,
        """SELECT sm1.id FROM student_memberships sm1
        JOIN student_memberships sm2 ON sm2.person_id=sm1.person_id AND sm2.id<>sm1.id
        WHERE sm1.person_id=:person
          AND sm1.valid_from<=COALESCE(sm2.valid_to,DATE('9999-12-31'))
          AND (sm1.valid_to IS NULL OR sm1.valid_to>=sm2.valid_from)
        LIMIT 1""",
        {"person": person_id},
    )
    if corrupted:
        raise ApiError(
            409,
            "MEMBERSHIP_PERIOD_OVERLAP",
            "Membership history requires reconciliation before it can be changed",
        )


@person_admin.post("/{person_id}/memberships/transfer")
def transfer_membership(
    person_id: UUID,
    values: StudentMembershipTransferRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        # The Person row lock is the same serialization point
        # create_membership already uses - no second locking mechanism.
        require_person_in_tenant(connection, str(person_id), staff.tenant_id, lock=True)
        assert_membership_history_unambiguous(connection, str(person_id))
        # The membership being transferred must belong to the caller's own
        # Organization - a Person's open-ended membership elsewhere (a
        # different Organization in the same Tenant) is invisible here, same
        # as list_memberships above.
        source = row(
            connection,
            """SELECT * FROM student_memberships
            WHERE person_id=:person AND organization_id=:organization AND valid_to IS NULL
            LIMIT 1 FOR UPDATE""",
            {"person": str(person_id), "organization": staff.organization_id},
        )
        if not source:
            raise ApiError(
                404,
                "MEMBERSHIP_NOT_FOUND",
                "No current membership found for this organization",
            )
        if values.effective_from <= source["valid_from"]:
            raise ApiError(
                400,
                "VALIDATION_ERROR",
                "Transfer date must be after the current membership's start",
            )
        group = row(
            connection,
            """SELECT sg.id,sg.organization_id,sg.department_id,sg.name,sg.course,
            d.name AS department FROM study_groups sg
            JOIN organizations o ON o.id=sg.organization_id
            JOIN departments d ON d.id=sg.department_id
            WHERE sg.id=:id AND sg.organization_id=:organization AND sg.active=true
              AND d.active=true FOR UPDATE""",
            {"id": str(values.study_group_id), "organization": staff.organization_id},
        )
        if not group or group["course"] is None:
            raise ApiError(404, "STUDY_GROUP_NOT_FOUND", "Study group not found")
        if str(group["id"]) == str(source["study_group_id"]):
            raise ApiError(
                409,
                "CONFLICT",
                "Target study group matches the current membership",
            )
        # The old period will end at effective_from-1 (checked below via the
        # UPDATE), so it can never overlap the new [effective_from, NULL)
        # period by construction - exclude it here and check every OTHER
        # membership instead, in case a future-dated row already exists.
        conflict = row(
            connection,
            """SELECT id FROM student_memberships
            WHERE person_id=:person AND id<>:source
              AND (valid_to IS NULL OR valid_to>=:effective_from)
            LIMIT 1 FOR UPDATE""",
            {
                "person": str(person_id),
                "source": source["id"],
                "effective_from": values.effective_from,
            },
        )
        if conflict:
            raise ApiError(
                409,
                "MEMBERSHIP_PERIOD_OVERLAP",
                "The new period conflicts with an existing membership",
            )
        old_valid_to = values.effective_from - timedelta(days=1)
        execute(
            connection,
            "UPDATE student_memberships SET valid_to=:valid_to,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"valid_to": old_valid_to, "id": source["id"]},
        )
        new_id = str(uuid4())
        execute(
            connection,
            """INSERT INTO student_memberships
            (id,person_id,organization_id,department_id,study_group_id,course,
             study_group,department,valid_from,valid_to,created_at,updated_at)
            VALUES (:id,:person,:organization,:department_id,:study_group_id,:course,
                    :study_group,:department,:valid_from,NULL,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": new_id,
                "person": str(person_id),
                "organization": group["organization_id"],
                "department_id": group["department_id"],
                "study_group_id": group["id"],
                "course": group["course"],
                "study_group": group["name"],
                "department": group["department"],
                "valid_from": values.effective_from,
            },
        )
        audit(
            connection,
            staff.id,
            "STUDENT_MEMBERSHIP_TRANSFERRED",
            "StudentMembership",
            new_id,
            {
                "oldMembershipId": source["id"],
                "newMembershipId": new_id,
                "effectiveFrom": values.effective_from.isoformat(),
                "oldStudyGroupId": source["study_group_id"],
                "newStudyGroupId": str(group["id"]),
            },
        )
        previous_item = row(
            connection, MEMBERSHIP_SELECT + " WHERE sm.id=:id", {"id": source["id"]}
        )
        current_item = row(
            connection, MEMBERSHIP_SELECT + " WHERE sm.id=:id", {"id": new_id}
        )
    assert previous_item is not None
    assert current_item is not None
    return {
        "previous": membership_response(previous_item),
        "current": membership_response(current_item),
    }


@person_admin.post("/{person_id}/memberships/close")
def close_membership(
    person_id: UUID,
    values: StudentMembershipCloseRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        require_person_in_tenant(connection, str(person_id), staff.tenant_id, lock=True)
        assert_membership_history_unambiguous(connection, str(person_id))
        current = row(
            connection,
            """SELECT * FROM student_memberships
            WHERE person_id=:person AND organization_id=:organization
            ORDER BY valid_from DESC,id LIMIT 1 FOR UPDATE""",
            {"person": str(person_id), "organization": staff.organization_id},
        )
        if not current:
            raise ApiError(
                404,
                "MEMBERSHIP_NOT_FOUND",
                "No current membership found for this organization",
            )
        if current["valid_to"] is not None:
            raise ApiError(
                409, "MEMBERSHIP_ALREADY_CLOSED", "This membership is already closed"
            )
        if values.last_valid_on < current["valid_from"]:
            raise ApiError(
                400,
                "VALIDATION_ERROR",
                "Membership end cannot be before its start",
            )
        execute(
            connection,
            "UPDATE student_memberships SET valid_to=:valid_to,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"valid_to": values.last_valid_on, "id": current["id"]},
        )
        audit(
            connection,
            staff.id,
            "STUDENT_MEMBERSHIP_CLOSED",
            "StudentMembership",
            current["id"],
            {"lastValidOn": values.last_valid_on.isoformat()},
        )
        item = row(
            connection, MEMBERSHIP_SELECT + " WHERE sm.id=:id", {"id": current["id"]}
        )
    assert item is not None
    return membership_response(item)


@person_admin.get("/{person_id}/activity")
def person_activity(
    person_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, alias="pageSize", ge=1, le=200),
) -> dict[str, Any]:
    with db.connect() as connection:
        require_person_in_tenant(connection, str(person_id), staff.tenant_id)
        participations = rows(
            connection,
            """SELECT p.id,p.status,p.scoring_state,p.confirmed_at,e.id AS event_id,e.title,
            e.start_at AS event_start_at,
            pr.code AS role_code,pr.name AS role_name,pres.code AS result_code,pres.name AS result_name,
            COALESCE((SELECT SUM(points) FROM score_transactions st WHERE st.participation_id=p.id),0) AS points
            FROM participations p JOIN events e ON e.id=p.event_id
            LEFT JOIN participation_roles pr ON pr.id=p.role_id
            LEFT JOIN participation_results pres ON pres.id=p.result_id
            WHERE p.person_id=:person ORDER BY p.confirmed_at DESC,p.created_at DESC
            LIMIT :limit OFFSET :offset""",
            {
                "person": str(person_id),
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
        scores = rows(
            connection,
            """SELECT st.id,st.season_id,se.name AS season_name,st.transaction_type,st.points,
            st.reason,st.created_at,st.participation_id FROM score_transactions st
            JOIN seasons se ON se.id=st.season_id WHERE st.person_id=:person
            ORDER BY st.created_at DESC,st.id DESC LIMIT :limit OFFSET :offset""",
            {
                "person": str(person_id),
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
        totals = rows(
            connection,
            """SELECT st.season_id,se.name AS season_name,SUM(st.points) AS points
            FROM score_transactions st JOIN seasons se ON se.id=st.season_id
            WHERE st.person_id=:person GROUP BY st.season_id,se.name ORDER BY se.starts_at DESC""",
            {"person": str(person_id)},
        )
        achievements = rows(
            connection,
            """SELECT id,title,description,achievement_type,status,occurred_at,
            event_id,participation_id,created_at FROM achievements
            WHERE person_id=:person ORDER BY occurred_at DESC,id DESC""",
            {"person": str(person_id)},
        )
    return {
        "participations": [
            {
                "id": item["id"],
                "eventId": item["event_id"],
                "eventTitle": item["title"],
                "eventStartAt": serial(item["event_start_at"]),
                "status": item["status"],
                "scoringState": item["scoring_state"],
                "confirmedAt": serial(item["confirmed_at"])
                if item["confirmed_at"]
                else None,
                "role": {"code": item["role_code"], "name": item["role_name"]}
                if item["role_code"]
                else None,
                "result": {"code": item["result_code"], "name": item["result_name"]}
                if item["result_code"]
                else None,
                "points": decimal_string(item["points"]),
            }
            for item in participations
        ],
        "scoreTransactions": [
            {
                "id": item["id"],
                "seasonId": item["season_id"],
                "seasonName": item["season_name"],
                "type": item["transaction_type"],
                "points": item["points"],
                "reason": item["reason"],
                "participationId": item["participation_id"],
                "createdAt": serial(item["created_at"]),
            }
            for item in scores
        ],
        "scoreSummary": [
            {
                "seasonId": item["season_id"],
                "seasonName": item["season_name"],
                "points": decimal_string(item["points"]),
            }
            for item in totals
        ],
        "achievements": [
            {
                "id": item["id"],
                "title": item["title"],
                "description": item["description"],
                "type": item["achievement_type"],
                "status": item["status"],
                "occurredAt": serial(item["occurred_at"]),
                "eventId": item["event_id"],
                "participationId": item["participation_id"],
                "createdAt": serial(item["created_at"]),
            }
            for item in achievements
        ],
        "page": page,
        "pageSize": page_size,
    }


@person_admin.post("/{person_id}/achievements", status_code=201)
def create_achievement(
    person_id: UUID,
    values: AchievementValues,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    if str(values.person_id) != str(person_id):
        raise ApiError(400, "PERSON_MISMATCH", "Person does not match route")
    identity = str(uuid4())
    data = values.model_dump()
    with db.transaction() as connection:
        require_person_in_tenant(connection, str(person_id), staff.tenant_id, lock=True)
        if values.participation_id:
            participation = row(
                connection,
                "SELECT person_id,event_id FROM participations WHERE id=:id",
                {"id": str(values.participation_id)},
            )
            if not participation:
                raise ApiError(
                    400,
                    "ACHIEVEMENT_REFERENCE_MISMATCH",
                    "The referenced participation is unavailable",
                )
            if participation["person_id"] != str(person_id) or (
                values.event_id and participation["event_id"] != str(values.event_id)
            ):
                raise ApiError(
                    400,
                    "ACHIEVEMENT_REFERENCE_MISMATCH",
                    "Achievement references do not describe the same activity",
                )
        elif values.event_id:
            if not row(
                connection,
                """SELECT e.id FROM events e JOIN organizations o ON o.id=e.organization_id
                WHERE e.id=:id AND o.tenant_id=:tenant AND e.organization_id=:organization""",
                {
                    "id": str(values.event_id),
                    "tenant": staff.tenant_id,
                    "organization": staff.organization_id,
                },
            ):
                raise ApiError(
                    400,
                    "ACHIEVEMENT_REFERENCE_MISMATCH",
                    "The referenced Event is unavailable",
                )
        if values.level_id:
            reference(connection, "event_levels", str(values.level_id))
        if values.result_id:
            reference(connection, "participation_results", str(values.result_id))
        execute(
            connection,
            """INSERT INTO achievements
            (id,person_id,event_id,participation_id,title,description,achievement_type,level_id,
             result_id,source,status,occurred_at,created_at,updated_at)
            VALUES (:id,:person_id,:event_id,:participation_id,:title,:description,:achievement_type,
                    :level_id,:result_id,:source,'PENDING',:occurred_at,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                **data,
                "id": identity,
                "person_id": str(data["person_id"]),
                "event_id": str(data["event_id"]) if data["event_id"] else None,
                "participation_id": str(data["participation_id"])
                if data["participation_id"]
                else None,
                "level_id": str(data["level_id"]) if data["level_id"] else None,
                "result_id": str(data["result_id"]) if data["result_id"] else None,
                "occurred_at": naive_utc(data["occurred_at"]),
            },
        )
        audit(connection, staff.id, "ACHIEVEMENT_CREATED", "Achievement", identity)
    return {"id": identity, "status": "PENDING"}


@person_admin.patch("/{person_id}/achievements/{achievement_id}")
def decide_achievement(
    person_id: UUID,
    achievement_id: UUID,
    values: AchievementDecision,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.transaction() as connection:
        # Previously looked up by id+person_id alone with no Tenant check at
        # all; Person is Tenant-canonical (see MOSACTIVE-STAGE1.md), so this
        # is the correct and complete boundary for this route.
        require_person_in_tenant(connection, str(person_id), staff.tenant_id, lock=True)
        existing = row(
            connection,
            "SELECT * FROM achievements WHERE id=:id AND person_id=:person FOR UPDATE",
            {"id": str(achievement_id), "person": str(person_id)},
        )
        if not existing:
            raise ApiError(404, "ACHIEVEMENT_NOT_FOUND", "Achievement not found")
        execute(
            connection,
            """UPDATE achievements SET status=:status,
            verified_at=CASE WHEN :status='VERIFIED' THEN UTC_TIMESTAMP(3) ELSE NULL END,
            verified_by=CASE WHEN :status='VERIFIED' THEN :actor ELSE NULL END,
            updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {"id": str(achievement_id), "status": values.status, "actor": staff.id},
        )
        audit(
            connection,
            staff.id,
            "ACHIEVEMENT_VERIFIED"
            if values.status == "VERIFIED"
            else "ACHIEVEMENT_UPDATED",
            "Achievement",
            str(achievement_id),
            {"status": values.status, "reason": values.reason},
        )
        if values.status == "VERIFIED":
            outbox(
                connection,
                "achievement.verified",
                "Achievement",
                str(achievement_id),
                {"achievementId": str(achievement_id)},
            )
    return {"id": str(achievement_id), "status": values.status}


def public_profile_row(
    connection: Connection, slug: str
) -> tuple[RowMapping, set[str]]:
    item = row(
        connection,
        """SELECT sp.*,p.last_name,p.first_name,p.middle_name,p.study_group,p.organization,
        pc.allowed_fields FROM student_profiles sp JOIN persons p ON p.id=sp.person_id
        JOIN profile_publication_consents pc ON pc.person_id=sp.person_id AND pc.withdrawn_at IS NULL
        WHERE sp.public_slug=:slug AND sp.visibility IN ('LINK_ONLY','PUBLIC')
        ORDER BY pc.accepted_at DESC LIMIT 1""",
        {"slug": slug},
    )
    if not item:
        raise ApiError(404, "PROFILE_NOT_FOUND", "Profile not found")
    allowed = json_value(item["allowed_fields"])
    return item, set(allowed if isinstance(allowed, list) else [])


@public.get("/profiles/{slug}")
def public_profile(
    slug: str,
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        item, allowed = public_profile_row(connection, slug)
        total = row(
            connection,
            "SELECT COALESCE(SUM(points),0) AS points FROM score_transactions WHERE person_id=:person",
            {"person": item["person_id"]},
        )
        participation_count = row(
            connection,
            "SELECT COUNT(*) AS total FROM participations WHERE person_id=:person AND status='CONFIRMED'",
            {"person": item["person_id"]},
        )
    response: dict[str, Any] = {"publicSlug": item["public_slug"]}
    if "NAME" in allowed:
        response["displayName"] = " ".join(
            part
            for part in (item["last_name"], item["first_name"], item["middle_name"])
            if part
        )
    if "STUDY_GROUP" in allowed:
        response["studyGroup"] = item["study_group"]
    if "ORGANIZATION" in allowed:
        response["organization"] = item["organization"]
    if "SCORES" in allowed:
        response["totalPoints"] = decimal_string(total["points"] if total else 0)
    if "PARTICIPATIONS" in allowed:
        response["confirmedParticipations"] = int(
            participation_count["total"] if participation_count else 0
        )
    return response


@public.get("/profiles/{slug}/participations")
def public_participations(
    slug: str,
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    with db.connect() as connection:
        profile, allowed = public_profile_row(connection, slug)
        if "PARTICIPATIONS" not in allowed:
            raise ApiError(
                404, "PROFILE_SECTION_NOT_FOUND", "Profile section not found"
            )
        items = rows(
            connection,
            """SELECT e.title,e.start_at,pr.name AS role_name,pres.name AS result_name,
            COALESCE((SELECT SUM(points) FROM score_transactions st WHERE st.participation_id=p.id),0) AS points
            FROM participations p JOIN events e ON e.id=p.event_id
            LEFT JOIN participation_roles pr ON pr.id=p.role_id
            LEFT JOIN participation_results pres ON pres.id=p.result_id
            WHERE p.person_id=:person AND p.status='CONFIRMED'
            ORDER BY e.start_at DESC,p.id DESC LIMIT :limit OFFSET :offset""",
            {
                "person": profile["person_id"],
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
    return {
        "items": [
            {
                "eventTitle": item["title"],
                "eventStartAt": serial(item["start_at"]),
                "role": item["role_name"],
                "result": item["result_name"],
                "points": decimal_string(item["points"] or 0)
                if "SCORES" in allowed
                else None,
            }
            for item in items
        ],
        "page": page,
        "pageSize": page_size,
    }


@public.get("/profiles/{slug}/achievements")
def public_achievements(
    slug: str,
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    with db.connect() as connection:
        profile, allowed = public_profile_row(connection, slug)
        if "ACHIEVEMENTS" not in allowed:
            raise ApiError(
                404, "PROFILE_SECTION_NOT_FOUND", "Profile section not found"
            )
        items = rows(
            connection,
            """SELECT title,description,achievement_type,occurred_at FROM achievements
            WHERE person_id=:person AND status='VERIFIED'
            ORDER BY occurred_at DESC,id DESC LIMIT :limit OFFSET :offset""",
            {
                "person": profile["person_id"],
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
    return {
        "items": [
            {
                "title": item["title"],
                "description": item["description"],
                "type": item["achievement_type"],
                "occurredAt": serial(item["occurred_at"]),
            }
            for item in items
        ],
        "page": page,
        "pageSize": page_size,
    }


@public.get("/profiles/{slug}/score-summary")
def public_score_summary(
    slug: str,
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        profile, allowed = public_profile_row(connection, slug)
        if "SCORES" not in allowed:
            raise ApiError(
                404, "PROFILE_SECTION_NOT_FOUND", "Profile section not found"
            )
        items = rows(
            connection,
            """SELECT se.code,se.name,COALESCE(SUM(st.points),0) AS points
            FROM seasons se LEFT JOIN score_transactions st ON st.season_id=se.id AND st.person_id=:person
            GROUP BY se.id,se.code,se.name,se.starts_at HAVING points<>0 ORDER BY se.starts_at DESC""",
            {"person": profile["person_id"]},
        )
    return {
        "items": [
            {
                "seasonCode": x["code"],
                "seasonName": x["name"],
                "points": decimal_string(x["points"]),
            }
            for x in items
        ]
    }


@public.get("/profiles/{slug}/score-transactions")
def public_score_transactions(
    slug: str,
    db: Annotated[Database, Depends(database)],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    with db.connect() as connection:
        profile, allowed = public_profile_row(connection, slug)
        if "SCORES" not in allowed:
            raise ApiError(
                404, "PROFILE_SECTION_NOT_FOUND", "Profile section not found"
            )
        items = rows(
            connection,
            """SELECT se.name AS season_name,st.transaction_type,st.points,st.created_at
            FROM score_transactions st JOIN seasons se ON se.id=st.season_id
            WHERE st.person_id=:person ORDER BY st.created_at DESC,st.id DESC
            LIMIT :limit OFFSET :offset""",
            {
                "person": profile["person_id"],
                "limit": page_size,
                "offset": (page - 1) * page_size,
            },
        )
    return {
        "items": [
            {
                "seasonName": item["season_name"],
                "type": item["transaction_type"],
                "points": item["points"],
                "createdAt": serial(item["created_at"]),
            }
            for item in items
        ],
        "page": page,
        "pageSize": page_size,
    }


@public.get("/leaderboard")
def leaderboard(
    db: Annotated[Database, Depends(database)],
    season_id: Annotated[UUID, Query(alias="seasonId")],
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
) -> dict[str, Any]:
    with db.connect() as connection:
        reference(connection, "seasons", str(season_id), active=False)
        items = rows(
            connection,
            """SELECT sp.public_slug,p.last_name,p.first_name,p.middle_name,pc.allowed_fields,
            SUM(st.points) AS points,
            (SELECT COUNT(*) FROM participations pa JOIN events pe ON pe.id=pa.event_id
             WHERE pa.person_id=p.id AND pa.status='CONFIRMED' AND pe.season_id=:season) AS participations,
            (SELECT COUNT(*) FROM achievements a
             LEFT JOIN participations ap ON ap.id=a.participation_id
             LEFT JOIN events ae ON ae.id=COALESCE(a.event_id,ap.event_id)
             WHERE a.person_id=p.id AND a.status='VERIFIED' AND ae.season_id=:season) AS achievements
            FROM score_transactions st JOIN persons p ON p.id=st.person_id
            JOIN student_profiles sp ON sp.person_id=p.id AND sp.visibility='PUBLIC'
            JOIN profile_publication_consents pc ON pc.person_id=p.id AND pc.withdrawn_at IS NULL
            WHERE st.season_id=:season
              AND JSON_CONTAINS(pc.allowed_fields, JSON_QUOTE('NAME'))
              AND JSON_CONTAINS(pc.allowed_fields, JSON_QUOTE('SCORES'))
              AND pc.accepted_at=(SELECT MAX(pc2.accepted_at) FROM profile_publication_consents pc2
                                  WHERE pc2.person_id=p.id AND pc2.withdrawn_at IS NULL)
            GROUP BY p.id,sp.public_slug,p.last_name,p.first_name,p.middle_name,pc.allowed_fields
            HAVING points<>0 ORDER BY points DESC,p.last_name,p.first_name,p.id
            LIMIT :limit OFFSET :offset""",
            {"season": str(season_id), "limit": limit, "offset": offset},
        )
    return {
        "items": [
            {
                "rank": offset + index + 1,
                "publicSlug": item["public_slug"],
                "displayName": " ".join(
                    part
                    for part in (
                        item["last_name"],
                        item["first_name"],
                        item["middle_name"],
                    )
                    if part
                ),
                "points": decimal_string(item["points"]),
                **(
                    {"confirmedParticipations": int(item["participations"])}
                    if "PARTICIPATIONS" in set(json_value(item["allowed_fields"]) or [])
                    else {}
                ),
                **(
                    {"achievements": int(item["achievements"])}
                    if "ACHIEVEMENTS" in set(json_value(item["allowed_fields"]) or [])
                    else {}
                ),
            }
            for index, item in enumerate(items)
        ],
        "limit": limit,
        "offset": offset,
    }


def membership_leaderboard(
    db: Database, season_id: str, dimension: str, limit: int, offset: int
) -> dict[str, Any]:
    if dimension not in {"study_group", "department"}:
        raise RuntimeError("Unsupported membership dimension")
    identity = "sm.study_group_id" if dimension == "study_group" else "sm.department_id"
    join = (
        "JOIN study_groups structure ON structure.id=sm.study_group_id"
        if dimension == "study_group"
        else "JOIN departments structure ON structure.id=sm.department_id"
    )
    with db.connect() as connection:
        reference(connection, "seasons", season_id, active=False)
        items = rows(
            connection,
            f"""SELECT {identity} AS structure_id,structure.name AS label,
            SUM(st.points) AS points,COUNT(DISTINCT st.person_id) AS people
            FROM score_transactions st
            JOIN student_memberships sm ON sm.id=st.membership_id
            {join}
            JOIN student_profiles sp ON sp.person_id=st.person_id AND sp.visibility='PUBLIC'
            JOIN profile_publication_consents pc
              ON pc.person_id=st.person_id AND pc.withdrawn_at IS NULL
            WHERE st.season_id=:season AND {identity} IS NOT NULL
              AND JSON_CONTAINS(pc.allowed_fields,JSON_QUOTE('SCORES'))
            GROUP BY {identity},structure.name
            ORDER BY points DESC,label LIMIT :limit OFFSET :offset""",
            {
                "season": season_id,
                "limit": limit,
                "offset": offset,
            },
        )
    return {
        "items": [
            {
                "rank": offset + index + 1,
                "name": item["label"],
                "points": decimal_string(item["points"]),
                "people": int(item["people"]),
            }
            for index, item in enumerate(items)
        ],
        "limit": limit,
        "offset": offset,
    }


@public.get("/leaderboard/groups")
def group_leaderboard(
    db: Annotated[Database, Depends(database)],
    season_id: Annotated[UUID, Query(alias="seasonId")],
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
) -> dict[str, Any]:
    return membership_leaderboard(db, str(season_id), "study_group", limit, offset)


@public.get("/leaderboard/departments")
def department_leaderboard(
    db: Annotated[Database, Depends(database)],
    season_id: Annotated[UUID, Query(alias="seasonId")],
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
) -> dict[str, Any]:
    return membership_leaderboard(db, str(season_id), "department", limit, offset)
