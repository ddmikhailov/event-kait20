"""Roster group choices and staff-only suggestions; fuzzy matches never link people."""

from difflib import SequenceMatcher
from typing import Any

from sqlalchemy.engine import Connection, RowMapping

from .database import row, rows
from .errors import ApiError


def public_study_groups(connection: Connection, organization_id: str) -> list[str]:
    return [
        str(item["study_group"])
        for item in rows(
            connection,
            """SELECT DISTINCT p.study_group FROM persons p
            JOIN student_roster_members m ON m.person_id=p.id
            JOIN organizations o ON o.tenant_id=p.tenant_id
            WHERE o.id=:organization AND p.person_type='KAIT_STUDENT'
              AND p.merged_into_id IS NULL AND p.study_group IS NOT NULL
              AND p.study_group<>'' ORDER BY p.study_group LIMIT 5000""",
            {"organization": organization_id},
        )
    ]


def validate_public_group(
    connection: Connection, tenant_id: str, data: dict[str, Any], missing: bool
) -> None:
    if missing and (data["person_type"] != "KAIT_STUDENT" or data["study_group"]):
        raise ApiError(
            400, "STUDY_GROUP_INVALID", "Choose a group or report it missing"
        )
    if data["person_type"] != "KAIT_STUDENT" or not data["study_group"]:
        return
    group = row(
        connection,
        """SELECT p.study_group FROM persons p
        JOIN student_roster_members m ON m.person_id=p.id
        WHERE p.tenant_id=:tenant AND p.person_type='KAIT_STUDENT'
          AND p.merged_into_id IS NULL AND p.study_group=:group
        ORDER BY p.id LIMIT 1""",
        {"tenant": tenant_id, "group": data["study_group"]},
    )
    if not group:
        raise ApiError(400, "STUDY_GROUP_INVALID", "Choose an existing roster group")
    data["study_group"] = group["study_group"]


def normalized(value: str | None) -> str:
    return " ".join((value or "").split()).casefold().replace("ё", "е")


def roster_suggestions(
    connection: Connection, tenant_id: str, registration: RowMapping
) -> dict[str, Any]:
    if registration["person_type"] != "KAIT_STUDENT":
        return {"items": [], "truncated": False}

    # Bound work for unusually large groups. Without a group, narrow by either
    # name prefix. Staff can always use the existing manual roster search.
    def prefix(value: str) -> str:
        return (
            value[:2].replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
            + "%"
        )

    candidates = rows(
        connection,
        """SELECT p.id,p.last_name,p.first_name,p.middle_name,p.study_group
        FROM persons p JOIN student_roster_members m ON m.person_id=p.id
        WHERE p.tenant_id=:tenant AND p.person_type='KAIT_STUDENT'
          AND p.merged_into_id IS NULL
          AND ((:group IS NOT NULL AND p.study_group=:group)
            OR (:group IS NULL AND (p.last_name LIKE :last OR p.first_name LIKE :first)))
        ORDER BY p.last_name,p.first_name,p.id LIMIT 1001""",
        {
            "tenant": tenant_id,
            "group": registration["study_group"],
            "last": prefix(registration["last_name"]),
            "first": prefix(registration["first_name"]),
        },
    )
    scored = []
    name_fields = ("last_name", "first_name", "middle_name")
    aliases = ("lastName", "firstName", "middleName", "studyGroup")
    for candidate in candidates[:1000]:
        similarities = [
            SequenceMatcher(
                None, normalized(registration[field]), normalized(candidate[field])
            ).ratio()
            for field in name_fields
        ]
        # Missing patronymics must not inflate an otherwise weak proposal.
        comparable = similarities[:2]
        if registration["middle_name"] and candidate["middle_name"]:
            comparable.append(similarities[2])
        score = sum(comparable) / len(comparable)
        if min(similarities[:2]) < 0.6 or score < 0.78:
            continue
        differing = [
            alias
            for field, alias in zip((*name_fields, "study_group"), aliases, strict=True)
            if normalized(registration[field]) != normalized(candidate[field])
        ]
        scored.append(
            (
                score,
                {
                    "id": candidate["id"],
                    **{
                        alias: candidate[field]
                        for field, alias in zip(
                            (*name_fields, "study_group"), aliases, strict=True
                        )
                    },
                    "differingFields": differing,
                },
            )
        )
    scored.sort(key=lambda item: (-item[0], item[1]["id"]))
    return {
        "items": [item[1] for item in scored[:5]],
        "truncated": len(candidates) > 1000,
    }
