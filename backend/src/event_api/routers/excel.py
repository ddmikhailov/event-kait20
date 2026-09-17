from __future__ import annotations

import hashlib
import io
import json
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from sqlalchemy.engine import RowMapping

from ..config import Settings
from ..database import Database, execute, row, rows
from ..dependencies import Staff, administrator, csrf_administrator, database, settings
from ..errors import ApiError
from ..form_config import validate_system_fields
from ..registration_service import (
    create_person,
    create_registration,
    find_or_create_person,
    form_fields,
    participant,
    persist_answers,
    validate_answers,
    validate_participant_type,
)
from ..schemas import ExcelCommitRequest, ParticipantValues
from ..service_utils import audit, db_json, json_value
from ..streams import selected_stream

router = APIRouter(prefix="/admin/events", tags=["excel"])
MAX_FILE = 5 * 1024 * 1024
MAX_ROWS = 5_000
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
HEADERS = {
    "streamTitle": "Поток",
    "lastName": "Фамилия",
    "firstName": "Имя",
    "middleName": "Отчество",
    "birthDate": "Дата рождения",
    "personType": "Тип участника",
    "studyGroup": "Группа",
    "organization": "Организация",
    "phone": "Телефон",
    "email": "Email",
}
PERSON_TYPES = {
    "студент каит №20": "KAIT_STUDENT",
    "сотрудник каит №20": "KAIT_TEACHER",
    "студент другой организации": "EXTERNAL_STUDENT",
    "сотрудник другой организации": "EXTERNAL_TEACHER",
    "родитель": "PARENT",
    "другое": "OTHER",
}


