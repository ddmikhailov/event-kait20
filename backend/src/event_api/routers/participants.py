from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy.engine import RowMapping

from ..config import Settings
from ..database import Database, execute, row, rows
from ..dependencies import (
    Staff,
    csrf_super_admin,
    current_staff,
    database,
    settings,
    super_admin,
)
from ..errors import ApiError
from ..registration_service import ticket_url
from ..schemas import PersonUpdate
from ..service_utils import audit, json_value, serial

people = APIRouter(prefix="/admin/people", tags=["people"])
registrations = APIRouter(prefix="/admin/events", tags=["participants"])
scanner = APIRouter(prefix="/scanner/events", tags=["scanner-search"])


def search_pattern(query: str) -> str:
    return f"%{query.replace('%', r'\%').replace('_', r'\_')}%"


def person_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "lastName": item["last_name"],
        "firstName": item["first_name"],
        "middleName": item["middle_name"],
        "birthDate": serial(item["birth_date"]) if item["birth_date"] else None,
        "email": item["email"],
        "phone": item["phone"],
        "studyGroup": item["study_group"],
        "personType": item["person_type"],
        "organization": item["organization"],
        "dedupReviewRequired": bool(item["dedup_review_required"]),
        "createdAt": serial(item["created_at"]),
        "updatedAt": serial(item["updated_at"]),
    }


def registration_response(item: RowMapping) -> dict[str, Any]:
    return {
        "id": item["id"],
        "eventId": item["event_id"],
        "personId": item["person_id"],
        "source": item["source"],
        "status": item["status"],
        "lastName": item["last_name"],
        "firstName": item["first_name"],
        "middleName": item["middle_name"],
        "birthDate": serial(item["birth_date"]) if item["birth_date"] else None,
        "email": item["email"],
        "phone": item["phone"],
        "studyGroup": item["study_group"],
        "personType": item["person_type"],
        "organization": item["organization"],
        "registeredAt": serial(item["registered_at"]),
        "firstAttendedAt": serial(item["first_attended_at"])
        if item["first_attended_at"]
        else None,
        "annulledAt": serial(item["annulled_at"]) if item["annulled_at"] else None,
    }


def assert_shape(data: dict[str, Any]) -> None:
    if str(data["person_type"]).endswith("_STUDENT") and not data.get("study_group"):
        raise ApiError(400, "VALIDATION_ERROR", "Study group is required")
    if str(data["person_type"]).startswith("EXTERNAL_") and not data.get(
        "organization"
    ):
        raise ApiError(400, "VALIDATION_ERROR", "Organization is required")


