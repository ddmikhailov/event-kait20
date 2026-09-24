from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError, OperationalError

from event_api.database import Database
from event_api.registration_service import find_or_create_person
from event_api.structure_diagnostics import structure_diagnostics

ORIGIN = {"Origin": "http://localhost:5173"}


def login(client: TestClient) -> dict[str, str]:
    client.cookies.clear()
    response = client.post(
        "/auth/login",
        headers=ORIGIN,
        json={"email": "admin@example.com", "password": "correct horse battery"},
    )
    assert response.status_code == 200, response.text
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrfToken"]}


def test_scoped_structure_crud_and_historical_membership(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database

    department = client.post(
        "/admin/structure/departments",
        headers=headers,
        json={"code": f"TEST_{uuid4().hex[:8].upper()}", "name": "Тестовое отделение"},
    )
    assert department.status_code == 201, department.text
    department_id = department.json()["id"]

    group = client.post(
        "/admin/structure/groups",
        headers=headers,
        json={
            "departmentId": department_id,
            "name": "SA-111",
            "code": f"SA_{uuid4().hex[:8].upper()}",
            "course": 3,
        },
    )
    assert group.status_code == 201, group.text
    group_id = group.json()["id"]

    direction = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={
            "code": f"DIR_{uuid4().hex[:8].upper()}",
            "name": "Тестовое направление",
        },
    )
    assert direction.status_code == 201, direction.text
    assert direction.json()["tenantId"]

    person_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO persons
                (id,tenant_id,last_name,first_name,person_type,dedup_review_required,
                 created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001','Иванов','Иван',
                        'KAIT_STUDENT',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": person_id},
        )

    membership = client.post(
        f"/admin/people/{person_id}/memberships",
        headers=headers,
        json={"studyGroupId": group_id, "validFrom": "2026-09-01"},
    )
    assert membership.status_code == 201, membership.text
    assert membership.json()["course"] == 3
    assert membership.json()["studyGroup"] == "SA-111"

    changed = client.patch(
        f"/admin/structure/groups/{group_id}",
        headers=headers,
        json={"course": 4, "name": "SA-111-renamed"},
    )
    assert changed.status_code == 200, changed.text
    history = client.get(f"/admin/people/{person_id}/memberships")
    assert history.status_code == 200, history.text
    assert history.json()["items"][0]["course"] == 3
    assert history.json()["items"][0]["studyGroup"] == "SA-111"

    deactivated = client.delete(f"/admin/structure/groups/{group_id}", headers=headers)
    assert deactivated.status_code == 200, deactivated.text
    assert client.get("/admin/structure/groups?active=true").status_code == 200


