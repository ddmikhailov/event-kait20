"""Preview and import student profiles for the public MosActive directory."""

from __future__ import annotations

import hashlib
import io
import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from openpyxl import load_workbook

from ..database import Database, execute, row
from ..dependencies import Staff, csrf_super_admin, database
from ..errors import ApiError
from ..registration_service import create_person
from ..service_utils import audit
from .excel import MAX_FILE, MAX_ROWS, XLSX_MIME, _validate_xlsx_archive

router = APIRouter(prefix="/admin/activity/roster", tags=["roster"])
HEADERS = ("Фамилия", "Имя", "Отчество", "Группа")
REGISTER_HEADERS = (
    "ФИО",
    "Статус обучения",
    "Учебная группа",
    "Адрес площадки",
    "Курс обучения",
    "Профессия/специальность",
    "Код профессии/специальности",
)


def parse_roster(source: bytes) -> list[dict[str, str | None]]:
    if not source or len(source) > MAX_FILE or not source.startswith(b"PK"):
        raise ApiError(
            400, "INVALID_ROSTER_FILE", "A valid XLSX up to 5 MiB is required"
        )
    _validate_xlsx_archive(source)
    try:
        workbook = load_workbook(io.BytesIO(source), read_only=False, data_only=False)
    except Exception as error:
        raise ApiError(400, "INVALID_ROSTER_FILE", "Cannot read XLSX") from error
    try:
        if len(workbook.worksheets) != 1:
            raise ApiError(400, "INVALID_ROSTER_FILE", "One sheet is required")
        sheet = workbook.worksheets[0]
        register_format = (
            sheet.max_row >= 2
            and [str(cell.value or "").strip() for cell in sheet[2]]
            == list(REGISTER_HEADERS)
            and str(sheet["A1"].value or "").strip() == "Реестр контингента"
            and {str(merged) for merged in sheet.merged_cells.ranges} == {"A1:G1"}
        )
        if not register_format and sheet.merged_cells.ranges:
            raise ApiError(400, "INVALID_ROSTER_FILE", "Unexpected merged cells")
        headers = [str(cell.value or "").strip() for cell in sheet[1]]
        if not register_format and headers != list(HEADERS):
            raise ApiError(400, "INVALID_ROSTER_HEADERS", "Unsupported roster columns")
        result: list[dict[str, str | None]] = []
        seen: set[tuple[str, ...]] = set()
        for cells in sheet.iter_rows(min_row=3 if register_format else 2):
            if all(cell.value in (None, "") for cell in cells):
                continue
            if len(result) >= MAX_ROWS or len(cells) != (7 if register_format else 4):
                raise ApiError(400, "INVALID_ROSTER_FILE", "Too many rows or columns")
            if any(cell.data_type == "f" for cell in cells):
                raise ApiError(400, "INVALID_ROSTER_FILE", "Formulas are not allowed")
            values = [str(cell.value or "").strip() for cell in cells]
            if any(len(value) > 120 for value in values):
                raise ApiError(
                    400, "INVALID_ROSTER_ROW", f"Row {cells[0].row}: value is too long"
                )
            if register_format:
                parts = values[0].split()
                if len(parts) not in (2, 3) or not values[2]:
                    raise ApiError(
                        400,
                        "INVALID_ROSTER_ROW",
                        f"Row {cells[0].row}: FIO and group are required",
                    )
                student = {
                    "last_name": parts[0],
                    "first_name": parts[1],
                    "middle_name": parts[2] if len(parts) == 3 else None,
                    "study_group": values[2],
                    "education_status": values[1] or None,
                    "campus_address": values[3] or None,
                    "course_label": values[4] or None,
                    "program_name": values[5] or None,
                    "program_code": values[6] or None,
                }
            else:
                if not all(values[index] for index in (0, 1, 3)):
                    raise ApiError(
                        400,
                        "INVALID_ROSTER_ROW",
                        f"Row {cells[0].row}: surname, name and group are required",
                    )
                student = {
                    "last_name": values[0],
                    "first_name": values[1],
                    "middle_name": values[2] or None,
                    "study_group": values[3],
                    "education_status": None,
                    "campus_address": None,
                    "course_label": None,
                    "program_name": None,
                    "program_code": None,
                }
            if not student["last_name"] or not student["first_name"]:
                raise ApiError(
                    400,
                    "INVALID_ROSTER_ROW",
                    f"Row {cells[0].row}: surname and name are required",
                )
            key = tuple(
                (student[field] or "").casefold()
                for field in ("last_name", "first_name", "middle_name", "study_group")
            )
            if key in seen:
                raise ApiError(
                    409, "DUPLICATE_ROSTER_STUDENT", "Duplicate name and group"
                )
            seen.add(key)
            result.append(student)
        if not result:
            raise ApiError(400, "INVALID_ROSTER_FILE", "No students in workbook")
        return result
    finally:
        workbook.close()