@people.get("")
def list_people(
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
    query: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    params = {
        "query": query,
        "search": search_pattern(query),
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    where = """merged_into_id IS NULL AND (:query='' OR concat_ws(' ',last_name,first_name,middle_name) LIKE :search
        OR coalesce(email,'') LIKE :search OR coalesce(phone,'') LIKE :search OR coalesce(study_group,'') LIKE :search)"""
    with db.connect() as connection:
        items = rows(
            connection,
            f"SELECT * FROM persons WHERE {where} ORDER BY last_name,first_name,middle_name,id LIMIT :limit OFFSET :offset",
            params,
        )
        count = row(
            connection, f"SELECT count(*) AS count FROM persons WHERE {where}", params
        )
    return {
        "items": [person_response(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": int(count["count"] if count else 0),
    }


@people.get("/{person_id}")
def get_person(
    person_id: UUID,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    with db.connect() as connection:
        item = row(
            connection,
            "SELECT * FROM persons WHERE id=:id AND merged_into_id IS NULL",
            {"id": str(person_id)},
        )
        history = rows(
            connection,
            """SELECT r.id,r.event_id,e.title AS event_title,r.source,r.status,r.registered_at,r.first_attended_at
            FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.person_id=:id ORDER BY r.registered_at DESC,r.id""",
            {"id": str(person_id)},
        )
    if not item:
        raise ApiError(404, "NOT_FOUND", "Person not found")
    return {
        **person_response(item),
        "registrations": [
            {
                "id": entry["id"],
                "eventId": entry["event_id"],
                "eventTitle": entry["event_title"],
                "source": entry["source"],
                "status": entry["status"],
                "registeredAt": serial(entry["registered_at"]),
                "firstAttendedAt": serial(entry["first_attended_at"])
                if entry["first_attended_at"]
                else None,
            }
            for entry in history
        ],
    }


@people.patch("/{person_id}")
def update_person(
    person_id: UUID,
    values: PersonUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    target = str(person_id)
    with db.transaction() as connection:
        existing = row(
            connection,
            "SELECT * FROM persons WHERE id=:id AND merged_into_id IS NULL FOR UPDATE",
            {"id": target},
        )
        if not existing:
            raise ApiError(404, "NOT_FOUND", "Person not found")
        changes = values.model_dump(exclude_unset=True)
        data = {
            key: changes.get(key, existing[key])
            for key in (
                "last_name",
                "first_name",
                "middle_name",
                "birth_date",
                "email",
                "phone",
                "study_group",
                "person_type",
                "organization",
            )
        }
        if str(data["person_type"]).startswith("KAIT_"):
            data["organization"] = "КАИТ №20"
        assert_shape(data)
        execute(
            connection,
            """UPDATE persons SET last_name=:last_name,first_name=:first_name,middle_name=:middle_name,
            birth_date=:birth_date,email=:email,email_normalized=:email,phone=:phone,phone_normalized=:phone,
            study_group=:study_group,person_type=:person_type,organization=:organization,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {**data, "id": target},
        )
        audit(
            connection,
            staff.id,
            "PERSON_UPDATED",
            "Person",
            target,
            {"fields": sorted(values.model_fields_set)},
        )
    return get_person(person_id, staff, db)


def assert_event(connection: Any, event_id: str) -> None:
    if not row(connection, "SELECT id FROM events WHERE id=:id", {"id": event_id}):
        raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")


@registrations.get("/{event_id}/registrations")
def list_registrations(
    event_id: UUID,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
    query: str = Query("", max_length=200),
    status: str | None = Query(None, pattern="^(ACTIVE|ANNULLED)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    params = {
        "event": str(event_id),
        "status": status,
        "query": query,
        "search": search_pattern(query),
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    where = """event_id=:event AND (:status IS NULL OR status=:status) AND (:query='' OR
        concat_ws(' ',last_name,first_name,middle_name) LIKE :search OR coalesce(email,'') LIKE :search
        OR coalesce(phone,'') LIKE :search OR coalesce(study_group,'') LIKE :search)"""
    with db.connect() as connection:
        assert_event(connection, str(event_id))
        items = rows(
            connection,
            f"SELECT * FROM registrations WHERE {where} ORDER BY registered_at DESC,id LIMIT :limit OFFSET :offset",
            params,
        )
        count = row(
            connection,
            f"SELECT count(*) AS count FROM registrations WHERE {where}",
            params,
        )
    return {
        "items": [registration_response(item) for item in items],
        "page": page,
        "pageSize": page_size,
        "total": int(count["count"] if count else 0),
    }


@registrations.get("/{event_id}/registrations/{registration_id}")
def get_registration(
    event_id: UUID,
    registration_id: UUID,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    with db.connect() as connection:
        item = row(
            connection,
            "SELECT * FROM registrations WHERE id=:id AND event_id=:event",
            {"id": str(registration_id), "event": str(event_id)},
        )
        answers = rows(
            connection,
            "SELECT field_id,field_label_snapshot,field_type_snapshot,answer FROM registration_answers WHERE registration_id=:id ORDER BY created_at,id",
            {"id": str(registration_id)},
        )
    if not item:
        raise ApiError(404, "REGISTRATION_NOT_FOUND", "Registration not found")
    return {
        **registration_response(item),
        "answers": [
            {
                "fieldId": answer["field_id"],
                "fieldLabel": answer["field_label_snapshot"],
                "fieldType": answer["field_type_snapshot"],
                "value": json_value(answer["answer"]),
            }
            for answer in answers
        ],
        "ticketUrl": ticket_url(item["public_id"], config),
    }


@registrations.patch("/{event_id}/registrations/{registration_id}")
def update_registration(
    event_id: UUID,
    registration_id: UUID,
    values: PersonUpdate,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
    config: Annotated[Settings, Depends(settings)],
) -> dict[str, Any]:
    rid = str(registration_id)
    with db.transaction() as connection:
        existing = row(
            connection,
            "SELECT * FROM registrations WHERE id=:id AND event_id=:event FOR UPDATE",
            {"id": rid, "event": str(event_id)},
        )
        if not existing:
            raise ApiError(404, "REGISTRATION_NOT_FOUND", "Registration not found")
        if existing["status"] == "ANNULLED":
            raise ApiError(409, "REGISTRATION_ANNULLED", "Registration is annulled")
        changes = values.model_dump(exclude_unset=True)
        data = {
            key: changes.get(key, existing[key])
            for key in (
                "last_name",
                "first_name",
                "middle_name",
                "birth_date",
                "email",
                "phone",
                "study_group",
                "person_type",
                "organization",
            )
        }
        if str(data["person_type"]).startswith("KAIT_"):
            data["organization"] = "КАИТ №20"
        assert_shape(data)
        execute(
            connection,
            """UPDATE registrations SET last_name=:last_name,first_name=:first_name,middle_name=:middle_name,
            birth_date=:birth_date,email=:email,phone=:phone,study_group=:study_group,person_type=:person_type,
            organization=:organization,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {**data, "id": rid},
        )
        execute(
            connection,
            "UPDATE events SET offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:event",
            {"event": str(event_id)},
        )
        audit(
            connection,
            staff.id,
            "REGISTRATION_UPDATED",
            "Registration",
            rid,
            {"fields": sorted(values.model_fields_set)},
        )
    return get_registration(event_id, registration_id, staff, db, config)


@registrations.post(
    "/{event_id}/registrations/{registration_id}/annul", status_code=201
)
def annul(
    event_id: UUID,
    registration_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    with db.transaction() as connection:
        item = row(
            connection,
            "SELECT status FROM registrations WHERE id=:id AND event_id=:event FOR UPDATE",
            {"id": str(registration_id), "event": str(event_id)},
        )
        if not item:
            raise ApiError(404, "REGISTRATION_NOT_FOUND", "Registration not found")
        if item["status"] == "ANNULLED":
            raise ApiError(409, "REGISTRATION_ANNULLED", "Registration is annulled")
        execute(
            connection,
            "UPDATE registrations SET status='ANNULLED',annulled_at=UTC_TIMESTAMP(3),annulled_by=:actor,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
            {"id": str(registration_id), "actor": staff.id},
        )
        execute(
            connection,
            "UPDATE events SET offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:event",
            {"event": str(event_id)},
        )
        audit(
            connection,
            staff.id,
            "REGISTRATION_ANNULLED",
            "Registration",
            str(registration_id),
        )
    return {"status": "accepted"}


@registrations.post(
    "/{event_id}/registrations/{registration_id}/resend-ticket", status_code=201
)
def resend(
    event_id: UUID,
    registration_id: UUID,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, str]:
    with db.transaction() as connection:
        item = row(
            connection,
            "SELECT email,status FROM registrations WHERE id=:id AND event_id=:event FOR UPDATE",
            {"id": str(registration_id), "event": str(event_id)},
        )
        if not item:
            raise ApiError(404, "REGISTRATION_NOT_FOUND", "Registration not found")
        if item["status"] == "ANNULLED":
            raise ApiError(409, "REGISTRATION_ANNULLED", "Registration is annulled")
        if not item["email"]:
            raise ApiError(409, "CONFLICT", "Registration has no email recipient")
        delivery = str(uuid4())
        execute(
            connection,
            """INSERT INTO email_deliveries
            (id,idempotency_key,type,recipient_email,event_id,registration_id,status,attempts,queued_at,created_at,updated_at)
            VALUES (:id,:key,'REGISTRATION_TICKET',:email,:event,:registration,'QUEUED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
            {
                "id": delivery,
                "key": f"registration-ticket:manual:{registration_id}:{delivery}",
                "email": item["email"],
                "event": str(event_id),
                "registration": str(registration_id),
            },
        )
        audit(
            connection,
            staff.id,
            "REGISTRATION_TICKET_QUEUED",
            "Registration",
            str(registration_id),
        )
    return {"status": "accepted"}


@scanner.get("/{event_id}/registrations/search")
def scanner_search(
    event_id: UUID,
    staff: Annotated[Staff, Depends(current_staff)],
    db: Annotated[Database, Depends(database)],
    query: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, alias="pageSize", ge=1, le=100),
) -> dict[str, Any]:
    params = {
        "event": str(event_id),
        "query": query,
        "search": search_pattern(query),
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    where = """event_id=:event AND status='ACTIVE' AND (:query='' OR concat_ws(' ',last_name,first_name,middle_name) LIKE :search
        OR coalesce(email,'') LIKE :search OR coalesce(phone,'') LIKE :search OR coalesce(study_group,'') LIKE :search)"""
    with db.connect() as connection:
        assert_event(connection, str(event_id))
        if staff.role == "SCANNER" and not row(
            connection,
            "SELECT 1 FROM event_access WHERE event_id=:event AND user_id=:user",
            {"event": str(event_id), "user": staff.id},
        ):
            raise ApiError(403, "FORBIDDEN", "Event access is required")
        items = rows(
            connection,
            f"SELECT * FROM registrations WHERE {where} ORDER BY last_name,first_name,middle_name,id LIMIT :limit OFFSET :offset",
            params,
        )
        count = row(
            connection,
            f"SELECT count(*) AS count FROM registrations WHERE {where}",
            params,
        )
    return {
        "items": [
            {
                "id": item["id"],
                "lastName": item["last_name"],
                "firstName": item["first_name"],
                "middleName": item["middle_name"],
                "phone": item["phone"],
                "studyGroup": item["study_group"],
                "personType": item["person_type"],
                "organization": item["organization"],
                "firstAttendedAt": serial(item["first_attended_at"])
                if item["first_attended_at"]
                else None,
            }
            for item in items
        ],
        "page": page,
        "pageSize": page_size,
        "total": int(count["count"] if count else 0),
    }