def _safe(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = ILLEGAL_CHARACTERS_RE.sub("", value)
    return f"'{value}" if value.startswith(("=", "+", "-", "@")) else value


def _export_answer(value: Any) -> Any:
    value = json_value(value)
    if isinstance(value, bool):
        return "Да" if value else "Нет"
    if isinstance(value, list):
        return "; ".join(str(item) for item in value)
    if isinstance(value, (dict, tuple)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def _custom_headers(fields: Sequence[Any]) -> list[str]:
    seen: dict[str, int] = {}
    result = []
    for field in fields:
        base = f"Поле: {field['label']}"
        key = base.casefold()
        seen[key] = seen.get(key, 0) + 1
        result.append(base if seen[key] == 1 else f"{base} ({seen[key]})")
    return result


def _validate_upload(file: UploadFile) -> None:
    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx") or file.content_type != XLSX_MIME:
        raise ApiError(400, "VALIDATION_ERROR", "Only an XLSX file is accepted")


def _mapping(
    headers: list[str],
    supplied: str | None,
    fields: Sequence[Any] = (),
) -> dict[str, Any]:
    if supplied:
        try:
            result = json.loads(supplied)
        except json.JSONDecodeError as error:
            raise ApiError(
                400, "VALIDATION_ERROR", "Column mapping must be valid JSON"
            ) from error
        if not isinstance(result, dict):
            raise ApiError(400, "VALIDATION_ERROR", "Column mapping must be an object")
    else:
        result = {key: label for key, label in HEADERS.items() if label in headers}
        result["customFields"] = {
            str(field["id"]): header
            for field, header in zip(fields, _custom_headers(fields), strict=True)
            if header in headers
        }
    for required in ("lastName", "firstName"):
        if result.get(required) not in headers:
            raise ApiError(
                400,
                "VALIDATION_ERROR",
                f"Required column is missing: {HEADERS[required]}",
            )
    mapped = [value for key, value in result.items() if key != "customFields" and value]
    mapped.extend((result.get("customFields") or {}).values())
    if len(set(mapped)) != len(mapped) or any(value not in headers for value in mapped):
        raise ApiError(400, "VALIDATION_ERROR", "Column mapping is invalid")
    result.setdefault("customFields", {})
    return result


def _date(value: Any) -> str | None:
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    text = str(value or "").strip()
    for pattern in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            pass
    return None


def _cell_text(by_header: dict[str, Any], mapping: dict[str, Any], key: str) -> str:
    return str(by_header[mapping[key]].value or "").strip() if mapping.get(key) else ""


def _person_type(value: str) -> str:
    return PERSON_TYPES.get(value.casefold(), value.upper()) if value else "OTHER"


def _answer_value(field: Any, value: Any) -> str | bool | list[str] | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if field["type"] == "BOOLEAN":
        if isinstance(value, bool):
            return value
        normalized = str(value).strip().casefold()
        if normalized in {"да", "true", "1"}:
            return True
        if normalized in {"нет", "false", "0"}:
            return False
        raise ValueError("boolean")
    if field["type"] == "MULTI_CHOICE":
        return [item.strip() for item in str(value).split(";") if item.strip()]
    return str(value).strip()


def _parse(
    source: bytes,
    supplied_mapping: str | None = None,
    fields: Sequence[Any] = (),
) -> tuple[list[str], dict[str, Any], list[dict[str, Any]]]:
    if not source or len(source) > MAX_FILE or not source.startswith(b"PK"):
        raise ApiError(400, "VALIDATION_ERROR", "A valid XLSX up to 5 MiB is required")
    try:
        workbook = load_workbook(io.BytesIO(source), data_only=False, read_only=False)
    except Exception as error:
        raise ApiError(
            400, "VALIDATION_ERROR", "XLSX workbook could not be read"
        ) from error
    sheets = [sheet for sheet in workbook.worksheets if sheet.max_row > 0]
    if len(sheets) != 1 or sheets[0].merged_cells.ranges:
        raise ApiError(
            400, "VALIDATION_ERROR", "Workbook must contain one unmerged worksheet"
        )
    sheet = sheets[0]
    headers = [str(cell.value or "").strip() for cell in sheet[1]]
    if (
        not headers
        or any(not item for item in headers)
        or len(set(item.casefold() for item in headers)) != len(headers)
    ):
        raise ApiError(
            400, "VALIDATION_ERROR", "Header names must be non-empty and unique"
        )
    mapping = _mapping(headers, supplied_mapping, fields)
    fields_by_id = {str(field["id"]): field for field in fields}
    parsed: list[dict[str, Any]] = []
    for number, values in enumerate(
        sheet.iter_rows(min_row=2, values_only=False), start=2
    ):
        if all(cell.value in (None, "") for cell in values):
            continue
        if len(parsed) >= MAX_ROWS:
            raise ApiError(
                400, "VALIDATION_ERROR", "Workbook contains more than 5000 rows"
            )
        by_header = dict(zip(headers, values, strict=False))
        errors = [
            f"Формула не разрешена: {header}"
            for header, cell in by_header.items()
            if cell.data_type == "f"
        ]

        raw = {
            "lastName": _cell_text(by_header, mapping, "lastName"),
            "firstName": _cell_text(by_header, mapping, "firstName"),
            "middleName": _cell_text(by_header, mapping, "middleName") or None,
            "birthDate": _date(by_header[mapping["birthDate"]].value)
            if mapping.get("birthDate")
            else None,
            "personType": _person_type(_cell_text(by_header, mapping, "personType")),
            "studyGroup": _cell_text(by_header, mapping, "studyGroup") or None,
            "organization": _cell_text(by_header, mapping, "organization") or None,
            "phone": _cell_text(by_header, mapping, "phone") or None,
            "email": _cell_text(by_header, mapping, "email") or None,
        }
        custom_answers: list[dict[str, Any]] = []
        for field_id, header in mapping["customFields"].items():
            field = fields_by_id.get(str(field_id))
            if not field:
                errors.append(f"Неизвестное дополнительное поле: {field_id}")
                continue
            try:
                answer = _answer_value(field, by_header[header].value)
                if answer is not None:
                    custom_answers.append({"fieldId": field_id, "value": answer})
            except ValueError:
                errors.append(
                    f"Поле «{field['label']}» содержит значение неверного типа"
                )
        try:
            values_model = ParticipantValues.model_validate(
                {**raw, "customAnswers": custom_answers}
            )
        except Exception:
            values_model = None
            errors.append("Данные участника не прошли проверку")
        parsed.append(
            {
                "rowNumber": number,
                "streamTitle": _cell_text(by_header, mapping, "streamTitle"),
                "participant": raw,
                "values": values_model,
                "errors": errors,
            }
        )
    if not parsed:
        raise ApiError(400, "VALIDATION_ERROR", "Workbook has no data rows")
    return headers, mapping, parsed


def _event(
    connection: Any,
    event_id: str,
    lock: bool = False,
    *,
    allow_archived: bool = False,
    tenant_id: str | None = None,
) -> Any:
    tenant_join = " JOIN organizations o ON o.id=e.organization_id" if tenant_id else ""
    tenant_filter = " AND o.tenant_id=:tenant" if tenant_id else ""
    item = row(
        connection,
        f"SELECT e.* FROM events e{tenant_join} WHERE e.id=:id{tenant_filter}"
        f"{' FOR UPDATE' if lock else ''}",
        {"id": event_id, "tenant": tenant_id},
    )
    if not item:
        raise ApiError(404, "NOT_FOUND", "Event not found")
    if item["status"] == "ARCHIVED" and not allow_archived:
        raise ApiError(409, "CONFLICT", "Archived Event cannot be imported")
    return item


def _classify(
    connection: Any,
    event_id: str,
    parsed: list[dict[str, Any]],
    fields: list[RowMapping],
) -> list[dict[str, Any]]:
    result = []
    event = _event(connection, event_id)
    scope = row(
        connection,
        "SELECT tenant_id FROM organizations WHERE id=:id",
        {"id": event["organization_id"]},
    )
    if not scope:
        raise ApiError(404, "NOT_FOUND", "Event not found")
    streams = rows(
        connection,
        "SELECT id,title FROM event_streams WHERE event_id=:event",
        {"event": event_id},
    )
    for item in parsed:
        if not item["errors"]:
            try:
                matched = [
                    stream
                    for stream in streams
                    if stream["title"] == item.get("streamTitle")
                ]
                stream_id = str(matched[0]["id"]) if len(matched) == 1 else None
                selected_stream(connection, event, stream_id)
                item["values"].stream_id = UUID(stream_id) if stream_id else None
            except ApiError:
                item = {
                    **item,
                    "errors": [
                        "Укажите в колонке «Поток» точное название доступного потока"
                    ],
                }
        if not item["errors"]:
            try:
                validate_system_fields(event, item["values"], "onsite")
                validate_answers(fields, item["values"], onsite=True)
                validate_participant_type(
                    event, str(item["values"].person_type or "OTHER")
                )
            except ApiError:
                item = {
                    **item,
                    "errors": [
                        "Проверьте обязательные поля и допустимый статус участника"
                    ],
                }
        category, candidates = ("ERROR", []) if item["errors"] else ("NEW", [])
        if not item["errors"]:
            value = item["values"]
            people = rows(
                connection,
                """SELECT p.id,p.last_name,p.first_name,p.middle_name,p.email_normalized,p.phone_normalized,p.birth_date,
                EXISTS(SELECT 1 FROM registrations r WHERE r.person_id=p.id AND r.event_id=:event AND r.status='ACTIVE') active
                FROM persons p WHERE p.tenant_id=:tenant AND p.merged_into_id IS NULL
                AND lower(p.last_name)=lower(:last)
                AND lower(p.first_name)=lower(:first) LIMIT 10""",
                {
                    "event": event_id,
                    "tenant": scope["tenant_id"],
                    "last": value.last_name,
                    "first": value.first_name,
                },
            )
            if any(
                person["active"]
                and (person["middle_name"] or "").casefold()
                == (value.middle_name or "").casefold()
                and (
                    (
                        value.email
                        and person["email_normalized"] == str(value.email).lower()
                    )
                    or (value.phone and person["phone_normalized"] == value.phone)
                    or (value.birth_date and person["birth_date"] == value.birth_date)
                )
                for person in people
            ):
                category = "ALREADY_REGISTERED"
            elif people:
                category = "POSSIBLE_MATCH"
                candidates = [
                    {
                        "personId": person["id"],
                        "displayName": " ".join(
                            filter(
                                None,
                                (
                                    person["last_name"],
                                    person["first_name"],
                                    person["middle_name"],
                                ),
                            )
                        ),
                        "matchReason": "PROFILE_SIMILARITY",
                    }
                    for person in people
                ]
        result.append({**item, "category": category, "candidates": candidates})
    return result


@router.post("/{event_id}/import/preview", status_code=201)
async def preview(
    event_id: UUID,
    file: Annotated[UploadFile, File()],
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
    mapping: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    _validate_upload(file)
    source = await file.read(MAX_FILE + 1)
    expires = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=24)
    with db.transaction() as connection:
        event = _event(connection, str(event_id), tenant_id=staff.tenant_id)
        fields = form_fields(connection, str(event_id))
        headers, resolved, parsed = _parse(source, mapping, fields)
        classified = _classify(connection, str(event_id), parsed, fields)
        active_row = row(
            connection,
            "SELECT count(*) count FROM registrations WHERE event_id=:event AND status='ACTIVE'",
            {"event": str(event_id)},
        )
        active = int(active_row["count"] if active_row else 0)

        def count(category: str) -> int:
            return sum(item["category"] == category for item in classified)

        summary = {
            "totalRows": len(classified),
            "newRows": count("NEW"),
            "alreadyRegisteredRows": count("ALREADY_REGISTERED"),
            "possibleMatchRows": count("POSSIBLE_MATCH"),
            "errorRows": count("ERROR"),
            "withoutEmailRows": sum(
                not item["participant"]["email"] for item in classified
            ),
            "capacityImpact": count("NEW") + count("POSSIBLE_MATCH"),
            "activeRegistrations": active,
            "capacity": event["capacity"],
            "exceedsCapacity": active + count("NEW") + count("POSSIBLE_MATCH")
            > event["capacity"],
        }
        if event["streams_enabled"]:
            impacts: dict[str, int] = {}
            for item in classified:
                if item["category"] in {"NEW", "POSSIBLE_MATCH"}:
                    key = str(item["values"].stream_id)
                    impacts[key] = impacts.get(key, 0) + 1
            summary["exceedsCapacity"] = any(
                int(item["registered"]) + impacts.get(str(item["id"]), 0)
                > int(item["capacity"])
                for item in rows(
                    connection,
                    """SELECT s.id,s.capacity,COUNT(r.id) AS registered
                    FROM event_streams s LEFT JOIN registrations r ON r.stream_id=s.id AND r.status='ACTIVE'
                    WHERE s.event_id=:event GROUP BY s.id""",
                    {"event": str(event_id)},
                )
            )
        job_id = str(uuid4())
        execute(
            connection,
            """INSERT INTO import_jobs (id,event_id,created_by,status,total_rows,valid_rows,error_rows,duplicate_rows,result_summary,expires_at,created_at,updated_at)
            VALUES (:id,:event,:actor,'PREVIEW_READY',:total,:valid,:errors,:duplicates,:summary,:expires,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": job_id,
                "event": str(event_id),
                "actor": staff.id,
                "total": len(classified),
                "valid": len(classified) - count("ERROR"),
                "errors": count("ERROR"),
                "duplicates": count("ALREADY_REGISTERED"),
                "summary": db_json(summary),
                "expires": expires,
            },
        )
        execute(
            connection,
            "INSERT INTO import_job_files(import_job_id,file_data,sha256,created_at,expires_at) VALUES (:id,:data,:hash,UTC_TIMESTAMP(3),:expires)",
            {
                "id": job_id,
                "data": source,
                "hash": hashlib.sha256(source).hexdigest(),
                "expires": expires,
            },
        )
    return {
        "importJobId": job_id,
        "expiresAt": expires.replace(tzinfo=UTC).isoformat(),
        "headers": headers,
        "mapping": resolved,
        "summary": summary,
        "rows": [
            {
                key: item[key]
                for key in (
                    "rowNumber",
                    "category",
                    "errors",
                    "participant",
                    "candidates",
                )
            }
            for item in classified
        ],
    }


@router.post("/{event_id}/import/{job_id}/commit")
def commit(
    event_id: UUID,
    job_id: UUID,
    values: ExcelCommitRequest,
    staff: Annotated[Staff, Depends(csrf_administrator)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    body = values.model_dump(mode="json", by_alias=True, exclude_none=True)
    decisions = {int(item["rowNumber"]): item for item in body.get("decisions", [])}
    with db.transaction() as connection:
        job = row(
            connection,
            """SELECT j.*,f.file_data FROM import_jobs j LEFT JOIN import_job_files f ON f.import_job_id=j.id
            WHERE j.id=:id AND j.event_id=:event FOR UPDATE""",
            {"id": str(job_id), "event": str(event_id)},
        )
        if (
            not job
            or job["status"] != "PREVIEW_READY"
            or job["expires_at"] <= datetime.now(UTC).replace(tzinfo=None)
            or not job["file_data"]
        ):
            raise ApiError(409, "CONFLICT", "Import preview is no longer available")
        mapping_json = json.dumps(body.get("mapping", {}), ensure_ascii=False)
        fields = form_fields(connection, str(event_id))
        _, _, parsed = _parse(bytes(job["file_data"]), mapping_json, fields)
        classified = _classify(connection, str(event_id), parsed, fields)
        event = _event(connection, str(event_id), True, tenant_id=staff.tenant_id)
        imported = skipped = duplicates = errors = without_email = 0
        for item in classified:
            if item["category"] == "ERROR":
                errors += 1
                continue
            if item["category"] == "ALREADY_REGISTERED":
                duplicates += 1
                continue
            decision = decisions.get(item["rowNumber"])
            if item["category"] == "POSSIBLE_MATCH" and not decision:
                raise ApiError(409, "CONFLICT", "Every possible match needs a decision")
            if decision and decision.get("action") == "SKIP":
                skipped += 1
                continue
            validate_system_fields(event, item["values"], "onsite")
            validate_answers(fields, item["values"], onsite=True)
            validate_participant_type(event, str(item["values"].person_type or "OTHER"))
            stream = selected_stream(
                connection,
                event,
                str(item["values"].stream_id) if item["values"].stream_id else None,
            )
            data = participant(item["values"])
            if decision and decision.get("action") == "USE_PERSON":
                person_id = str(decision["personId"])
                candidate_ids = {
                    str(candidate["personId"]) for candidate in item["candidates"]
                }
                if person_id not in candidate_ids:
                    raise ApiError(
                        409,
                        "CONFLICT",
                        "Selected Person is not a candidate for this import row",
                    )
            elif decision and decision.get("action") == "CREATE_NEW":
                person_id = create_person(
                    connection,
                    data,
                    staff.tenant_id,
                    dedup_review_required=True,
                )
            else:
                person_id = find_or_create_person(connection, data, staff.tenant_id)
            existing = row(
                connection,
                "SELECT id FROM registrations WHERE event_id=:event AND person_id=:person AND status='ACTIVE'",
                {"event": str(event_id), "person": person_id},
            )
            if existing:
                duplicates += 1
                continue
            active_row = row(
                connection,
                "SELECT count(*) count FROM registrations WHERE event_id=:event AND status='ACTIVE'",
                {"event": str(event_id)},
            )
            active = int(active_row["count"] if active_row else 0)
            if (
                stream is None
                and active >= int(event["capacity"])
                and not body.get("capacityOverride", False)
            ):
                raise ApiError(
                    409, "CAPACITY_FULL", "Import would exceed Event capacity"
                )
            if stream:
                occupied = row(
                    connection,
                    "SELECT COUNT(*) AS total FROM registrations WHERE stream_id=:id AND status='ACTIVE'",
                    {"id": stream["id"]},
                )
                if int(occupied["total"] if occupied else 0) >= stream[
                    "capacity"
                ] and not body.get("capacityOverride", False):
                    raise ApiError(
                        409, "CAPACITY_FULL", "Import would exceed stream capacity"
                    )
            registration_id, _ = create_registration(
                connection,
                str(event_id),
                person_id,
                data,
                "EXCEL_IMPORT",
                False,
                config,
                stream["id"] if stream else None,
            )
            persist_answers(connection, registration_id, fields, item["values"])
            imported += 1
            without_email += not bool(data["email"])
        result = {
            "importJobId": str(job_id),
            "importedRows": imported,
            "skippedRows": skipped,
            "duplicateRows": duplicates,
            "errorRows": errors,
            "withoutEmailRows": without_email,
        }
        audit(
            connection,
            staff.id,
            "IMPORT_COMMITTED",
            "ImportJob",
            str(job_id),
            {**result, "capacityOverride": values.capacity_override},
        )
        execute(
            connection,
            "UPDATE import_jobs SET status='COMPLETED',result_summary=:summary,committed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": str(job_id), "summary": db_json(result)},
        )
        execute(
            connection,
            "DELETE FROM import_job_files WHERE import_job_id=:id",
            {"id": str(job_id)},
        )
    return result


@router.get("/{event_id}/export.xlsx")
def export(
    event_id: UUID,
    staff: Annotated[Staff, Depends(administrator)],
    db: Annotated[Database, Depends(database)],
) -> StreamingResponse:
    with db.connect() as connection:
        event = _event(
            connection,
            str(event_id),
            allow_archived=True,
            tenant_id=staff.tenant_id,
        )
        registrations = rows(
            connection,
            """SELECT r.*,s.title AS stream_title,s.start_at AS stream_start,
            p.status AS participation_status,pr.name AS participation_role,
            pres.name AS participation_result,
            COALESCE((SELECT SUM(st.points) FROM score_transactions st WHERE st.participation_id=p.id),0) AS score_awarded
            FROM registrations r LEFT JOIN event_streams s ON s.id=r.stream_id
            LEFT JOIN participations p ON p.registration_id=r.id
            LEFT JOIN participation_roles pr ON pr.id=p.role_id
            LEFT JOIN participation_results pres ON pres.id=p.result_id
            WHERE r.event_id=:event ORDER BY r.registered_at,r.id""",
            {"event": str(event_id)},
        )
        fields = rows(
            connection,
            """SELECT id,label FROM event_form_fields
               WHERE event_id=:event ORDER BY sort_order,created_at,id""",
            {"event": str(event_id)},
        )
        answers = rows(
            connection,
            """SELECT a.registration_id,a.field_id,a.answer
               FROM registration_answers a
               JOIN registrations r ON r.id=a.registration_id
               WHERE r.event_id=:event""",
            {"event": str(event_id)},
        )
    answer_by_registration = {
        (answer["registration_id"], answer["field_id"]): _export_answer(
            answer["answer"]
        )
        for answer in answers
    }
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = "Участники"
    columns = [
        "Фамилия",
        "Имя",
        "Отчество",
        "Дата рождения",
        "Тип участника",
        "Группа",
        "Организация",
        "Телефон",
        "Email",
        "Статус",
        "Источник регистрации",
        "Регистрация",
        "Посетил мероприятие",
        "Первое посещение",
        "Поток",
        "Начало потока (МСК UTC+3)",
        "Статус участия",
        "Роль участия",
        "Результат участия",
        "Начисленные баллы",
        *_custom_headers(fields),
    ]
    sheet.append(columns)
    for item in registrations:
        sheet.append(
            [
                _safe(value)
                for value in (
                    item["last_name"],
                    item["first_name"],
                    item["middle_name"],
                    item["birth_date"],
                    item["person_type"],
                    item["study_group"],
                    item["organization"],
                    item["phone"],
                    item["email"],
                    item["status"],
                    item["source"],
                    item["registered_at"],
                    "Да" if item["first_attended_at"] else "Нет",
                    item["first_attended_at"],
                    item["stream_title"],
                    item["stream_start"] + timedelta(hours=3)
                    if item["stream_start"]
                    else None,
                    item["participation_status"] or "DRAFT",
                    item["participation_role"],
                    item["participation_result"],
                    int(item["score_awarded"] or 0),
                    *(
                        answer_by_registration.get((item["id"], field["id"]))
                        for field in fields
                    ),
                )
            ]
        )
    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)
    filename = f"event-{event['slug']}-participants.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )
