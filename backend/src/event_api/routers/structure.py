from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError

from ..database import Database, execute, row, rows
from ..dependencies import Staff, administrator, csrf_administrator, database
from ..errors import ApiError
from ..service_utils import audit
from ..structure_schemas import (
    DepartmentUpdate,
    DepartmentValues,
    DirectionUpdate,
    DirectionValues,
    StudyGroupUpdate,
    StudyGroupValues,
)
from ..tenant_scope import organization_in_tenant

router = APIRouter(prefix="/admin/structure", tags=["platform-structure"])


def organization_id(
    connection: Connection, staff: Staff, requested: UUID | None
) -> str:
    if requested and str(requested) != staff.organization_id:
        raise ApiError(
            409,
            "ORGANIZATION_SCOPE_MISMATCH",
            "Structure operations use the current organization",
        )
    organization_in_tenant(connection, staff.tenant_id, staff.organization_id)
    return staff.organization_id


def department_row(
    connection: Connection, identity: str, organization_id: str, *, lock: bool = False
) -> RowMapping:
    item = row(
        connection,
        f"""SELECT d.* FROM departments d
        WHERE d.id=:id AND d.organization_id=:organization{" FOR UPDATE" if lock else ""}""",
        {"id": identity, "organization": organization_id},
    )
    if not item:
        raise ApiError(404, "DEPARTMENT_NOT_FOUND", "Department not found")
    return item


def group_row(
    connection: Connection, identity: str, organization_id: str, *, lock: bool = False
) -> RowMapping:
    item = row(
        connection,
        f"""SELECT sg.*,d.code AS department_code,d.name AS department_name,
        d.active AS department_active,d.sort_order AS department_sort_order
        FROM study_groups sg JOIN departments d ON d.id=sg.department_id
        WHERE sg.id=:id AND sg.organization_id=:organization{" FOR UPDATE" if lock else ""}""",
        {"id": identity, "organization": organization_id},
    )
    if not item:
        raise ApiError(404, "STUDY_GROUP_NOT_FOUND", "Study group not found")
    return item


def direction_row(
    connection: Connection, identity: str, organization_id: str, *, lock: bool = False
) -> RowMapping:
    item = row(
        connection,
        f"""SELECT * FROM activity_directions
        WHERE id=:id AND organization_id=:organization{" FOR UPDATE" if lock else ""}""",
        {"id": identity, "organization": organization_id},
    )
    if not item:
        raise ApiError(404, "DIRECTION_NOT_FOUND", "Activity direction not found")
    return item


def department_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "organizationId": item["organization_id"],
        "code": item["code"],
        "name": item["name"],
        "active": bool(item["active"]),
        "sortOrder": int(item["sort_order"]),
    }


def group_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "organizationId": item["organization_id"],
        "department": {
            "id": item["department_id"],
            "organizationId": item["organization_id"],
            "code": item["department_code"],
            "name": item["department_name"],
            "active": bool(item["department_active"]),
            "sortOrder": int(item["department_sort_order"]),
        },
        "name": item["name"],
        "code": item["code"],
        "course": int(item["course"]) if item["course"] is not None else None,
        "active": bool(item["active"]),
    }


def direction_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "tenantId": item["tenant_id"],
        "organizationId": item["organization_id"],
        "code": item["code"],
        "name": item["name"],
        "description": item["description"],
        "active": bool(item["active"]),
        "sortOrder": int(item["sort_order"]),
    }


def conflict(error: IntegrityError) -> ApiError:
    return ApiError(409, "REFERENCE_CONFLICT", "Structure value already exists")


@router.get("/organization")
def current_organization(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        item = organization_in_tenant(
            connection, staff.tenant_id, staff.organization_id
        )
    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["name"],
        "shortName": item["short_name"],
    }


