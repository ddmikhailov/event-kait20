"""Review a finished Event before any MosActive score is awarded."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.engine import Connection

from .activity_service import (
    cancel_participation,
    confirm_registration,
    reference,
    update_participation,
)
from .database import Database, execute, row, rows
from .errors import ApiError
from .scoring_v2 import calculate_participation, decimal_string
from .service_utils import audit, serial


def prepare_review(
    connection: Connection, event_id: str, actor_id: str | None
) -> dict[str, int]:
    """Snapshot every active registration, preserving earlier staff decisions."""
    default_role = row(
        connection,
        "SELECT id FROM participation_roles WHERE code='PARTICIPANT' AND active=true",
    )
    if not default_role:
        raise ApiError(
            409, "PARTICIPATION_ROLE_REQUIRED", "Participant role is unavailable"
        )
    registrations = rows(
        connection,
        """SELECT r.id,r.first_attended_at,r.roster_match_state,r.roster_person_id,
        p.role_id,p.result_id
        FROM registrations r LEFT JOIN participations p ON p.registration_id=r.id
        WHERE r.event_id=:event AND r.status='ACTIVE' ORDER BY r.id LIMIT 5001""",
        {"event": event_id},
    )
    if len(registrations) > 5000:
        raise ApiError(
            409, "EVENT_COMPLETION_TOO_LARGE", "Review exceeds 5000 registrations"
        )
    for registration in registrations:
        execute(
            connection,
            """INSERT INTO event_participation_reviews
            (registration_id,event_id,attendance_decision,scanner_first_attended_at,
             role_id,result_id,roster_person_id,match_state,created_at,updated_at)
            VALUES (:registration,:event,:attendance,:scanner,:role,:result,:roster,:match,
                    UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE registration_id=registration_id""",
            {
                "registration": registration["id"],
                "event": event_id,
                "attendance": "PRESENT"
                if registration["first_attended_at"]
                else "ABSENT",
                "scanner": registration["first_attended_at"],
                "role": registration["role_id"] or default_role["id"],
                "result": registration["result_id"],
                "roster": registration["roster_person_id"],
                "match": registration["roster_match_state"],
            },
        )
    execute(
        connection,
        """UPDATE events SET activity_review_state='PENDING',review_preparation_error=NULL,
        review_retry_at=NULL,updated_at=UTC_TIMESTAMP(3)
        WHERE id=:event AND activity_review_state='NOT_STARTED'""",
        {"event": event_id},
    )
    audit(
        connection,
        actor_id,
        "EVENT_REVIEW_PREPARED",
        "Event",
        event_id,
        {"registrations": len(registrations)},
    )
    return {
        "registrations": len(registrations),
        "present": sum(bool(item["first_attended_at"]) for item in registrations),
        "absent": sum(not item["first_attended_at"] for item in registrations),
    }


def enqueue_due_reviews(database: Database, now: datetime | None = None) -> int:
    """Move eligible Events to review 24 hours after their scheduled end."""
    clock = now or datetime.now(UTC)
    clock = clock.replace(tzinfo=UTC) if clock.tzinfo is None else clock
    clock = clock.astimezone(UTC).replace(tzinfo=None)
    cutoff = clock - timedelta(hours=24)
    with database.connect() as connection:
        due = rows(
            connection,
            """SELECT id FROM events
            WHERE status IN ('REGISTRATION_OPEN','REGISTRATION_CLOSED','ACTIVE')
              AND activity_review_required=true
              AND activity_review_state='NOT_STARTED' AND end_at<=:cutoff
              AND (review_retry_at IS NULL OR review_retry_at<=:now)
            ORDER BY end_at,id LIMIT 20""",
            {"cutoff": cutoff, "now": clock},
        )
    completed = 0
    for event in due:
        try:
            with database.transaction() as connection:
                eligible = row(
                    connection,
                    """SELECT id FROM events WHERE id=:id
                    AND status IN ('REGISTRATION_OPEN','REGISTRATION_CLOSED','ACTIVE')
                    AND activity_review_required=true AND activity_review_state='NOT_STARTED'
                    AND end_at<=:cutoff AND (review_retry_at IS NULL OR review_retry_at<=:now)
                    FOR UPDATE SKIP LOCKED""",
                    {"id": event["id"], "cutoff": cutoff, "now": clock},
                )
                if not eligible:
                    continue
                execute(
                    connection,
                    """UPDATE events SET status='COMPLETED',updated_at=UTC_TIMESTAMP(3)
                WHERE id=:id""",
                    {"id": event["id"]},
                )
                prepare_review(connection, event["id"], None)
            completed += 1
        except Exception as error:
            code = (
                error.code
                if isinstance(error, ApiError)
                else "REVIEW_PREPARATION_FAILED"
            )
            logging.getLogger(__name__).error(
                "Review preparation failed event_id=%s code=%s", event["id"], code
            )
            with database.transaction() as connection:
                execute(
                    connection,
                    """UPDATE events SET review_preparation_error=:code,review_retry_at=:retry
                    WHERE id=:id AND activity_review_state='NOT_STARTED'""",
                    {
                        "id": event["id"],
                        "code": code,
                        "retry": clock + timedelta(minutes=5),
                    },
                )
    return completed


def review_version(item: Any) -> str:
    """Opaque optimistic-concurrency token, including the latest Scanner mark."""
    fields = (
        "attendance_decision",
        "scanner_first_attended_at",
        "first_attended_at",
        "role_id",
        "result_id",
        "match_state",
        "roster_person_id",
        "decision_reason",
        "reviewed_at",
    )
    return hashlib.sha256(
        json.dumps([item[field] for field in fields], default=str).encode()
    ).hexdigest()


def review_items(connection: Connection, event_id: str) -> list[dict[str, Any]]:
    items = rows(
        connection,
        """SELECT r.id,r.last_name,r.first_name,r.middle_name,r.study_group,r.person_type,
        r.first_attended_at,review.attendance_decision,review.scanner_first_attended_at,
        review.role_id,role.name AS role_name,review.result_id,result.name AS result_name,
        review.match_state,review.roster_person_id,review.decision_reason,review.reviewed_at
        FROM event_participation_reviews review
        JOIN registrations r ON r.id=review.registration_id
        JOIN participation_roles role ON role.id=review.role_id
        LEFT JOIN participation_results result ON result.id=review.result_id
        WHERE review.event_id=:event AND r.status='ACTIVE'
        ORDER BY r.last_name,r.first_name,r.id LIMIT 5000""",
        {"event": event_id},
    )
    return [
        {
            "version": review_version(item),
            "registrationId": item["id"],
            "lastName": item["last_name"],
            "firstName": item["first_name"],
            "middleName": item["middle_name"],
            "studyGroup": item["study_group"],
            "personType": item["person_type"],
            "scannerFirstAttendedAt": serial(item["first_attended_at"])
            if item["first_attended_at"]
            else None,
            "attendanceDecision": item["attendance_decision"],
            "attendanceChangedSinceReview": item["first_attended_at"]
            != item["scanner_first_attended_at"],
            "roleId": item["role_id"],
            "roleName": item["role_name"],
            "resultId": item["result_id"],
            "resultName": item["result_name"],
            "matchState": item["match_state"],
            "rosterPersonId": item["roster_person_id"],
            "decisionReason": item["decision_reason"],
            "reviewedAt": serial(item["reviewed_at"]) if item["reviewed_at"] else None,
        }
        for item in items
    ]


def preview_review_score(
    connection: Connection, event_id: str, registration_id: str, expected_version: str
) -> dict[str, Any]:
    """Calculate a saved review decision without changing participation or ledger."""
    item = row(
        connection,
        """SELECT review.*,r.person_id AS registration_person_id,r.person_type,
        r.first_attended_at,p.id AS participation_id,p.person_id AS participation_person_id,
        p.scoring_sequence,e.start_at AS event_start_at,e.season_id,e.level_id,
        e.boost_multiplier,s.scoring_policy_id,s.scoring_policy_effective_from,
        role.code AS role_code,role.name AS role_name,
        level.code AS level_code,level.name AS level_name,
        result.code AS result_code,result.name AS result_name
        FROM event_participation_reviews review
        JOIN registrations r ON r.id=review.registration_id AND r.status='ACTIVE'
        JOIN events e ON e.id=review.event_id
        LEFT JOIN seasons s ON s.id=e.season_id
        LEFT JOIN participations p ON p.registration_id=r.id
        JOIN participation_roles role ON role.id=review.role_id
        LEFT JOIN event_levels level ON level.id=e.level_id
        LEFT JOIN participation_results result ON result.id=review.result_id
        WHERE review.event_id=:event AND review.registration_id=:registration""",
        {"event": event_id, "registration": registration_id},
    )
    if not item:
        raise ApiError(404, "REVIEW_ITEM_NOT_FOUND", "Review item not found")
    version = review_version(item)
    if version != expected_version:
        raise ApiError(
            409, "REVIEW_ITEM_CHANGED", "Review changed; reload before preview"
        )
    if item["first_attended_at"] != item["scanner_first_attended_at"]:
        raise ApiError(409, "REVIEW_STALE", "Scanner marks changed after review")

    def unavailable(state: str, code: str) -> dict[str, Any]:
        return {
            "version": version,
            "state": state,
            "code": code,
            "points": None,
            "calculation": None,
        }

    if item["attendance_decision"] != "PRESENT":
        return unavailable("NO_SCORE", "ABSENT")
    if item["person_type"] != "KAIT_STUDENT":
        return unavailable("NO_SCORE", "NOT_STUDENT")
    if item["match_state"] == "REJECTED":
        return unavailable("NO_SCORE", "REJECTED")
    if item["match_state"] != "MATCHED" or not item["roster_person_id"]:
        return unavailable("BLOCKED", "ROSTER_MATCH_REQUIRED")
    if (
        item["participation_id"]
        and item["scoring_sequence"] is not None
        and item["participation_person_id"] != item["roster_person_id"]
    ):
        return unavailable("BLOCKED", "REVIEW_IDENTITY_LOCKED")
    if item["registration_person_id"] != item["roster_person_id"]:
        collision = row(
            connection,
            """SELECT id FROM registrations WHERE event_id=:event AND person_id=:person
            AND status='ACTIVE' AND id<>:registration LIMIT 1""",
            {
                "event": event_id,
                "person": item["roster_person_id"],
                "registration": registration_id,
            },
        )
        if collision:
            return unavailable("BLOCKED", "ROSTER_LINK_CONFLICT")
    if not (
        item["season_id"]
        and item["level_id"]
        and item["scoring_policy_id"]
        and item["scoring_policy_effective_from"]
        and item["event_start_at"] >= item["scoring_policy_effective_from"]
    ):
        return unavailable("BLOCKED", "SCORING_SETUP_REQUIRED")
    participation = {
        **item,
        "id": item["participation_id"] or registration_id,
        "person_id": item["roster_person_id"],
        "event_id": event_id,
        "scoring_sequence": item["scoring_sequence"],
        "role_id": item["role_id"],
        "result_id": item["result_id"],
    }
    try:
        points, calculation, _ = calculate_participation(connection, participation)
    except ApiError as error:
        return unavailable("BLOCKED", error.code)
    return {
        "version": version,
        "state": "READY",
        "code": None,
        "points": decimal_string(points),
        "calculation": calculation,
    }


def update_review_item(
    connection: Connection,
    event_id: str,
    registration_id: str,
    actor_id: str,
    attendance_decision: str,
    role_id: str,
    result_id: str | None,
    roster_person_id: str | None,
    reject_match: bool,
    reason: str,
    tenant_id: str,
    expected_version: str,
) -> None:
    current = row(
        connection,
        """SELECT review.*,r.person_type,r.first_attended_at FROM event_participation_reviews review
        JOIN registrations r ON r.id=review.registration_id
        WHERE review.event_id=:event AND review.registration_id=:registration FOR UPDATE""",
        {"event": event_id, "registration": registration_id},
    )
    if not current:
        raise ApiError(404, "REVIEW_ITEM_NOT_FOUND", "Review item not found")
    if review_version(current) != expected_version:
        raise ApiError(
            409, "REVIEW_ITEM_CHANGED", "Review item changed; reload before saving"
        )
    previous_participation = row(
        connection,
        "SELECT person_id,scoring_sequence FROM participations WHERE registration_id=:id",
        {"id": registration_id},
    )
    if (
        roster_person_id
        and previous_participation
        and previous_participation["scoring_sequence"] is not None
        and roster_person_id != previous_participation["person_id"]
    ):
        raise ApiError(
            409,
            "REVIEW_IDENTITY_LOCKED",
            "An allocated participation cannot be transferred to another student",
        )
    reference(connection, "participation_roles", role_id)
    if result_id:
        reference(connection, "participation_results", result_id)
    if reject_match and roster_person_id:
        raise ApiError(400, "VALIDATION_ERROR", "Rejected row cannot link a student")
    if roster_person_id:
        member = row(
            connection,
            """SELECT p.id FROM student_roster_members member
            JOIN persons p ON p.id=member.person_id
            WHERE p.id=:person AND p.tenant_id=:tenant AND p.person_type='KAIT_STUDENT'
              AND p.merged_into_id IS NULL""",
            {"person": roster_person_id, "tenant": tenant_id},
        )
        if not member:
            raise ApiError(404, "ROSTER_PERSON_NOT_FOUND", "Student not in roster")
    match_state = (
        "NOT_APPLICABLE"
        if current["person_type"] != "KAIT_STUDENT"
        else "REJECTED"
        if reject_match
        else "MATCHED"
        if roster_person_id
        else current["match_state"]
    )
    execute(
        connection,
        """UPDATE event_participation_reviews
        SET attendance_decision=:attendance,scanner_first_attended_at=(
              SELECT first_attended_at FROM registrations WHERE id=:registration),
            role_id=:role,result_id=:result,roster_person_id=:roster,
            match_state=:match,decision_reason=:reason,reviewed_by=:actor,
            reviewed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
        WHERE registration_id=:registration AND event_id=:event""",
        {
            "event": event_id,
            "registration": registration_id,
            "attendance": attendance_decision,
            "role": role_id,
            "result": result_id,
            "roster": None if reject_match else roster_person_id,
            "match": match_state,
            "reason": reason,
            "actor": actor_id,
        },
    )
    audit(
        connection,
        actor_id,
        "EVENT_REVIEW_ITEM_UPDATED",
        "Registration",
        registration_id,
        {
            "eventId": event_id,
            "reason": reason,
            "before": {
                key: current[key]
                for key in (
                    "attendance_decision",
                    "role_id",
                    "result_id",
                    "roster_person_id",
                    "match_state",
                    "decision_reason",
                )
            },
            "after": {
                "attendance_decision": attendance_decision,
                "role_id": role_id,
                "result_id": result_id,
                "roster_person_id": None if reject_match else roster_person_id,
                "match_state": match_state,
            },
        },
    )


def approve_review(
    connection: Connection, event_id: str, actor_id: str
) -> dict[str, int]:
    event = row(
        connection,
        """SELECT e.*,s.scoring_policy_id,s.scoring_policy_effective_from
        FROM events e LEFT JOIN seasons s ON s.id=e.season_id
        WHERE e.id=:event FOR UPDATE""",
        {"event": event_id},
    )
    if (
        not event
        or event["status"] != "COMPLETED"
        or event["activity_review_state"] != "PENDING"
    ):
        raise ApiError(409, "REVIEW_NOT_PENDING", "Event review is not pending")
    if event["activity_reviewed_at"]:
        actor = row(
            connection,
            "SELECT system_role FROM staff_users WHERE id=:id",
            {"id": actor_id},
        )
        if not actor or actor["system_role"] != "SUPER_ADMIN":
            raise ApiError(403, "FORBIDDEN", "Only SUPER_ADMIN may approve corrections")
    if not event["level_id"] or not event["season_id"]:
        raise ApiError(409, "SCORING_SETUP_REQUIRED", "Season and level are required")
    if (
        not event["scoring_policy_id"]
        or not event["scoring_policy_effective_from"]
        or event["start_at"] < event["scoring_policy_effective_from"]
    ):
        raise ApiError(409, "SCORING_SETUP_REQUIRED", "Publish and assign a v2 policy")
    items = rows(
        connection,
        """SELECT review.*,r.person_id,r.person_type,r.first_attended_at,r.status
        FROM event_participation_reviews review
        JOIN registrations r ON r.id=review.registration_id
        WHERE review.event_id=:event AND r.status='ACTIVE'
        ORDER BY review.registration_id FOR UPDATE""",
        {"event": event_id},
    )
    active_count = row(
        connection,
        "SELECT COUNT(*) AS total FROM registrations WHERE event_id=:event AND status='ACTIVE'",
        {"event": event_id},
    )
    if len(items) != int(active_count["total"] if active_count else 0):
        raise ApiError(
            409, "REVIEW_STALE", "Review does not include every registration"
        )
    if any(
        item["status"] == "ACTIVE"
        and item["first_attended_at"] != item["scanner_first_attended_at"]
        for item in items
    ):
        raise ApiError(409, "REVIEW_STALE", "Scanner marks changed after review")
    if any(
        item["status"] == "ACTIVE"
        and item["person_type"] == "KAIT_STUDENT"
        and item["match_state"] in ("UNMATCHED", "AMBIGUOUS")
        for item in items
    ):
        raise ApiError(409, "ROSTER_MATCH_REQUIRED", "Resolve unmatched students")
    summary = {"registered": len(items), "present": 0, "absent": 0, "awarded": 0}
    for item in items:
        if item["status"] != "ACTIVE":
            continue
        existing = row(
            connection,
            "SELECT * FROM participations WHERE registration_id=:id FOR UPDATE",
            {"id": item["registration_id"]},
        )
        eligible = (
            item["attendance_decision"] == "PRESENT"
            and item["person_type"] == "KAIT_STUDENT"
            and item["match_state"] != "REJECTED"
        )
        if existing and existing["status"] == "CONFIRMED" and not eligible:
            cancel_participation(
                connection,
                existing["id"],
                actor_id,
                item["decision_reason"] or "Исправление итоговой ведомости",
            )
        if item["attendance_decision"] == "ABSENT":
            summary["absent"] += 1
            continue
        summary["present"] += 1
        if item["person_type"] != "KAIT_STUDENT" or item["match_state"] == "REJECTED":
            continue
        roster_id = item["roster_person_id"]
        if not roster_id:
            raise ApiError(409, "ROSTER_MATCH_REQUIRED", "Student link is missing")
        if item["person_id"] != roster_id:
            if existing and existing["scoring_sequence"] is not None:
                raise ApiError(
                    409,
                    "REVIEW_IDENTITY_LOCKED",
                    "An allocated participation cannot be transferred to another student",
                )
            collision = row(
                connection,
                """SELECT id FROM registrations WHERE event_id=:event AND person_id=:person
                AND status='ACTIVE' AND id<>:registration""",
                {
                    "event": event_id,
                    "person": roster_id,
                    "registration": item["registration_id"],
                },
            )
            if collision:
                raise ApiError(
                    409, "ROSTER_LINK_CONFLICT", "Student has another registration"
                )
            execute(
                connection,
                "UPDATE registrations SET person_id=:person,roster_person_id=:person,roster_match_state='MATCHED' WHERE id=:registration",
                {"person": roster_id, "registration": item["registration_id"]},
            )
            execute(
                connection,
                "UPDATE participations SET person_id=:person WHERE registration_id=:registration AND status='DRAFT'",
                {"person": roster_id, "registration": item["registration_id"]},
            )
        if existing:
            update_participation(
                connection,
                existing["id"],
                actor_id,
                item["role_id"],
                item["result_id"],
                {"role_id", "result_id"},
                item["decision_reason"] or "Подтверждено по итоговой ведомости",
            )
        participation_id = confirm_registration(
            connection,
            event_id,
            item["registration_id"],
            actor_id,
            item["role_id"],
            item["result_id"],
            "ADMIN",
            item["first_attended_at"] is None,
            item["decision_reason"] or "Подтверждено по итоговой ведомости",
        )
        state = row(
            connection,
            "SELECT scoring_state FROM participations WHERE id=:id",
            {"id": participation_id},
        )
        if not state or state["scoring_state"] != "AWARDED":
            raise ApiError(409, "SCORING_SETUP_REQUIRED", "Scoring rule is incomplete")
        summary["awarded"] += 1
    execute(
        connection,
        """UPDATE events SET activity_review_state='APPROVED',activity_reviewed_at=UTC_TIMESTAMP(3),
        activity_reviewed_by=:actor,updated_at=UTC_TIMESTAMP(3) WHERE id=:event""",
        {"event": event_id, "actor": actor_id},
    )
    audit(connection, actor_id, "EVENT_REVIEW_APPROVED", "Event", event_id, summary)
    return summary
