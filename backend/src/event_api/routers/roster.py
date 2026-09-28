"""Preview and import student profiles for the public MosActive directory."""

from __future__ import annotations

import hashlib
import io
import secrets
from typing import Annotated, Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, UploadFile
from openpyxl import load_workbook

from ..database import Database, execute_many, row, rows
from ..dependencies import Staff, csrf_super_admin, database
from ..errors import ApiError
from ..service_utils import audit
from ..xlsx_limits import validate_sheet_grid
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


def roster_error(
    reason: str,
    *,
    row_number: int | None = None,
    column: int | None = None,
    first_row: int | None = None,
    max_length: int | None = None,
    code: str = "INVALID_ROSTER_FILE",
    status: int = 400,
) -> ApiError:
    details: dict[str, Any] = {"reason": reason}
    if row_number is not None:
        details["row"] = row_number
    if column is not None:
        details["column"] = column
    if first_row is not None:
        details["firstRow"] = first_row
    if max_length is not None:
        details["maxLength"] = max_length
    return ApiError(status, code, "Roster validation failed", details)


def cell_text(value: Any) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def header_values(cells: Any) -> list[str]:
    values = [cell_text(cell.value).casefold() for cell in cells]
    while values and not values[-1]:
        values.pop()
    return values


def parse_roster(source: bytes) -> list[dict[str, Any]]:
    if len(source) > MAX_FILE:
        raise roster_error("FILE_TOO_LARGE")
    if not source or not source.startswith(b"PK"):
        raise roster_error("UNREADABLE_FILE")
    try:
        _validate_xlsx_archive(source)
        validate_sheet_grid(source)
    except ApiError as error:
        if error.code == "XLSX_GRID_TOO_LARGE":
            raise roster_error("GRID_TOO_LARGE") from error
        raise roster_error("UNSAFE_ARCHIVE") from error
    try:
        workbook = load_workbook(io.BytesIO(source), read_only=False, data_only=False)
    except Exception as error:
        raise roster_error("UNREADABLE_FILE") from error
    try:
        if len(workbook.worksheets) != 1:
            raise roster_error("SHEET_COUNT")
        sheet = workbook.worksheets[0]
        first = header_values(sheet[1])
        header_row = 2 if first == ["реестр контингента"] else 1
        headers = header_values(sheet[header_row])
        register_format = headers == [value.casefold() for value in REGISTER_HEADERS]
        if not register_format and headers != [value.casefold() for value in HEADERS]:
            raise roster_error(
                "HEADERS", row_number=header_row, code="INVALID_ROSTER_HEADERS"
            )
        allowed_merges = {"A1:G1"} if register_format and header_row == 2 else set()
        if {str(merged) for merged in sheet.merged_cells.ranges} - allowed_merges:
            raise roster_error("MERGED_CELLS")
        width = 7 if register_format else 4
        result: list[dict[str, Any]] = []
        seen: dict[tuple[str, ...], int] = {}
        for row_number, cells in enumerate(
            sheet.iter_rows(min_row=header_row + 1), start=header_row + 1
        ):
            if all(not cell_text(cell.value) for cell in cells):
                continue
            if len(result) >= MAX_ROWS:
                raise roster_error("TOO_MANY_ROWS", row_number=row_number)
            for column, cell in enumerate(cells, start=1):
                if cell.data_type == "f":
                    raise roster_error("FORMULA", row_number=row_number, column=column)
                if cell.data_type == "e":
                    raise roster_error(
                        "CELL_ERROR", row_number=row_number, column=column
                    )
                if column > width and cell_text(cell.value):
                    raise roster_error(
                        "EXTRA_COLUMNS", row_number=row_number, column=column
                    )
            values = [cell_text(cell.value) for cell in cells[:width]]
            for column, value in enumerate(values, start=1):
                # The combined FIO is checked by its individual name parts below.
                limit = 100 if not register_format or column == 3 else 120
                if not (register_format and column == 1) and len(value) > limit:
                    raise roster_error(
                        "VALUE_TOO_LONG",
                        row_number=row_number,
                        column=column,
                        code="INVALID_ROSTER_ROW",
                        max_length=limit,
                    )
            required = (0, 2) if register_format else (0, 1, 3)
            for index in required:
                if not values[index]:
                    raise roster_error(
                        "REQUIRED_VALUE",
                        row_number=row_number,
                        column=index + 1,
                        code="INVALID_ROSTER_ROW",
                    )
            if register_format:
                parts = values[0].split()
                if len(parts) not in (2, 3, 4):
                    raise roster_error(
                        "FIO_PARTS",
                        row_number=row_number,
                        column=1,
                        code="INVALID_ROSTER_ROW",
                    )
                middle_name = " ".join(parts[2:]) or None
                if any(len(part) > 100 for part in parts[:2]) or (
                    middle_name is not None and len(middle_name) > 100
                ):
                    raise roster_error(
                        "VALUE_TOO_LONG",
                        row_number=row_number,
                        column=1,
                        max_length=100,
                        code="INVALID_ROSTER_ROW",
                    )
                student: dict[str, Any] = {
                    "last_name": parts[0],
                    "first_name": parts[1],
                    "middle_name": middle_name,
                    "study_group": values[2],
                    "education_status": values[1] or None,
                    "campus_address": values[3] or None,
                    "course_label": values[4] or None,
                    "program_name": values[5] or None,
                    "program_code": values[6] or None,
                }
            else:
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
            key = tuple(
                (student[field] or "").casefold()
                for field in ("last_name", "first_name", "middle_name", "study_group")
            )
            if key in seen:
                raise roster_error(
                    "DUPLICATE_STUDENT",
                    row_number=row_number,
                    first_row=seen[key],
                    code="DUPLICATE_ROSTER_STUDENT",
                    status=409,
                )
            seen[key] = row_number
            student["_source_row"] = row_number
            result.append(student)
        if not result:
            raise roster_error("EMPTY_ROSTER")
        return result
    finally:
        workbook.close()