@router.get("/departments")
def list_departments(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    active: bool | None = None,
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT d.* FROM departments d
            WHERE d.organization_id=:organization AND (:active IS NULL OR d.active=:active)
            ORDER BY d.sort_order,d.name,d.id""",
            {"organization": staff.organization_id, "active": active},
        )
    return {"items": [department_response(item) for item in items]}


@router.post("/departments", status_code=201)
def create_department(
    values: DepartmentValues,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    try:
        with db.transaction() as connection:
            resolved_organization = organization_id(
                connection, staff, values.organization_id
            )
            execute(
                connection,
                """INSERT INTO departments
                (id,organization_id,code,name,active,sort_order,created_at,updated_at)
                VALUES (:id,:organization,:code,:name,:active,:sort_order,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    **values.model_dump(exclude={"organization_id"}),
                    "id": identity,
                    "organization": resolved_organization,
                },
            )
            audit(connection, staff.id, "DEPARTMENT_CREATED", "Department", identity)
            item = department_row(connection, identity, staff.organization_id)
    except IntegrityError as error:
        raise conflict(error) from error
    return department_response(item)


@router.patch("/departments/{identity}")
def update_department(
    identity: UUID,
    values: DepartmentUpdate,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    try:
        with db.transaction() as connection:
            existing = department_row(
                connection, str(identity), staff.organization_id, lock=True
            )
            changes = values.model_dump(exclude_unset=True)
            execute(
                connection,
                """UPDATE departments SET code=:code,name=:name,active=:active,
                sort_order=:sort_order,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
                {
                    "id": str(identity),
                    **{
                        key: changes.get(key, existing[key])
                        for key in ("code", "name", "active", "sort_order")
                    },
                },
            )
            audit(
                connection, staff.id, "DEPARTMENT_UPDATED", "Department", str(identity)
            )
            item = department_row(connection, str(identity), staff.organization_id)
    except IntegrityError as error:
        raise conflict(error) from error
    return department_response(item)


@router.delete("/departments/{identity}")
def deactivate_department(
    identity: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        department_row(connection, str(identity), staff.organization_id, lock=True)
        execute(
            connection,
            "UPDATE departments SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": str(identity)},
        )
        audit(
            connection, staff.id, "DEPARTMENT_DEACTIVATED", "Department", str(identity)
        )
    return {"accepted": True}


@router.get("/groups")
def list_groups(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    department_id: Annotated[UUID | None, Query(alias="departmentId")] = None,
    course: Annotated[int | None, Query(ge=1, le=4)] = None,
    active: bool | None = None,
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT sg.*,d.code AS department_code,d.name AS department_name,
            d.active AS department_active,d.sort_order AS department_sort_order
            FROM study_groups sg JOIN departments d ON d.id=sg.department_id
            WHERE sg.organization_id=:organization
              AND (:department IS NULL OR sg.department_id=:department)
              AND (:course IS NULL OR sg.course=:course)
              AND (:active IS NULL OR sg.active=:active)
            ORDER BY d.sort_order,sg.course,sg.name,sg.id""",
            {
                "organization": staff.organization_id,
                "department": str(department_id) if department_id else None,
                "course": course,
                "active": active,
            },
        )
    return {"items": [group_response(item) for item in items]}


def assert_department_for_organization(
    connection: Connection, department_id: str, organization: str
) -> RowMapping:
    item = department_row(connection, department_id, organization)
    if item["organization_id"] != organization:
        raise ApiError(
            409,
            "CROSS_TENANT_REFERENCE",
            "Department does not belong to the selected organization",
        )
    if not item["active"]:
        raise ApiError(409, "INVALID_REFERENCE", "Department is inactive")
    return item


@router.post("/groups", status_code=201)
def create_group(
    values: StudyGroupValues,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    try:
        with db.transaction() as connection:
            resolved_organization = organization_id(
                connection, staff, values.organization_id
            )
            assert_department_for_organization(
                connection,
                str(values.department_id),
                resolved_organization,
            )
            execute(
                connection,
                """INSERT INTO study_groups
                (id,organization_id,department_id,name,code,course,active,created_at,updated_at)
                VALUES (:id,:organization,:department,:name,:code,:course,:active,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    **values.model_dump(exclude={"organization_id", "department_id"}),
                    "id": identity,
                    "organization": resolved_organization,
                    "department": str(values.department_id),
                },
            )
            audit(connection, staff.id, "STUDY_GROUP_CREATED", "StudyGroup", identity)
            item = group_row(connection, identity, staff.organization_id)
    except IntegrityError as error:
        raise conflict(error) from error
    return group_response(item)


@router.patch("/groups/{identity}")
def update_group(
    identity: UUID,
    values: StudyGroupUpdate,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    try:
        with db.transaction() as connection:
            existing = group_row(
                connection, str(identity), staff.organization_id, lock=True
            )
            changes = values.model_dump(exclude_unset=True)
            department = str(changes.get("department_id", existing["department_id"]))
            assert_department_for_organization(
                connection,
                department,
                existing["organization_id"],
            )
            execute(
                connection,
                """UPDATE study_groups SET department_id=:department,name=:name,
                code=:code,course=:course,active=:active,updated_at=UTC_TIMESTAMP(3)
                WHERE id=:id""",
                {
                    "id": str(identity),
                    "department": department,
                    **{
                        key: changes.get(key, existing[key])
                        for key in ("name", "code", "course", "active")
                    },
                },
            )
            audit(
                connection, staff.id, "STUDY_GROUP_UPDATED", "StudyGroup", str(identity)
            )
            item = group_row(connection, str(identity), staff.organization_id)
    except IntegrityError as error:
        raise conflict(error) from error
    return group_response(item)


@router.delete("/groups/{identity}")
def deactivate_group(
    identity: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        group_row(connection, str(identity), staff.organization_id, lock=True)
        execute(
            connection,
            "UPDATE study_groups SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": str(identity)},
        )
        audit(
            connection, staff.id, "STUDY_GROUP_DEACTIVATED", "StudyGroup", str(identity)
        )
    return {"accepted": True}


@router.get("/directions")
def list_directions(
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
    active: bool | None = None,
) -> dict[str, Any]:
    with db.connect() as connection:
        items = rows(
            connection,
            """SELECT * FROM activity_directions
            WHERE organization_id=:organization AND (:active IS NULL OR active=:active)
            ORDER BY sort_order,name,id""",
            {"organization": staff.organization_id, "active": active},
        )
    return {"items": [direction_response(item) for item in items]}


@router.post("/directions", status_code=201)
def create_direction(
    values: DirectionValues,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    identity = str(uuid4())
    try:
        with db.transaction() as connection:
            resolved_organization = organization_id(
                connection, staff, values.organization_id
            )
            execute(
                connection,
                """INSERT INTO activity_directions
                (id,tenant_id,organization_id,code,name,description,active,sort_order,
                 created_at,updated_at)
                VALUES (:id,:tenant,:organization,:code,:name,:description,:active,
                        :sort_order,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    **values.model_dump(exclude={"organization_id"}),
                    "id": identity,
                    "tenant": staff.tenant_id,
                    "organization": resolved_organization,
                },
            )
            audit(
                connection,
                staff.id,
                "ACTIVITY_DIRECTION_CREATED",
                "ActivityDirection",
                identity,
            )
            item = direction_row(connection, identity, staff.organization_id)
    except IntegrityError as error:
        raise conflict(error) from error
    return direction_response(item)


@router.patch("/directions/{identity}")
def update_direction(
    identity: UUID,
    values: DirectionUpdate,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    try:
        with db.transaction() as connection:
            existing = direction_row(
                connection, str(identity), staff.organization_id, lock=True
            )
            changes = values.model_dump(exclude_unset=True)
            execute(
                connection,
                """UPDATE activity_directions SET code=:code,name=:name,
                description=:description,active=:active,sort_order=:sort_order,
                updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
                {
                    "id": str(identity),
                    **{
                        key: changes.get(key, existing[key])
                        for key in (
                            "code",
                            "name",
                            "description",
                            "active",
                            "sort_order",
                        )
                    },
                },
            )
            audit(
                connection,
                staff.id,
                "ACTIVITY_DIRECTION_UPDATED",
                "ActivityDirection",
                str(identity),
            )
            item = direction_row(connection, str(identity), staff.organization_id)
    except IntegrityError as error:
        raise conflict(error) from error
    return direction_response(item)


@router.delete("/directions/{identity}")
def deactivate_direction(
    identity: UUID,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, bool]:
    with db.transaction() as connection:
        direction_row(connection, str(identity), staff.organization_id, lock=True)
        execute(
            connection,
            "UPDATE activity_directions SET active=false,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": str(identity)},
        )
        audit(
            connection,
            staff.id,
            "ACTIVITY_DIRECTION_DEACTIVATED",
            "ActivityDirection",
            str(identity),
        )
    return {"accepted": True}
