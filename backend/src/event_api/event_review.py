"""Review a finished Event before any MosActive score is awarded."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.engine import Connection

from .activity_service import confirm_registration, reference
from .database import Database, execute, row, rows
from .errors import ApiError
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
        """UPDATE events SET activity_review_state='PENDING',updated_at=UTC_TIMESTAMP(3)
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
    cutoff = (now or datetime.now(UTC)).replace(tzinfo=None) - timedelta(hours=24)
    with database.connect() as connection:
        due = rows(
            connection,
            """SELECT id FROM events
            WHERE status IN ('REGISTRATION_OPEN','REGISTRATION_CLOSED','ACTIVE')
              AND activity_review_required=true
              AND activity_review_state='NOT_STARTED' AND end_at<=:cutoff
            ORDER BY end_at,id LIMIT 20""",
            {"cutoff": cutoff},
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
                    AND end_at<=:cutoff FOR UPDATE SKIP LOCKED""",
                    {"id": event["id"], "cutoff": cutoff},
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
        except ApiError:
            logging.getLogger(__name__).exception(
                "Could not prepare Event review %s", event["id"]
            )
    return completed


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
) -> None:
    current = row(
        connection,
        """SELECT review.*,r.person_type FROM event_participation_reviews review
        JOIN registrations r ON r.id=review.registration_id
        WHERE review.event_id=:event AND review.registration_id=:registration FOR UPDATE""",
        {"event": event_id, "registration": registration_id},
    )
    if not current:
        raise ApiError(404, "REVIEW_ITEM_NOT_FOUND", "Review item not found")
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
        {"eventId": event_id, "attendance": attendance_decision, "match": match_state},
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