def test_tenant_identity_and_reference_isolation(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    (
        tenant_b,
        organization_b,
        department_b,
        group_b,
        direction_b,
        organization_a2,
        department_a2,
        group_a2,
        direction_a2,
    ) = (str(uuid4()) for _ in range(9))
    person_data = {
        "last_name": "Одинаков",
        "first_name": "Человек",
        "middle_name": None,
        "birth_date": date(2008, 1, 2),
        "email": "same@example.com",
        "phone": "+79990000001",
        "person_type": "KAIT_STUDENT",
        "organization": "КАИТ №20",
        "study_group": "TEST",
    }
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO tenants (id,code,name,active,created_at,updated_at)
                VALUES (:id,:code,'Другой tenant',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": tenant_b, "code": f"tenant-{uuid4().hex[:8]}"},
        )
        connection.execute(
            text(
                """INSERT INTO organizations
                (id,tenant_id,code,name,active,created_at,updated_at)
                VALUES (:id,:tenant,:code,'Другая организация',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": organization_b,
                "tenant": tenant_b,
                "code": f"org-{uuid4().hex[:8]}",
            },
        )
        connection.execute(
            text(
                """INSERT INTO departments
                (id,organization_id,code,name,active,sort_order,created_at,updated_at)
                VALUES (:id,:organization,'FOREIGN','Чужое отделение',true,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": department_b, "organization": organization_b},
        )
        connection.execute(
            text(
                """INSERT INTO study_groups
                (id,organization_id,department_id,name,course,active,created_at,updated_at)
                VALUES (:id,:organization,:department,'FOREIGN-GROUP',2,true,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": group_b, "organization": organization_b, "department": department_b},
        )
        connection.execute(
            text(
                """INSERT INTO activity_directions
                (id,tenant_id,organization_id,code,name,active,sort_order,created_at,updated_at)
                VALUES (:id,:tenant,:organization,'FOREIGN_DIR','Чужое направление',true,0,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": direction_b, "tenant": tenant_b, "organization": organization_b},
        )
        connection.execute(
            text(
                """INSERT INTO organizations
                (id,tenant_id,code,name,active,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001',:code,
                        'Вторая организация',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": organization_a2, "code": f"org-{uuid4().hex[:8]}"},
        )
        connection.execute(
            text(
                """INSERT INTO departments
                (id,organization_id,code,name,active,sort_order,created_at,updated_at)
                VALUES (:id,:organization,'OTHER_ORG','Другое отделение',true,0,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": department_a2, "organization": organization_a2},
        )
        connection.execute(
            text(
                """INSERT INTO study_groups
                (id,organization_id,department_id,name,course,active,created_at,updated_at)
                VALUES (:id,:organization,:department,'OTHER-GROUP',2,true,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": group_a2,
                "organization": organization_a2,
                "department": department_a2,
            },
        )
        connection.execute(
            text(
                """INSERT INTO activity_directions
                (id,tenant_id,organization_id,code,name,active,sort_order,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001',:organization,
                        'OTHER_DIR','Чужое локальное направление',true,0,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": direction_a2, "organization": organization_a2},
        )
        first = find_or_create_person(
            connection,
            person_data,
            "50000000-0000-4000-8000-000000000001",
            update_existing=False,
        )
        second = find_or_create_person(
            connection, person_data, tenant_b, update_existing=False
        )
        repeated = find_or_create_person(
            connection,
            person_data,
            "50000000-0000-4000-8000-000000000001",
            update_existing=False,
        )
        assert first != second
        assert repeated == first

    hidden = client.patch(
        f"/admin/structure/departments/{department_b}",
        headers=headers,
        json={"name": "Попытка"},
    )
    assert hidden.status_code == 404
    assert all(
        item["id"] != department_b
        for item in client.get("/admin/structure/departments").json()["items"]
    )
    assert all(
        item["id"] != group_b
        for item in client.get("/admin/structure/groups").json()["items"]
    )
    assert all(
        item["id"] != direction_b
        for item in client.get("/admin/structure/directions").json()["items"]
    )
    assert (
        client.patch(
            f"/admin/structure/directions/{direction_b}",
            headers=headers,
            json={"name": "Попытка"},
        ).status_code
        == 404
    )
    cross_organization = client.post(
        "/admin/structure/groups",
        headers=headers,
        json={"departmentId": department_a2, "name": "Blocked", "course": 1},
    )
    assert cross_organization.status_code == 404
    assert cross_organization.json()["error"]["code"] == "DEPARTMENT_NOT_FOUND"
    for endpoint, payload in (
        (
            "/admin/structure/departments",
            {"organizationId": organization_a2, "code": "BLOCKED", "name": "Blocked"},
        ),
        (
            "/admin/structure/groups",
            {
                "organizationId": organization_a2,
                "departmentId": department_a2,
                "name": "Blocked",
                "course": 1,
            },
        ),
        (
            "/admin/structure/directions",
            {
                "organizationId": organization_a2,
                "code": "BLOCKED_DIR",
                "name": "Blocked",
            },
        ),
    ):
        denied = client.post(endpoint, headers=headers, json=payload)
        assert denied.status_code == 409
        assert denied.json()["error"]["code"] == "ORGANIZATION_SCOPE_MISMATCH"
    assert (
        client.patch(
            f"/admin/structure/departments/{department_a2}",
            headers=headers,
            json={"name": "Blocked"},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/admin/structure/groups/{group_a2}",
            headers=headers,
            json={"name": "Blocked"},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/admin/structure/directions/{direction_a2}",
            headers=headers,
            json={"name": "Blocked"},
        ).status_code
        == 404
    )
    membership = client.post(
        f"/admin/people/{first}/memberships",
        headers=headers,
        json={"studyGroupId": group_b, "validFrom": "2026-09-01"},
    )
    assert membership.status_code == 404
    event = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Blocked direction",
            "slug": f"blocked-{uuid4().hex[:10]}",
            "directionId": direction_b,
            "startAt": "2026-12-10T10:00:00+03:00",
            "endAt": "2026-12-10T12:00:00+03:00",
            "location": "КАИТ №20",
            "registrationDeadline": "2026-12-09T10:00:00+03:00",
            "capacity": 10,
        },
    )
    assert event.status_code == 404


def test_legacy_event_direction_is_normalized(client: TestClient) -> None:
    headers = login(client)
    slug = f"stage1-{uuid4().hex[:10]}"
    response = client.post(
        "/admin/events",
        headers=headers,
        json={
            "title": "Совместимое мероприятие",
            "slug": slug,
            "direction": "Наследуемое направление",
            "startAt": "2026-12-10T10:00:00+03:00",
            "endAt": "2026-12-10T12:00:00+03:00",
            "location": "КАИТ №20",
            "registrationDeadline": "2026-12-09T10:00:00+03:00",
            "capacity": 10,
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["direction"] == "Наследуемое направление"
    assert response.json()["directionId"]
    assert response.json()["organizationId"]
    event_id = response.json()["id"]
    assert client.get(f"/admin/events/{event_id}").status_code == 200
    updated = client.patch(
        f"/admin/events/{event_id}",
        headers=headers,
        json={"location": "Новый адрес"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["directionId"] == response.json()["directionId"]


def event_payload(**extra: object) -> dict[str, object]:
    return {
        "title": "Direction validation",
        "slug": f"direction-{uuid4().hex[:10]}",
        "startAt": "2026-12-10T10:00:00+03:00",
        "endAt": "2026-12-10T12:00:00+03:00",
        "location": "КАИТ №20",
        "registrationDeadline": "2026-12-09T10:00:00+03:00",
        "capacity": 10,
        **extra,
    }


def test_direction_create_and_edit_are_reflected_canonically(
    client: TestClient,
) -> None:
    """Stage 4.5: the two gaps in existing Direction coverage - (1) a
    created Direction actually appears in the canonical list with its
    submitted fields, and (2) an edit updates exactly the fields sent and
    preserves the rest, while an existing Event's own `direction_id` FK is
    unaffected by editing the Direction's name.
    """
    headers = login(client)
    code = f"DIR_EDIT_{uuid4().hex[:8].upper()}"
    created = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={
            "code": code,
            "name": "Исходное направление",
            "description": "Исходное описание",
            "sortOrder": 5,
        },
    )
    assert created.status_code == 201, created.text
    direction_id = created.json()["id"]
    assert created.json()["code"] == code
    assert created.json()["sortOrder"] == 5

    listed = client.get("/admin/structure/directions", headers=headers)
    assert listed.status_code == 200, listed.text
    listed_item = next(
        item for item in listed.json()["items"] if item["id"] == direction_id
    )
    assert listed_item["name"] == "Исходное направление"
    assert listed_item["description"] == "Исходное описание"

    event = client.post(
        "/admin/events",
        headers=headers,
        json=event_payload(directionId=direction_id),
    )
    assert event.status_code == 201, event.text
    event_id = event.json()["id"]

    updated = client.patch(
        f"/admin/structure/directions/{direction_id}",
        headers=headers,
        json={"name": "Изменённое направление", "sortOrder": 9},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Изменённое направление"
    assert updated.json()["sortOrder"] == 9
    assert updated.json()["code"] == code, (
        "fields not sent in the PATCH must be preserved"
    )
    assert updated.json()["description"] == "Исходное описание"

    reread_event = client.get(f"/admin/events/{event_id}", headers=headers)
    assert reread_event.status_code == 200, reread_event.text
    assert reread_event.json()["directionId"] == direction_id, (
        "editing a Direction's name must not change an existing Event's FK"
    )


def test_inactive_direction_is_rejected_for_id_and_legacy_text(
    client: TestClient,
) -> None:
    headers = login(client)
    name = f"Inactive {uuid4().hex[:8]}"
    created = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={"code": f"INACTIVE_{uuid4().hex[:8].upper()}", "name": name},
    )
    assert created.status_code == 201, created.text
    direction_id = created.json()["id"]
    assert (
        client.delete(
            f"/admin/structure/directions/{direction_id}", headers=headers
        ).status_code
        == 200
    )
    by_id = client.post(
        "/admin/events", headers=headers, json=event_payload(directionId=direction_id)
    )
    by_text = client.post(
        "/admin/events", headers=headers, json=event_payload(direction=name)
    )
    for response in (by_id, by_text):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "DIRECTION_INACTIVE"


def test_direction_name_is_unique_per_scope_and_legacy_ambiguity_is_rejected(
    client: TestClient,
) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    name = f"Shared direction {uuid4().hex[:8]}"
    created = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={"code": f"LOCAL_{uuid4().hex[:8].upper()}", "name": name},
    )
    assert created.status_code == 201, created.text
    duplicate_name = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={"code": f"OTHER_{uuid4().hex[:8].upper()}", "name": name},
    )
    assert duplicate_name.status_code == 409, duplicate_name.text

    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO activity_directions
                (id,tenant_id,organization_id,code,name,active,sort_order,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001',NULL,:code,:name,
                        true,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {
                "id": str(uuid4()),
                "code": f"GLOBAL_{uuid4().hex[:8].upper()}",
                "name": name,
            },
        )
    ambiguous = client.post(
        "/admin/events", headers=headers, json=event_payload(direction=name)
    )
    assert ambiguous.status_code == 409, ambiguous.text
    assert ambiguous.json()["error"]["code"] == "DIRECTION_AMBIGUOUS"


def test_scope_columns_have_no_defaults_and_direction_codes_are_scope_unique(
    client: TestClient,
) -> None:
    database: Database = client.app.state.database
    organization_b = str(uuid4())
    direction_ids = [str(uuid4()) for _ in range(3)]
    code = f"SHARED_{uuid4().hex[:8].upper()}"
    with database.transaction() as connection:
        defaults = connection.execute(
            text(
                """SELECT TABLE_NAME,COLUMN_NAME,COLUMN_DEFAULT FROM information_schema.columns
                WHERE table_schema=DATABASE() AND (
                  (TABLE_NAME='persons' AND COLUMN_NAME='tenant_id') OR
                  (TABLE_NAME='staff_users' AND COLUMN_NAME IN ('tenant_id','organization_id')) OR
                  (TABLE_NAME='staff_invitations' AND COLUMN_NAME IN ('tenant_id','organization_id')) OR
                  (TABLE_NAME='events' AND COLUMN_NAME='organization_id') OR
                  (TABLE_NAME='student_memberships' AND COLUMN_NAME='organization_id'))"""
            )
        ).all()
        assert len(defaults) == 7
        assert all(default is None for _table, _column, default in defaults)
        connection.execute(
            text(
                """INSERT INTO organizations
                (id,tenant_id,code,name,active,created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001',:code,
                        'Scope B',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": organization_b, "code": f"scope-{uuid4().hex[:8]}"},
        )
        for identity, organization in zip(
            direction_ids,
            (
                "51000000-0000-4000-8000-000000000001",
                organization_b,
                None,
            ),
            strict=True,
        ):
            connection.execute(
                text(
                    """INSERT INTO activity_directions
                    (id,tenant_id,organization_id,code,name,active,sort_order,created_at,updated_at)
                    VALUES (:id,'50000000-0000-4000-8000-000000000001',:organization,
                            :code,:name,true,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": identity,
                    "organization": organization,
                    "code": code,
                    "name": f"Scope {identity[:8]}",
                },
            )
    headers = login(client)
    duplicate = client.post(
        "/admin/structure/directions",
        headers=headers,
        json={"code": code, "name": "Duplicate"},
    )
    assert duplicate.status_code == 409

    with (
        pytest.raises((IntegrityError, OperationalError)),
        database.transaction() as connection,
    ):
        connection.execute(
            text(
                """INSERT INTO persons
                (id,last_name,first_name,person_type,dedup_review_required,
                 created_at,updated_at)
                VALUES (:id,'No','Tenant','OTHER',false,
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": str(uuid4())},
        )

    with (
        pytest.raises((IntegrityError, OperationalError)),
        database.transaction() as connection,
    ):
        staff_id = connection.execute(
            text("SELECT id FROM staff_users WHERE system_role='SUPER_ADMIN' LIMIT 1")
        ).scalar_one()
        connection.execute(
            text(
                """INSERT INTO events
                (id,title,slug,start_at,end_at,location,registration_deadline,
                 capacity,status,created_by,updated_at)
                VALUES (:id,'No organization',:slug,'2026-12-10 10:00:00',
                        '2026-12-10 12:00:00','KAIT20','2026-12-09 10:00:00',
                        10,'DRAFT',:staff,UTC_TIMESTAMP(3))"""
            ),
            {
                "id": str(uuid4()),
                "slug": f"no-organization-{uuid4().hex[:8]}",
                "staff": staff_id,
            },
        )


def test_unresolved_legacy_membership_remains_visible(client: TestClient) -> None:
    headers = login(client)
    database: Database = client.app.state.database
    person_id, membership_id = str(uuid4()), str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text(
                """INSERT INTO persons
                (id,tenant_id,last_name,first_name,person_type,dedup_review_required,
                 created_at,updated_at)
                VALUES (:id,'50000000-0000-4000-8000-000000000001','Legacy','Visible',
                        'KAIT_STUDENT',false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": person_id},
        )
        connection.execute(
            text(
                """INSERT INTO student_memberships
                (id,person_id,organization_id,study_group,department,valid_from,
                 created_at,updated_at)
                VALUES (:id,:person,'51000000-0000-4000-8000-000000000001',
                        'LEGACY-GROUP','LEGACY-DEPARTMENT','2025-09-01',
                        UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
            ),
            {"id": membership_id, "person": person_id},
        )
    response = client.get(f"/admin/people/{person_id}/memberships", headers=headers)
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["id"] == membership_id
    assert item["studyGroup"] == "LEGACY-GROUP"
    assert item["department"] == "LEGACY-DEPARTMENT"
    assert item["studyGroupId"] is None
    assert item["departmentId"] is None
    assert item["course"] is None


def test_inactive_tenant_or_organization_blocks_staff_context(
    client: TestClient,
) -> None:
    database: Database = client.app.state.database
    headers = login(client)
    try:
        with database.transaction() as connection:
            connection.execute(
                text(
                    """UPDATE organizations SET active=false
                    WHERE id='51000000-0000-4000-8000-000000000001'"""
                )
            )
        assert client.get("/auth/session", headers=headers).status_code == 401
        client.cookies.clear()
        blocked = client.post(
            "/auth/login",
            headers=ORIGIN,
            json={"email": "admin@example.com", "password": "correct horse battery"},
        )
        assert blocked.status_code == 401
    finally:
        with database.transaction() as connection:
            connection.execute(
                text(
                    """UPDATE organizations SET active=true
                    WHERE id='51000000-0000-4000-8000-000000000001'"""
                )
            )
    headers = login(client)
    try:
        with database.transaction() as connection:
            connection.execute(
                text(
                    """UPDATE tenants SET active=false
                    WHERE id='50000000-0000-4000-8000-000000000001'"""
                )
            )
        assert client.get("/auth/session", headers=headers).status_code == 401
    finally:
        with database.transaction() as connection:
            connection.execute(
                text(
                    """UPDATE tenants SET active=true
                    WHERE id='50000000-0000-4000-8000-000000000001'"""
                )
            )


def execute_migration(connection: object, path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    executable = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("--")
    )
    for statement in (part.strip() for part in executable.split(";")):
        if statement:
            connection.exec_driver_sql(statement)  # type: ignore[attr-defined]


def test_legacy_department_aliases_map_to_canonical_departments(
    database_url: str,
) -> None:
    name = f"stage1_aliases_{uuid4().hex[:12]}"
    sqlalchemy_url = database_url.replace("mysql://", "mysql+pymysql://", 1)
    server = create_engine(
        sqlalchemy_url.rsplit("/", 1)[0] + "/", isolation_level="AUTOCOMMIT"
    )
    database = create_engine(sqlalchemy_url.rsplit("/", 1)[0] + f"/{name}")
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    aliases = (
        ("Data Hub", "Датахаб", "DATA_HUB"),
        ("Датахаб", "Датахаб", "DATA_HUB"),
        ("Артех", "АртТех", "ARTECH"),
        ("АртТех", "АртТех", "ARTECH"),
        ("Digital", "Диджитал", "DIGITAL"),
        ("Диджитал", "Диджитал", "DIGITAL"),
    )
    try:
        with server.connect() as connection:
            connection.exec_driver_sql(
                f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        with database.begin() as connection:
            for path in sorted(migrations.glob("*.sql")):
                if path.name.startswith("015_"):
                    break
                execute_migration(connection, path)
            for index, (snapshot, _canonical_name, _canonical_code) in enumerate(
                aliases
            ):
                person_id = str(uuid4())
                connection.execute(
                    text(
                        """INSERT INTO persons
                        (id,last_name,first_name,person_type,dedup_review_required,
                         created_at,updated_at)
                        VALUES (:id,'Alias',:first,'KAIT_STUDENT',false,
                                UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                    ),
                    {"id": person_id, "first": str(index)},
                )
                connection.execute(
                    text(
                        """INSERT INTO student_memberships
                        (id,person_id,study_group,department,valid_from,created_at,updated_at)
                        VALUES (:id,:person,:study_group,:department,'2026-09-01',
                                UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                    ),
                    {
                        "id": str(uuid4()),
                        "person": person_id,
                        "study_group": f"ALIAS-{index}",
                        "department": snapshot,
                    },
                )
            execute_migration(connection, migrations / "015_platform_structure.sql")
            memberships = (
                connection.execute(
                    text(
                        """SELECT sm.department AS snapshot,sm.department_id,
                              d.code,d.name AS canonical_name
                    FROM student_memberships sm
                    JOIN departments d ON d.id=sm.department_id"""
                    )
                )
                .mappings()
                .all()
            )
            canonical_departments = connection.execute(
                text(
                    """SELECT code,name FROM departments
                    WHERE organization_id='51000000-0000-4000-8000-000000000001'
                      AND code IN ('DATA_HUB','CYBER','ARTECH','MOSSOVET','TECHNO','DIGITAL')"""
                )
            ).all()
            alias_duplicates = connection.execute(
                text(
                    """SELECT COUNT(*) FROM departments
                    WHERE LEFT(code,7)='LEGACY_'
                      AND name IN ('Data Hub','Датахаб','Артех','АртТех',
                                   'Digital','Диджитал')"""
                )
            ).scalar_one()

        by_snapshot = {item["snapshot"]: item for item in memberships}
        for snapshot, canonical_name, canonical_code in aliases:
            assert by_snapshot[snapshot]["canonical_name"] == canonical_name
            assert by_snapshot[snapshot]["code"] == canonical_code
        assert (
            by_snapshot["Data Hub"]["department_id"]
            == by_snapshot["Датахаб"]["department_id"]
        )
        assert (
            by_snapshot["Артех"]["department_id"]
            == by_snapshot["АртТех"]["department_id"]
        )
        assert (
            by_snapshot["Digital"]["department_id"]
            == by_snapshot["Диджитал"]["department_id"]
        )
        assert dict(canonical_departments) == {
            "DATA_HUB": "Датахаб",
            "CYBER": "Кибер",
            "ARTECH": "АртТех",
            "MOSSOVET": "МосСовет",
            "TECHNO": "Техно",
            "DIGITAL": "Диджитал",
        }
        assert alias_duplicates == 0
        assert {item["snapshot"] for item in memberships} == {
            snapshot for snapshot, _name, _code in aliases
        }
    finally:
        database.dispose()
        with server.connect() as connection:
            connection.exec_driver_sql(f"DROP DATABASE IF EXISTS `{name}`")
        server.dispose()


def test_legacy_upgrade_preserves_membership_and_score_attribution(
    database_url: str,
) -> None:
    name = f"stage1_upgrade_{uuid4().hex[:12]}"
    sqlalchemy_url = database_url.replace("mysql://", "mysql+pymysql://", 1)
    server = create_engine(
        sqlalchemy_url.rsplit("/", 1)[0] + "/", isolation_level="AUTOCOMMIT"
    )
    database = create_engine(sqlalchemy_url.rsplit("/", 1)[0] + f"/{name}")
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    (
        person_id,
        staff_id,
        event_id,
        registration_id,
        membership_id,
        season_id,
        score_id,
        award_id,
        reversal_id,
        manual_id,
        rule_id,
        spectator_id,
        grand_prix_id,
    ) = (str(uuid4()) for _ in range(13))
    try:
        with server.connect() as connection:
            connection.exec_driver_sql(
                f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4"
            )
        with database.begin() as connection:
            for path in sorted(migrations.glob("*.sql")):
                if path.name.startswith("015_"):
                    break
                execute_migration(connection, path)
            connection.execute(
                text(
                    """INSERT INTO persons
                    (id,last_name,first_name,study_group,person_type,dedup_review_required,
                     created_at,updated_at)
                    VALUES (:id,'Legacy','Student','PERSON-ONLY','KAIT_STUDENT',false,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {"id": person_id},
            )
            connection.execute(
                text(
                    """INSERT INTO staff_users
                    (id,email,email_normalized,password_hash,system_role,active,
                     password_changed_at,created_at,updated_at)
                    VALUES (:id,'legacy-admin@example.test','legacy-admin@example.test',
                            'test-placeholder','SUPER_ADMIN',true,UTC_TIMESTAMP(3),
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {"id": staff_id},
            )
            connection.execute(
                text(
                    """INSERT INTO events
                    (id,title,slug,direction,start_at,end_at,location,
                     registration_deadline,capacity,status,created_by,updated_at)
                    VALUES (:id,'Legacy event','legacy-event','Legacy direction',
                            '2026-10-01 10:00:00','2026-10-01 12:00:00','KAIT20',
                            '2026-09-30 10:00:00',10,'DRAFT',:staff,UTC_TIMESTAMP(3))"""
                ),
                {"id": event_id, "staff": staff_id},
            )
            connection.execute(
                text(
                    """INSERT INTO registrations
                    (id,public_id,event_id,person_id,source,status,last_name,first_name,
                     study_group,person_type,consent_accepted,registered_at,created_at,updated_at)
                    VALUES (:id,:public,:event,:person,'ADMIN_MANUAL','ACTIVE','Legacy',
                            'Student','REG-ONLY','KAIT_STUDENT',true,UTC_TIMESTAMP(3),
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": registration_id,
                    "public": str(uuid4()),
                    "event": event_id,
                    "person": person_id,
                },
            )
            connection.execute(
                text(
                    """INSERT INTO student_memberships
                    (id,person_id,study_group,department,valid_from,created_at,updated_at)
                    VALUES (:id,:person,'SA-111','Старое отделение','2026-09-01',
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {"id": membership_id, "person": person_id},
            )
            connection.execute(
                text(
                    """INSERT INTO seasons
                    (id,code,name,starts_at,ends_at,active,created_at,updated_at)
                    VALUES (:id,'LEGACY','Legacy','2026-01-01','2027-01-01',false,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {"id": season_id},
            )
            connection.execute(
                text(
                    """INSERT INTO scoring_rules
                    (id,season_id,points,priority,active,version,created_at,updated_at,
                     created_by,updated_by)
                    VALUES (:id,:season,7,1,true,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
                            :staff,:staff)"""
                ),
                {"id": rule_id, "season": season_id, "staff": staff_id},
            )
            connection.execute(
                text(
                    """INSERT INTO score_transactions
                    (id,person_id,season_id,membership_id,transaction_type,points,reason,
                     source,idempotency_key,created_at)
                    VALUES (:id,:person,:season,:membership,'LEGACY_IMPORT',1,'legacy',
                            'IMPORT',:key,UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": score_id,
                    "person": person_id,
                    "season": season_id,
                    "membership": membership_id,
                    "key": f"legacy:{score_id}",
                },
            )
            connection.execute(
                text(
                    """INSERT INTO score_transactions
                    (id,person_id,season_id,scoring_rule_id,transaction_type,points,
                     reason,source,scoring_cycle,idempotency_key,created_at)
                    VALUES
                    (:award,:person,:season,:rule,'AWARD',7,'v1 award',
                     'SCORING_ENGINE',1,:award_key,UTC_TIMESTAMP(3)),
                    (:manual,:person,:season,NULL,'MANUAL_ADJUSTMENT',3,'manual',
                     'ADMIN',NULL,:manual_key,UTC_TIMESTAMP(3))"""
                ),
                {
                    "award": award_id,
                    "manual": manual_id,
                    "person": person_id,
                    "season": season_id,
                    "rule": rule_id,
                    "award_key": f"award:{award_id}",
                    "manual_key": f"manual:{manual_id}",
                },
            )
            connection.execute(
                text(
                    """INSERT INTO score_transactions
                    (id,person_id,season_id,transaction_type,points,reason,source,
                     scoring_cycle,original_transaction_id,idempotency_key,created_at)
                    VALUES (:id,:person,:season,'REVERSAL',-7,'v1 reversal',
                            'SCORING_ENGINE',1,:original,:key,UTC_TIMESTAMP(3))"""
                ),
                {
                    "id": reversal_id,
                    "person": person_id,
                    "season": season_id,
                    "original": award_id,
                    "key": f"reversal:{reversal_id}",
                },
            )
            connection.execute(
                text(
                    """INSERT INTO participation_roles
                    (id,code,name,active,built_in,sort_order,created_at,updated_at)
                    VALUES (:id,'SPECTATOR','Пользовательский зритель',true,false,99,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {"id": spectator_id},
            )
            connection.execute(
                text(
                    """INSERT INTO participation_results
                    (id,code,name,active,built_in,sort_order,created_at,updated_at)
                    VALUES (:id,'GRAND_PRIX','Пользовательский гран-при',true,false,99,
                            UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""
                ),
                {"id": grand_prix_id},
            )
            execute_migration(connection, migrations / "015_platform_structure.sql")
            execute_migration(connection, migrations / "016_scoring_engine_v2.sql")
            membership = (
                connection.execute(
                    text(
                        """SELECT id,organization_id,department_id,study_group_id,course
                    FROM student_memberships WHERE id=:id"""
                    ),
                    {"id": membership_id},
                )
                .mappings()
                .one()
            )
            score = (
                connection.execute(
                    text(
                        """SELECT id,membership_id,points,original_transaction_id
                        FROM score_transactions WHERE id=:id"""
                    ),
                    {"id": score_id},
                )
                .mappings()
                .one()
            )
            engine_markers = {
                item["id"]: item
                for item in connection.execute(
                    text(
                        """SELECT id,points,original_transaction_id,
                               scoring_engine_version
                        FROM score_transactions
                        WHERE id IN (:award,:reversal,:manual,:imported)"""
                    ),
                    {
                        "award": award_id,
                        "reversal": reversal_id,
                        "manual": manual_id,
                        "imported": score_id,
                    },
                ).mappings()
            }
            resolved_classifiers = {
                item["code"]: item
                for item in connection.execute(
                    text(
                        """SELECT r.code,r.id,r.name,b.value FROM scoring_policy_role_bases b
                        JOIN participation_roles r ON r.id=b.role_id
                        WHERE b.policy_version_id='61000000-0000-4000-8000-000000000001'
                          AND r.code='SPECTATOR'
                        UNION ALL
                        SELECT r.code,r.id,r.name,b.value FROM scoring_policy_result_bonuses b
                        JOIN participation_results r ON r.id=b.result_id
                        WHERE b.policy_version_id='61000000-0000-4000-8000-000000000001'
                          AND r.code='GRAND_PRIX'"""
                    )
                ).mappings()
            }
            person_tenant = connection.execute(
                text("SELECT tenant_id FROM persons WHERE id=:id"), {"id": person_id}
            ).scalar_one()
            event = (
                connection.execute(
                    text(
                        """SELECT id,organization_id,direction_id
                        FROM events WHERE id=:id"""
                    ),
                    {"id": event_id},
                )
                .mappings()
                .one()
            )
            diagnostics = structure_diagnostics(
                connection,
                "50000000-0000-4000-8000-000000000001",
                "51000000-0000-4000-8000-000000000001",
            )
        assert membership["id"] == membership_id
        assert membership["organization_id"]
        assert membership["department_id"]
        assert membership["study_group_id"]
        assert membership["course"] is None
        assert score["id"] == score_id
        assert score["membership_id"] == membership_id
        assert score["points"] == Decimal("1.0000")
        assert score["original_transaction_id"] is None
        assert engine_markers[award_id]["scoring_engine_version"] == "V1"
        assert engine_markers[reversal_id]["scoring_engine_version"] == "V1"
        assert engine_markers[reversal_id]["original_transaction_id"] == award_id
        assert engine_markers[manual_id]["scoring_engine_version"] is None
        assert engine_markers[score_id]["scoring_engine_version"] is None
        assert engine_markers[award_id]["points"] == Decimal("7.0000")
        assert engine_markers[reversal_id]["points"] == Decimal("-7.0000")
        assert resolved_classifiers["SPECTATOR"]["id"] == spectator_id
        assert resolved_classifiers["SPECTATOR"]["name"] == "Пользовательский зритель"
        assert resolved_classifiers["SPECTATOR"]["value"] == Decimal("0.5000")
        assert resolved_classifiers["GRAND_PRIX"]["id"] == grand_prix_id
        assert resolved_classifiers["GRAND_PRIX"]["name"] == (
            "Пользовательский гран-при"
        )
        assert resolved_classifiers["GRAND_PRIX"]["value"] == Decimal("10.0000")
        assert person_tenant == "50000000-0000-4000-8000-000000000001"
        assert event["id"] == event_id
        assert event["organization_id"] == "51000000-0000-4000-8000-000000000001"
        assert event["direction_id"]
        assert diagnostics == {
            "membership_total": 1,
            "normalized_memberships": 1,
            "memberships_without_department": 0,
            "memberships_without_study_group": 0,
            "memberships_without_course": 1,
            "normalized_study_groups": 1,
            "person_legacy_group_values": 1,
            "registration_legacy_group_values": 1,
            "unmatched_person_group_values": 1,
            "unmatched_registration_group_values": 1,
        }
    finally:
        database.dispose()
        with server.connect() as connection:
            connection.exec_driver_sql(f"DROP DATABASE IF EXISTS `{name}`")
        server.dispose()
