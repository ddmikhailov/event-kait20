from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError

from .database import execute, row, rows
from .errors import ApiError
from .scoring_v2 import calculate_participation, decimal_string
from .service_utils import audit, serial


def outbox(
    connection: Connection,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: dict[str, Any],
) -> None:
    execute(
        connection,
        """INSERT INTO domain_outbox
        (id,event_type,aggregate_type,aggregate_id,payload,occurred_at,created_at)
        VALUES (:id,:event_type,:aggregate_type,:aggregate_id,:payload,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {
            "id": str(uuid4()),
            "event_type": event_type,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "payload": json.dumps(payload, ensure_ascii=False),
        },
    )


def reference(connection: Connection, table: str, identity: str, active=True) -> Any:
    allowed = {
        "participation_roles",
        "participation_results",
        "event_categories",
        "event_levels",
        "seasons",
    }
    if table not in allowed:
        raise RuntimeError("Unsupported reference table")
    item = row(
        connection,
        f"SELECT * FROM {table} WHERE id=:id" + (" AND active=true" if active else ""),
        {"id": identity},
    )
    if not item:
        raise ApiError(400, "INVALID_REFERENCE", "Referenced value is unavailable")
    return item


def scoped_reference(
    connection: Connection, table: str, identity: str, organization_id: str, active=True
) -> Any:
    """Like reference(), but also enforces the Organization boundary.

    Only for tables that actually carry organization_id (currently: seasons).
    participation_roles/participation_results/event_categories/event_levels are
    tenant-global configuration dictionaries by design (no organization_id
    column exists) and must keep using the unscoped reference() above.
    """
    allowed = {"seasons"}
    if table not in allowed:
        raise RuntimeError("Table is not organization-scoped")
    item = row(
        connection,
        f"SELECT * FROM {table} WHERE id=:id AND organization_id=:organization"
        + (" AND active=true" if active else ""),
        {"id": identity, "organization": organization_id},
    )
    if not item:
        raise ApiError(400, "INVALID_REFERENCE", "Referenced value is unavailable")
    return item


def participation_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["participation_id"],
        "registrationId": item["registration_id"],
        "personId": item["person_id"],
        "eventId": item["event_id"],
        "streamId": item["stream_id"],
        "status": item["participation_status"] or "DRAFT",
        "source": item["participation_source"],
        "role": (
            {
                "id": item["role_id"],
                "code": item["role_code"],
                "name": item["role_name"],
            }
            if item["role_id"]
            else None
        ),
        "result": (
            {
                "id": item["result_id"],
                "code": item["result_code"],
                "name": item["result_name"],
            }
            if item["result_id"]
            else None
        ),
        "scoringState": item["scoring_state"] or "NOT_SCORED",
        "scoringSequence": item["scoring_sequence"],
        "scoreAwarded": decimal_string(item["score_awarded"]),
        "scoreReason": item["score_reason"],
        "confirmedAt": serial(item["confirmed_at"]) if item["confirmed_at"] else None,
        "finalizedAt": serial(item["finalized_at"]) if item["finalized_at"] else None,
        "registration": {
            "lastName": item["last_name"],
            "firstName": item["first_name"],
            "middleName": item["middle_name"],
            "status": item["registration_status"],
            "firstAttendedAt": serial(item["first_attended_at"])
            if item["first_attended_at"]
            else None,
            "studyGroup": item["study_group"],
        },
        "streamTitle": item["stream_title"],
        "eventTitle": item["event_title"],
        "eventStartAt": serial(item["event_start_at"]),
        "seasonId": item["season_id"],
        "seasonName": item["season_name"],
        "directionId": item["direction_id"],
        "directionName": item["direction_name"],
    }


PARTICIPATION_SELECT = """SELECT
    r.id AS registration_id,r.person_id,r.event_id,r.stream_id,r.last_name,r.first_name,
    r.middle_name,r.status AS registration_status,r.first_attended_at,r.study_group,
    s.title AS stream_title,p.id AS participation_id,p.status AS participation_status,
    p.source AS participation_source,p.scoring_state,p.scoring_sequence,p.confirmed_at,p.finalized_at,
    pr.id AS role_id,pr.code AS role_code,pr.name AS role_name,
    pres.id AS result_id,pres.code AS result_code,pres.name AS result_name,
    e.title AS event_title,e.start_at AS event_start_at,
    se.id AS season_id,se.name AS season_name,
    ad.id AS direction_id,ad.name AS direction_name,
    COALESCE((SELECT SUM(st.points) FROM score_transactions st WHERE st.participation_id=p.id),0) AS score_awarded,
    (SELECT st.reason FROM score_transactions st WHERE st.participation_id=p.id
     ORDER BY st.created_at DESC,st.id DESC LIMIT 1) AS score_reason
FROM registrations r
JOIN events e ON e.id=r.event_id
LEFT JOIN seasons se ON se.id=e.season_id
LEFT JOIN activity_directions ad ON ad.id=e.direction_id
LEFT JOIN event_streams s ON s.id=r.stream_id
LEFT JOIN participations p ON p.registration_id=r.id
LEFT JOIN participation_roles pr ON pr.id=p.role_id
LEFT JOIN participation_results pres ON pres.id=p.result_id"""


def get_participation(connection: Connection, participation_id: str) -> dict[str, Any]:
    item = row(
        connection,
        PARTICIPATION_SELECT + " WHERE p.id=:id",
        {"id": participation_id},
    )
    if not item:
        raise ApiError(404, "PARTICIPATION_NOT_FOUND", "Participation not found")
    return participation_response(item)


def find_scoring_rule(connection: Connection, participation: Any) -> Any | None:
    if not participation["season_id"] or not participation["role_id"]:
        return None
    candidates = rows(
        connection,
        """SELECT *,
        ((event_category_id IS NOT NULL)+(event_level_id IS NOT NULL)+
         (participation_role_id IS NOT NULL)+(participation_result_id IS NOT NULL)) AS specificity
        FROM scoring_rules
        WHERE active=true AND season_id=:season
          AND (event_category_id IS NULL OR event_category_id=:category)
          AND (event_level_id IS NULL OR event_level_id=:level)
          AND (participation_role_id IS NULL OR participation_role_id=:role)
          AND (participation_result_id IS NULL OR participation_result_id=:result)
          AND (valid_from IS NULL OR valid_from<=:effective_at)
          AND (valid_to IS NULL OR valid_to>:effective_at)
        ORDER BY priority DESC,specificity DESC,created_at DESC,id DESC""",
        {
            "season": participation["season_id"],
            "category": participation["category_id"],
            "level": participation["level_id"],
            "role": participation["role_id"],
            "result": participation["result_id"],
            "effective_at": participation["event_start_at"],
        },
    )
    if len(candidates) > 1 and (
        candidates[0]["priority"],
        candidates[0]["specificity"],
    ) == (candidates[1]["priority"], candidates[1]["specificity"]):
        raise ApiError(
            409,
            "SCORING_RULE_AMBIGUOUS",
            "Several equally specific scoring rules match this participation",
        )
    return candidates[0] if candidates else None


def membership_for_activity(
    connection: Connection, participation: Any, actor_id: str
) -> str | None:
    event_start = participation["event_start_at"]
    if event_start.tzinfo is None:
        event_start = event_start.replace(tzinfo=UTC)
    activity_local_date = event_start.astimezone(ZoneInfo("Europe/Moscow")).date()
    matches = rows(
        connection,
        """SELECT id FROM student_memberships
        WHERE person_id=:person AND organization_id=:organization
          AND valid_from<=:activity_date
          AND (valid_to IS NULL OR valid_to>=:activity_date)
        ORDER BY valid_from DESC,id FOR UPDATE""",
        {
            "person": participation["person_id"],
            "organization": participation["organization_id"],
            "activity_date": activity_local_date,
        },
    )
    if len(matches) == 1:
        return str(matches[0]["id"])
    if len(matches) > 1:
        audit(
            connection,
            actor_id,
            "SCORE_MEMBERSHIP_AMBIGUOUS",
            "Participation",
            participation["id"],
            {
                "effectiveAt": serial(participation["event_start_at"]),
                "membershipCount": len(matches),
            },
        )
    return None


def award_score(
    connection: Connection, participation_id: str, actor_id: str
) -> str | None:
    participation = row(
        connection,
        """SELECT p.*,e.organization_id,e.season_id,e.category_id,e.level_id,
        e.start_at AS event_start_at,s.scoring_policy_id,s.scoring_policy_effective_from,
        pr.code AS role_code,pr.name AS role_name,el.code AS level_code,el.name AS level_name,
        pres.code AS result_code,pres.name AS result_name
        FROM participations p JOIN events e ON e.id=p.event_id
        LEFT JOIN seasons s ON s.id=e.season_id
        LEFT JOIN participation_roles pr ON pr.id=p.role_id
        LEFT JOIN event_levels el ON el.id=e.level_id
        LEFT JOIN participation_results pres ON pres.id=p.result_id
        WHERE p.id=:id FOR UPDATE""",
        {"id": participation_id},
    )
    if not participation or participation["status"] != "CONFIRMED":
        raise ApiError(
            409, "PARTICIPATION_NOT_CONFIRMED", "Participation is not confirmed"
        )
    if participation["season_id"]:
        row(
            connection,
            "SELECT id FROM seasons WHERE id=:season FOR UPDATE",
            {"season": participation["season_id"]},
        )
    use_v2 = bool(
        participation["scoring_policy_id"]
        and participation["scoring_policy_effective_from"]
        and participation["event_start_at"]
        >= participation["scoring_policy_effective_from"]
    )
    if use_v2:
        try:
            points, snapshot, policy_version_id = calculate_participation(
                connection, participation, persist_sequence=True
            )
        except ApiError as error:
            if error.code not in {
                "SCORING_COMPONENT_MISSING",
                "SCORING_POLICY_VERSION_NOT_FOUND",
            }:
                raise
            execute(
                connection,
                "UPDATE participations SET scoring_state='NO_RULE',updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
                {"id": participation_id},
            )
            audit(connection, actor_id, error.code, "Participation", participation_id)
            return None
        identity = str(uuid4())
        membership_id = membership_for_activity(connection, participation, actor_id)
        idempotency = (
            f"participation:{participation_id}:award:{participation['scoring_cycle']}"
        )
        try:
            execute(
                connection,
                """INSERT INTO score_transactions
                (id,person_id,season_id,membership_id,participation_id,scoring_policy_version_id,
                 scoring_engine_version,transaction_type,points,reason,source,scoring_cycle,
                 calculation_snapshot,idempotency_key,created_at,created_by)
                VALUES (:id,:person,:season,:membership,:participation,:version,'V2','AWARD',:points,
                        :reason,'SCORING_ENGINE',:cycle,:snapshot,:idempotency,UTC_TIMESTAMP(3),:actor)""",
                {
                    "id": identity,
                    "person": participation["person_id"],
                    "season": participation["season_id"],
                    "membership": membership_id,
                    "participation": participation_id,
                    "version": policy_version_id,
                    "points": points,
                    "reason": f"MosActive v2: {decimal_string(points)} баллов.",
                    "cycle": participation["scoring_cycle"],
                    "snapshot": json.dumps(snapshot, ensure_ascii=False),
                    "idempotency": idempotency,
                    "actor": actor_id,
                },
            )
        except IntegrityError:
            existing = row(
                connection,
                "SELECT id FROM score_transactions WHERE idempotency_key=:key",
                {"key": idempotency},
            )
            if not existing:
                raise
            identity = existing["id"]
        execute(
            connection,
            "UPDATE participations SET scoring_state='AWARDED',updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": participation_id},
        )
        audit(
            connection,
            actor_id,
            "SCORE_AWARDED",
            "ScoreTransaction",
            identity,
            {
                "participationId": participation_id,
                "points": decimal_string(points),
                "engine": "V2",
            },
        )
        outbox(
            connection,
            "score.awarded",
            "Participation",
            participation_id,
            {"participationId": participation_id, "scoreTransactionId": identity},
        )
        return identity

    rule = find_scoring_rule(connection, participation)
    if not rule:
        execute(
            connection,
            "UPDATE participations SET scoring_state='NO_RULE',updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": participation_id},
        )
        return None
    identity = str(uuid4())
    membership_id = membership_for_activity(connection, participation, actor_id)
    idempotency = (
        f"participation:{participation_id}:award:{participation['scoring_cycle']}"
    )
    try:
        execute(
            connection,
            """INSERT INTO score_transactions
            (id,person_id,season_id,membership_id,participation_id,scoring_rule_id,scoring_engine_version,transaction_type,points,
             reason,source,scoring_cycle,rule_version_snapshot,idempotency_key,created_at,created_by)
            VALUES (:id,:person,:season,:membership,:participation,:rule,'V1','AWARD',:points,
                    :reason,'SCORING_ENGINE',:cycle,:version,:idempotency,UTC_TIMESTAMP(3),:actor)""",
            {
                "id": identity,
                "person": participation["person_id"],
                "season": participation["season_id"],
                "membership": membership_id,
                "participation": participation_id,
                "rule": rule["id"],
                "points": rule["points"],
                "reason": (
                    "Автоматическое начисление по правилу: "
                    f"{int(rule['points'])} баллов (версия {int(rule['version'])})."
                ),
                "cycle": participation["scoring_cycle"],
                "version": rule["version"],
                "idempotency": idempotency,
                "actor": actor_id,
            },
        )
    except IntegrityError:
        existing = row(
            connection,
            "SELECT id FROM score_transactions WHERE idempotency_key=:key",
            {"key": idempotency},
        )
        if not existing:
            raise
        identity = existing["id"]
    execute(
        connection,
        "UPDATE participations SET scoring_state='AWARDED',updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
        {"id": participation_id},
    )
    audit(
        connection,
        actor_id,
        "SCORE_AWARDED",
        "ScoreTransaction",
        identity,
        {
            "participationId": participation_id,
            "points": decimal_string(rule["points"]),
            "engine": "V1",
        },
    )
    outbox(
        connection,
        "score.awarded",
        "Participation",
        participation_id,
        {"participationId": participation_id, "scoreTransactionId": identity},
    )
    return identity


def reverse_current_award(
    connection: Connection, participation: Any, actor_id: str, reason: str
) -> str | None:
    award = row(
        connection,
        """SELECT * FROM score_transactions
        WHERE participation_id=:participation AND transaction_type='AWARD'
          AND scoring_cycle=:cycle ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
        {
            "participation": participation["id"],
            "cycle": participation["scoring_cycle"],
        },
    )
    if not award:
        return None
    existing = row(
        connection,
        "SELECT id FROM score_transactions WHERE original_transaction_id=:original",
        {"original": award["id"]},
    )
    if existing:
        return existing["id"]
    identity = str(uuid4())
    original_snapshot = award["calculation_snapshot"]
    if isinstance(original_snapshot, str):
        original_snapshot = json.loads(original_snapshot)
    reversal_snapshot = (
        json.dumps(
            {
                "snapshotSchemaVersion": 1,
                "engineVersion": award["scoring_engine_version"],
                "transactionType": "REVERSAL",
                "originalTransactionId": award["id"],
                "originalFinalPoints": decimal_string(award["points"]),
                "reversalPoints": decimal_string(-Decimal(str(award["points"]))),
                "originalCalculation": original_snapshot,
                "calculatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            },
            ensure_ascii=False,
        )
        if original_snapshot
        else None
    )
    execute(
        connection,
        """INSERT INTO score_transactions
        (id,person_id,season_id,membership_id,participation_id,scoring_rule_id,scoring_policy_version_id,
         scoring_engine_version,transaction_type,points,reason,source,scoring_cycle,rule_version_snapshot,
         calculation_snapshot,original_transaction_id,idempotency_key,
         created_at,created_by)
        VALUES (:id,:person,:season,:membership,:participation,:rule,:policy_version,:engine,'REVERSAL',:points,:reason,
                'SCORING_ENGINE',:cycle,:version,:snapshot,:original,:idempotency,UTC_TIMESTAMP(3),:actor)""",
        {
            "id": identity,
            "person": award["person_id"],
            "season": award["season_id"],
            "membership": award["membership_id"],
            "participation": participation["id"],
            "rule": award["scoring_rule_id"],
            "points": -Decimal(str(award["points"])),
            "reason": reason,
            "cycle": award["scoring_cycle"],
            "version": award["rule_version_snapshot"],
            "policy_version": award["scoring_policy_version_id"],
            "engine": award["scoring_engine_version"],
            "snapshot": reversal_snapshot,
            "original": award["id"],
            "idempotency": f"score:{award['id']}:reversal",
            "actor": actor_id,
        },
    )
    audit(
        connection,
        actor_id,
        "SCORE_REVERSED",
        "ScoreTransaction",
        identity,
        {"participationId": participation["id"], "originalTransactionId": award["id"]},
    )
    outbox(
        connection,
        "score.reversed",
        "Participation",
        participation["id"],
        {"participationId": participation["id"], "scoreTransactionId": identity},
    )
    return identity


def confirm_registration(
    connection: Connection,
    event_id: str,
    registration_id: str,
    actor_id: str,
    role_id: str | None,
    result_id: str | None,
    source: str,
    allow_without_attendance: bool,
    override_reason: str | None,
) -> str:
    registration = row(
        connection,
        """SELECT r.*,e.season_id,e.category_id,e.level_id
        FROM registrations r JOIN events e ON e.id=r.event_id
        WHERE r.id=:registration AND r.event_id=:event FOR UPDATE""",
        {"registration": registration_id, "event": event_id},
    )
    if not registration or registration["status"] != "ACTIVE":
        raise ApiError(404, "REGISTRATION_NOT_FOUND", "Active registration not found")
    if not registration["first_attended_at"] and not allow_without_attendance:
        raise ApiError(
            409,
            "ATTENDANCE_REQUIRED",
            "Participation without Attendance requires explicit confirmation",
        )
    existing = row(
        connection,
        "SELECT * FROM participations WHERE registration_id=:registration FOR UPDATE",
        {"registration": registration_id},
    )
    resolved_role = role_id or (existing["role_id"] if existing else None)
    resolved_result = (
        result_id
        if result_id is not None
        else (existing["result_id"] if existing else None)
    )
    if not resolved_role:
        raise ApiError(
            400, "PARTICIPATION_ROLE_REQUIRED", "Participation role is required"
        )
    reference(connection, "participation_roles", resolved_role)
    if resolved_result:
        reference(connection, "participation_results", resolved_result)
    if existing and existing["status"] == "CONFIRMED":
        return existing["id"]
    identity = existing["id"] if existing else str(uuid4())
    cycle = int(existing["scoring_cycle"] if existing else 0) + 1
    if existing:
        execute(
            connection,
            """UPDATE participations SET role_id=:role,result_id=:result,status='CONFIRMED',source=:source,
            scoring_state='NOT_SCORED',scoring_cycle=:cycle,confirmed_at=UTC_TIMESTAMP(3),confirmed_by=:actor,
            finalized_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {
                "id": identity,
                "role": resolved_role,
                "result": resolved_result,
                "source": source,
                "cycle": cycle,
                "actor": actor_id,
            },
        )
    else:
        execute(
            connection,
            """INSERT INTO participations
            (id,person_id,event_id,registration_id,stream_id,role_id,result_id,status,source,
             scoring_state,scoring_cycle,confirmed_at,confirmed_by,finalized_at,created_at,updated_at)
            VALUES (:id,:person,:event,:registration,:stream,:role,:result,'CONFIRMED',:source,
                    'NOT_SCORED',:cycle,UTC_TIMESTAMP(3),:actor,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": identity,
                "person": registration["person_id"],
                "event": event_id,
                "registration": registration_id,
                "stream": registration["stream_id"],
                "role": resolved_role,
                "result": resolved_result,
                "source": source,
                "cycle": cycle,
                "actor": actor_id,
            },
        )
    metadata: dict[str, Any] = {
        "registrationId": registration_id,
        "roleId": resolved_role,
        "resultId": resolved_result,
        "attendancePresent": bool(registration["first_attended_at"]),
    }
    if not registration["first_attended_at"]:
        metadata["overrideReason"] = override_reason
    audit(
        connection,
        actor_id,
        "PARTICIPATION_CONFIRMED",
        "Participation",
        identity,
        metadata,
    )
    outbox(
        connection,
        "participation.confirmed",
        "Participation",
        identity,
        {
            "participationId": identity,
            "personId": registration["person_id"],
            "eventId": event_id,
        },
    )
    award_score(connection, identity, actor_id)
    return identity


def cancel_participation(
    connection: Connection, participation_id: str, actor_id: str, reason: str
) -> None:
    participation = row(
        connection,
        "SELECT * FROM participations WHERE id=:id FOR UPDATE",
        {"id": participation_id},
    )
    if not participation:
        raise ApiError(404, "PARTICIPATION_NOT_FOUND", "Participation not found")
    if participation["status"] == "CANCELLED":
        return
    if participation["status"] == "CONFIRMED":
        reverse_current_award(
            connection, participation, actor_id, "Participation cancelled"
        )
    execute(
        connection,
        """UPDATE participations SET status='CANCELLED',scoring_state=CASE
        WHEN scoring_state='AWARDED' THEN 'REVERSED' ELSE scoring_state END,
        finalized_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
        {"id": participation_id},
    )
    audit(
        connection,
        actor_id,
        "PARTICIPATION_CANCELLED",
        "Participation",
        participation_id,
        {"reason": reason},
    )
    outbox(
        connection,
        "participation.cancelled",
        "Participation",
        participation_id,
        {"participationId": participation_id},
    )


def update_participation(
    connection: Connection,
    participation_id: str,
    actor_id: str,
    role_id: str | None,
    result_id: str | None,
    fields: set[str],
    reason: str,
) -> None:
    participation = row(
        connection,
        "SELECT * FROM participations WHERE id=:id FOR UPDATE",
        {"id": participation_id},
    )
    if not participation:
        raise ApiError(404, "PARTICIPATION_NOT_FOUND", "Participation not found")
    new_role = role_id if "role_id" in fields else participation["role_id"]
    new_result = result_id if "result_id" in fields else participation["result_id"]
    if not new_role:
        raise ApiError(
            400, "PARTICIPATION_ROLE_REQUIRED", "Participation role is required"
        )
    reference(connection, "participation_roles", new_role)
    if new_result:
        reference(connection, "participation_results", new_result)
    changed = (
        new_role != participation["role_id"] or new_result != participation["result_id"]
    )
    if not changed:
        return
    if participation["status"] == "CONFIRMED":
        reverse_current_award(
            connection, participation, actor_id, "Participation classification changed"
        )
    execute(
        connection,
        """UPDATE participations SET role_id=:role,result_id=:result,
        scoring_state=CASE WHEN status='CONFIRMED' THEN 'NOT_SCORED' ELSE scoring_state END,
        scoring_cycle=CASE WHEN status='CONFIRMED' THEN scoring_cycle+1 ELSE scoring_cycle END,
        updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
        {"id": participation_id, "role": new_role, "result": new_result},
    )
    audit(
        connection,
        actor_id,
        "PARTICIPATION_UPDATED",
        "Participation",
        participation_id,
        {
            "before": {
                "roleId": participation["role_id"],
                "resultId": participation["result_id"],
            },
            "after": {"roleId": new_role, "resultId": new_result},
            "reason": reason,
        },
    )
    outbox(
        connection,
        "participation.updated",
        "Participation",
        participation_id,
        {"participationId": participation_id},
    )
    if participation["status"] == "CONFIRMED":
        award_score(connection, participation_id, actor_id)