def new_students(
    connection: Any,
    tenant_id: str,
    students: list[dict[str, Any]],
    mode: str,
    report: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    new: list[dict[str, Any]] = []
    # Match under the database collation, as the original single-row lookup did.
    # Batching avoids one read query per spreadsheet row without changing which
    # names MySQL considers equal. Two matches are sufficient to flag ambiguity.
    for offset in range(0, len(students), 100):
        batch = students[offset : offset + 100]
        parameters: dict[str, Any] = {"tenant": tenant_id}
        inputs = []
        for index, student in enumerate(batch):
            inputs.append(
                f"SELECT {index} AS source_index, :last_{index} AS last_name, "
                f":first_{index} AS first_name, :middle_{index} AS middle_name, "
                f":group_{index} AS study_group"
            )
            parameters.update(
                {
                    f"last_{index}": student["last_name"],
                    f"first_{index}": student["first_name"],
                    f"middle_{index}": student["middle_name"],
                    f"group_{index}": student["study_group"],
                }
            )
        matches = rows(
            connection,
            """SELECT matched.source_index,matched.last_name,matched.first_name,
            matched.middle_name,matched.study_group,matched.education_status,
            matched.campus_address,matched.course_label,matched.program_name,
            matched.program_code FROM (
                SELECT input.source_index,p.last_name,p.first_name,p.middle_name,
                p.study_group,member.education_status,member.campus_address,
                member.course_label,member.program_name,member.program_code,
                ROW_NUMBER() OVER (PARTITION BY input.source_index ORDER BY p.id) AS match_number
                FROM ("""
            + " UNION ALL ".join(inputs)
            + """
                ) input JOIN persons p ON p.tenant_id=:tenant
                  AND p.merged_into_id IS NULL AND p.last_name=input.last_name
                  AND p.first_name=input.first_name
                  AND (p.middle_name <=> input.middle_name)
                  AND p.study_group=input.study_group
                JOIN student_roster_members member ON member.person_id=p.id
            ) matched WHERE matched.match_number<=2""",
            parameters,
        )
        by_index: dict[int, list[Any]] = {}
        for match in matches:
            by_index.setdefault(int(match["source_index"]), []).append(match)
        for index, student in enumerate(batch):
            found = by_index.get(index, [])
            source_row = student.get("_source_row", offset + index + 2)
            if found:
                if mode == "SKIP_EXACT":
                    if len(found) == 1 and all(
                        cell_text(found[0][key]).casefold()
                        == cell_text(value).casefold()
                        for key, value in student.items()
                        if not key.startswith("_")
                    ):
                        if report is not None:
                            report.append({"row": source_row, "status": "SKIPPED"})
                        continue
                    if report is not None:
                        report.append({"row": source_row, "status": "CONFLICT"})
                        continue
                    raise ApiError(
                        409,
                        "ROSTER_STUDENT_CONFLICT",
                        "Existing student data differs or is ambiguous; review manually",
                    )
                raise ApiError(
                    409, "ROSTER_STUDENT_EXISTS", "A student is already in the roster"
                )
            if report is not None:
                report.append({"row": source_row, "status": "NEW"})
            new.append(student)
    return new


def upload(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith(".xlsx") or file.content_type not in (
        XLSX_MIME,
        "application/octet-stream",
        "",
        None,
    ):
        raise roster_error("FILE_TYPE")
    return file.file.read(MAX_FILE + 1)


def insert_students(
    connection: Any,
    tenant_id: str,
    organization_name: str,
    actor_id: str,
    students: list[dict[str, Any]],
) -> None:
    """Insert complete profiles in bounded batches inside the caller's transaction."""
    for offset in range(0, len(students), 100):
        batch = students[offset : offset + 100]
        prepared = [
            {
                **student,
                "id": str(uuid4()),
                "profile_id": str(uuid4()),
                "tenant": tenant_id,
                "organization": organization_name,
                "actor": actor_id,
                "slug": "active-" + secrets.token_urlsafe(18).rstrip("="),
            }
            for student in batch
        ]
        execute_many(
            connection,
            """INSERT INTO persons
                (id,tenant_id,last_name,first_name,middle_name,birth_date,email,
                 email_normalized,phone,phone_normalized,person_type,organization,
                 study_group,dedup_review_required,created_at,updated_at)
                VALUES (:id,:tenant,:last_name,:first_name,:middle_name,NULL,NULL,
                        NULL,NULL,NULL,'KAIT_STUDENT',:organization,:study_group,
                        false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            prepared,
        )
        execute_many(
            connection,
            """INSERT INTO student_roster_members
                (person_id,education_status,campus_address,course_label,
                 program_name,program_code,created_at,created_by)
                VALUES (:id,:education_status,:campus_address,:course_label,
                        :program_name,:program_code,UTC_TIMESTAMP(3),:actor)""",
            prepared,
        )
        execute_many(
            connection,
            """INSERT INTO student_profiles
                (id,person_id,public_slug,visibility,created_at,updated_at)
                VALUES (:profile_id,:id,:slug,'PUBLIC',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            prepared,
        )


@router.post("/preview")
def preview(
    file: Annotated[UploadFile, File()],
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
    mode: Annotated[Literal["REJECT", "SKIP_EXACT"], Form()] = "REJECT",
) -> dict[str, Any]:
    source = upload(file)
    students = parse_roster(source)
    report: list[dict[str, Any]] = []
    with db.connect() as connection:
        pending = new_students(connection, staff.tenant_id, students, mode, report)
    return {
        "fileHash": hashlib.sha256(source).hexdigest(),
        "students": len(pending),
        "skipped": sum(item["status"] == "SKIPPED" for item in report),
        "conflicts": sum(item["status"] == "CONFLICT" for item in report),
        "rows": report,
    }


@router.post("/import", status_code=201)
def import_roster(
    file: Annotated[UploadFile, File()],
    file_hash: Annotated[str, Form(alias="fileHash")],
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
    mode: Annotated[Literal["REJECT", "SKIP_EXACT"], Form()] = "REJECT",
) -> dict[str, int]:
    source = upload(file)
    if hashlib.sha256(source).hexdigest() != file_hash:
        raise ApiError(409, "ROSTER_FILE_CHANGED", "Workbook changed after preview")
    students = parse_roster(source)
    with db.transaction() as connection:
        # Serialize imports across organizations in the same tenant.
        row(
            connection,
            "SELECT id FROM tenants WHERE id=:id FOR UPDATE",
            {"id": staff.tenant_id},
        )
        organization = row(
            connection,
            "SELECT name FROM organizations WHERE id=:id AND tenant_id=:tenant FOR UPDATE",
            {"id": staff.organization_id, "tenant": staff.tenant_id},
        )
        if not organization:
            raise ApiError(404, "ORGANIZATION_NOT_FOUND", "Organization not found")
        pending = new_students(connection, staff.tenant_id, students, mode)
        skipped = len(students) - len(pending)
        insert_students(
            connection,
            staff.tenant_id,
            organization["name"],
            staff.id,
            pending,
        )
        audit(
            connection,
            staff.id,
            "STUDENT_ROSTER_IMPORTED",
            "Organization",
            staff.organization_id,
            {"students": len(pending), "skipped": skipped, "mode": mode},
        )
    return {"created": len(pending), "skipped": skipped}