def assert_new_students(
    connection: Any, tenant_id: str, students: list[dict[str, str | None]]
) -> None:
    for student in students:
        found = row(
            connection,
            """SELECT p.id FROM student_roster_members member JOIN persons p ON p.id=member.person_id
            WHERE p.tenant_id=:tenant AND p.merged_into_id IS NULL
              AND p.last_name=:last AND p.first_name=:first
              AND (p.middle_name <=> :middle) AND p.study_group=:group LIMIT 1""",
            {
                "tenant": tenant_id,
                "last": student["last_name"],
                "first": student["first_name"],
                "middle": student["middle_name"],
                "group": student["study_group"],
            },
        )
        if found:
            raise ApiError(
                409, "ROSTER_STUDENT_EXISTS", "A student is already in the roster"
            )


async def upload(file: UploadFile) -> bytes:
    if (
        not (file.filename or "").lower().endswith(".xlsx")
        or file.content_type != XLSX_MIME
    ):
        raise ApiError(400, "INVALID_ROSTER_FILE", "Only XLSX is accepted")
    return await file.read(MAX_FILE + 1)


@router.post("/preview")
async def preview(
    file: Annotated[UploadFile, File()],
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    source = await upload(file)
    students = parse_roster(source)
    with db.connect() as connection:
        assert_new_students(connection, staff.tenant_id, students)
    return {"fileHash": hashlib.sha256(source).hexdigest(), "students": len(students)}


@router.post("/import", status_code=201)
async def import_roster(
    file: Annotated[UploadFile, File()],
    file_hash: Annotated[str, Form(alias="fileHash")],
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, int]:
    source = await upload(file)
    if hashlib.sha256(source).hexdigest() != file_hash:
        raise ApiError(409, "ROSTER_FILE_CHANGED", "Workbook changed after preview")
    students = parse_roster(source)
    with db.transaction() as connection:
        organization = row(
            connection,
            "SELECT name FROM organizations WHERE id=:id AND tenant_id=:tenant FOR UPDATE",
            {"id": staff.organization_id, "tenant": staff.tenant_id},
        )
        if not organization:
            raise ApiError(404, "ORGANIZATION_NOT_FOUND", "Organization not found")
        assert_new_students(connection, staff.tenant_id, students)
        for student in students:
            person_id = create_person(
                connection,
                {
                    **student,
                    "birth_date": None,
                    "email": None,
                    "phone": None,
                    "person_type": "KAIT_STUDENT",
                    "organization": organization["name"],
                },
                staff.tenant_id,
            )
            execute(
                connection,
                """INSERT INTO student_roster_members
                (person_id,education_status,campus_address,course_label,program_name,program_code,created_at,created_by)
                VALUES (:id,:education_status,:campus_address,:course_label,:program_name,:program_code,UTC_TIMESTAMP(3),:actor)""",
                {"id": person_id, "actor": staff.id, **student},
            )
            execute(
                connection,
                """INSERT INTO student_profiles
                (id,person_id,public_slug,visibility,created_at,updated_at)
                VALUES (UUID(),:person,:slug,'PUBLIC',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    "person": person_id,
                    "slug": "active-" + secrets.token_urlsafe(18).rstrip("="),
                },
            )
        audit(
            connection,
            staff.id,
            "STUDENT_ROSTER_IMPORTED",
            "Organization",
            staff.organization_id,
            {"students": len(students)},
        )
    return {"created": len(students)}
