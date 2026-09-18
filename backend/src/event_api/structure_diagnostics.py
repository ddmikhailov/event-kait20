from typing import TypedDict

from sqlalchemy.engine import Connection

from .database import row


class StructureDiagnostics(TypedDict):
    membership_total: int
    normalized_memberships: int
    memberships_without_department: int
    memberships_without_study_group: int
    memberships_without_course: int
    normalized_study_groups: int
    person_legacy_group_values: int
    registration_legacy_group_values: int
    unmatched_person_group_values: int
    unmatched_registration_group_values: int


def structure_diagnostics(
    connection: Connection, tenant_id: str, organization_id: str
) -> StructureDiagnostics:
    """Return non-PII reconciliation counts for one trusted organization scope."""
    item = row(
        connection,
        """SELECT
        (SELECT COUNT(*) FROM student_memberships sm
         WHERE sm.organization_id=:organization) AS membership_total,
        (SELECT COUNT(*) FROM student_memberships sm
         WHERE sm.organization_id=:organization
           AND sm.department_id IS NOT NULL AND sm.study_group_id IS NOT NULL)
            AS normalized_memberships,
        (SELECT COUNT(*) FROM student_memberships sm
         WHERE sm.organization_id=:organization AND sm.department_id IS NULL)
            AS memberships_without_department,
        (SELECT COUNT(*) FROM student_memberships sm
         WHERE sm.organization_id=:organization AND sm.study_group_id IS NULL)
            AS memberships_without_study_group,
        (SELECT COUNT(*) FROM student_memberships sm
         WHERE sm.organization_id=:organization AND sm.course IS NULL)
            AS memberships_without_course,
        (SELECT COUNT(DISTINCT sg.id) FROM study_groups sg
         WHERE sg.organization_id=:organization) AS normalized_study_groups,
        (SELECT COUNT(DISTINCT TRIM(p.study_group)) FROM persons p
         WHERE p.tenant_id=:tenant AND p.study_group IS NOT NULL
           AND TRIM(p.study_group)<>'') AS person_legacy_group_values,
        (SELECT COUNT(DISTINCT TRIM(r.study_group)) FROM registrations r
         JOIN events e ON e.id=r.event_id
         WHERE e.organization_id=:organization AND r.study_group IS NOT NULL
           AND TRIM(r.study_group)<>'') AS registration_legacy_group_values,
        (SELECT COUNT(*) FROM (
           SELECT DISTINCT TRIM(p.study_group) AS legacy_group FROM persons p
           WHERE p.tenant_id=:tenant AND p.study_group IS NOT NULL
             AND TRIM(p.study_group)<>''
        ) legacy WHERE NOT EXISTS (
           SELECT 1 FROM study_groups sg WHERE sg.organization_id=:organization
             AND sg.name=legacy.legacy_group
        )) AS unmatched_person_group_values,
        (SELECT COUNT(*) FROM (
           SELECT DISTINCT TRIM(r.study_group) AS legacy_group FROM registrations r
           JOIN events e ON e.id=r.event_id
           WHERE e.organization_id=:organization AND r.study_group IS NOT NULL
             AND TRIM(r.study_group)<>''
        ) legacy WHERE NOT EXISTS (
           SELECT 1 FROM study_groups sg WHERE sg.organization_id=:organization
             AND sg.name=legacy.legacy_group
        )) AS unmatched_registration_group_values""",
        {"tenant": tenant_id, "organization": organization_id},
    )
    assert item is not None
    return StructureDiagnostics(
        membership_total=int(item["membership_total"] or 0),
        normalized_memberships=int(item["normalized_memberships"] or 0),
        memberships_without_department=int(item["memberships_without_department"] or 0),
        memberships_without_study_group=int(
            item["memberships_without_study_group"] or 0
        ),
        memberships_without_course=int(item["memberships_without_course"] or 0),
        normalized_study_groups=int(item["normalized_study_groups"] or 0),
        person_legacy_group_values=int(item["person_legacy_group_values"] or 0),
        registration_legacy_group_values=int(
            item["registration_legacy_group_values"] or 0
        ),
        unmatched_person_group_values=int(item["unmatched_person_group_values"] or 0),
        unmatched_registration_group_values=int(
            item["unmatched_registration_group_values"] or 0
        ),
    )
