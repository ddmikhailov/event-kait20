"""Explicit, transactional reconciliation of two student identities."""

from typing import Any

from sqlalchemy.engine import Connection, RowMapping

from .database import execute, row, rows
from .errors import ApiError
from .service_utils import audit

_HISTORY_TABLES = (
    "registrations",
    "participations",
    "achievements",
    "score_transactions",
    "student_memberships",
    "person_status_assignments",
)


def merge_people(
    connection: Connection,
    target_id: str,
    source_id: str,
    tenant_id: str,
    *,
    lock: bool,
) -> tuple[RowMapping, RowMapping]:
    if target_id == source_id:
        raise ApiError(400, "PERSON_MERGE_SELF", "Choose two different people")
    # The same order for both directions prevents two administrators deadlocking.
    ordered = sorted((target_id, source_id))
    found = rows(
        connection,
        f"""SELECT * FROM persons WHERE id IN (:first,:second)
        AND tenant_id=:tenant AND merged_into_id IS NULL
        ORDER BY id{" FOR UPDATE" if lock else ""}""",
        {"first": ordered[0], "second": ordered[1], "tenant": tenant_id},
    )
    by_id = {person["id"]: person for person in found}
    if target_id not in by_id or source_id not in by_id:
        raise ApiError(404, "PERSON_NOT_FOUND", "Person not found")
    target, source = by_id[target_id], by_id[source_id]
    if (
        target["person_type"] != "KAIT_STUDENT"
        or source["person_type"] != "KAIT_STUDENT"
    ):
        raise ApiError(
            409, "PERSON_MERGE_STUDENT_ONLY", "Only student records can be merged"
        )
    return target, source


def merge_conflicts(
    connection: Connection, target_id: str, source_id: str
) -> list[dict[str, Any]]:
    params = {"target": target_id, "source": source_id}
    conflicts: list[dict[str, Any]] = []
    checks = (
        (
            "ACTIVE_REGISTRATION",
            """SELECT source.event_id AS event_id,NULL AS sequence
            FROM registrations source JOIN registrations target
              ON target.event_id=source.event_id AND target.person_id=:target
              AND target.status='ACTIVE'
            WHERE source.person_id=:source AND source.status='ACTIVE' LIMIT 1""",
        ),
        (
            "CONFIRMED_PARTICIPATION",
            """SELECT source.event_id AS event_id,NULL AS sequence
            FROM participations source JOIN participations target
              ON target.event_id=source.event_id AND target.person_id=:target
              AND target.status='CONFIRMED'
            WHERE source.person_id=:source AND source.status='CONFIRMED' LIMIT 1""",
        ),
        (
            "SCORING_SEQUENCE",
            """SELECT NULL AS event_id,source.scoring_sequence AS sequence
            FROM participations source JOIN participations target
              ON target.scoring_sequence=source.scoring_sequence
              AND target.person_id=:target
            WHERE source.person_id=:source AND source.scoring_sequence IS NOT NULL
            LIMIT 1""",
        ),
        (
            "MEMBERSHIP_OVERLAP",
            """SELECT NULL AS event_id,NULL AS sequence
            FROM student_memberships source JOIN student_memberships target
              ON target.person_id=:target
              AND source.valid_from<=COALESCE(target.valid_to,'9999-12-31')
              AND target.valid_from<=COALESCE(source.valid_to,'9999-12-31')
            WHERE source.person_id=:source LIMIT 1""",
        ),
        (
            "STATUS_OVERLAP",
            """SELECT NULL AS event_id,NULL AS sequence
            FROM person_status_assignments source
            JOIN person_status_assignments target
              ON target.person_id=:target
              AND target.status_type_id=source.status_type_id
              AND source.valid_from<=LEAST(COALESCE(target.valid_to,'9999-12-31'),
                                           COALESCE(target.retired_effective_on,'9999-12-31'))
              AND target.valid_from<=LEAST(COALESCE(source.valid_to,'9999-12-31'),
                                           COALESCE(source.retired_effective_on,'9999-12-31'))
            WHERE source.person_id=:source LIMIT 1""",
        ),
    )
    for code, query in checks:
        conflict = row(connection, query, params)
        if conflict:
            conflicts.append(
                {
                    "code": code,
                    "eventId": conflict["event_id"],
                    "sequence": conflict["sequence"],
                }
            )
    return conflicts


def merge_counts(connection: Connection, person_id: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in _HISTORY_TABLES:
        result = row(
            connection,
            f"SELECT count(*) AS n FROM {table} WHERE person_id=:id",
            {"id": person_id},
        )
        counts[table] = int(result["n"]) if result else 0
    return counts


def apply_person_merge(
    connection: Connection, target_id: str, source_id: str, actor_id: str, reason: str
) -> None:
    params = {"target": target_id, "source": source_id}
    # One-to-one current records remain on the chosen primary. A secondary
    # profile/roster row stays on its merged tombstone when both exist, so no
    # metadata or old public slug is silently discarded.
    for table in ("student_roster_members", "student_profiles"):
        target_has = row(
            connection,
            f"SELECT person_id FROM {table} WHERE person_id=:target FOR UPDATE",
            params,
        )
        if not target_has:
            execute(
                connection,
                f"UPDATE {table} SET person_id=:target WHERE person_id=:source",
                params,
            )
    execute(
        connection,
        "UPDATE registrations SET roster_person_id=:target WHERE roster_person_id=:source",
        params,
    )
    execute(
        connection,
        "UPDATE event_participation_reviews SET roster_person_id=:target WHERE roster_person_id=:source",
        params,
    )
    for table in _HISTORY_TABLES:
        execute(
            connection,
            f"UPDATE {table} SET person_id=:target WHERE person_id=:source",
            params,
        )
    execute(
        connection,
        "UPDATE staff_users SET person_id=:target WHERE person_id=:source",
        params,
    )
    execute(
        connection,
        "UPDATE persons SET merged_into_id=:target WHERE merged_into_id=:source",
        params,
    )
    execute(
        connection,
        """UPDATE persons SET merged_into_id=:target,dedup_review_required=false,
        updated_at=UTC_TIMESTAMP(3) WHERE id=:source""",
        params,
    )
    execute(
        connection,
        """UPDATE persons SET dedup_review_required=false,
        updated_at=UTC_TIMESTAMP(3) WHERE id=:target""",
        params,
    )
    audit(
        connection,
        actor_id,
        "PERSON_MERGED",
        "Person",
        target_id,
        {"sourcePersonId": source_id, "reason": reason},
    )
