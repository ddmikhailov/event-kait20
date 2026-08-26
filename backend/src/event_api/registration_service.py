import hashlib
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.engine import Connection, RowMapping

from .config import Settings
from .database import execute, row, rows
from .dependencies import Staff
from .errors import ApiError
from .schemas import ParticipantValues
from .security import registration_qr, registration_signature
from .service_utils import audit, db_json, json_value

KAIT_ORGANIZATION = "КАИТ №20"


def ticket_url(public_id: str, config: Settings) -> str:
    base = str(config.public_web_base_url).rstrip("/")
    return f"{base}/tickets/{public_id}/{registration_signature(public_id, config.qr_signing_secret)}"


def participant(values: ParticipantValues) -> dict[str, Any]:
    person_type = str(values.person_type)
    return {
        "last_name": values.last_name,
        "first_name": values.first_name,
        "middle_name": values.middle_name,
        "birth_date": values.birth_date,
        "email": str(values.email).lower() if values.email else None,
        "phone": values.phone,
        "study_group": values.study_group if person_type.endswith("_STUDENT") else None,
        "person_type": person_type,
        "organization": values.organization
        if person_type.startswith("EXTERNAL_")
        else KAIT_ORGANIZATION,
    }


def form_fields(connection: Connection, event_id: str) -> list[RowMapping]:
    return list(
        rows(
            connection,
            """SELECT id,type,label,required,sort_order,options
        FROM event_form_fields WHERE event_id=:event AND active=true
        ORDER BY sort_order,created_at""",
            {"event": event_id},
        )
    )


def validate_answers(fields: list[RowMapping], values: ParticipantValues) -> None:
    by_id = {field["id"]: field for field in fields}
    answers = {str(answer.field_id): answer.value for answer in values.custom_answers}
    for field_id, value in answers.items():
        field = by_id.get(field_id)
        if not field or not valid_answer(field, value):
            raise ApiError(409, "FORM_VERSION_INVALID", "Registration form has changed")
    if any(field["required"] and field["id"] not in answers for field in fields):
        raise ApiError(409, "FORM_VERSION_INVALID", "Registration form has changed")


def valid_answer(field: RowMapping, value: Any) -> bool:
    options = json_value(field["options"])
    if not isinstance(options, list):
        options = []
    if field["type"] == "BOOLEAN":
        return isinstance(value, bool)
    if field["type"] == "MULTI_CHOICE":
        return (
            isinstance(value, list)
            and len(value) == len(set(value))
            and all(isinstance(item, str) and item in options for item in value)
        )
    if not isinstance(value, str):
        return False
    return value in options if field["type"] == "SINGLE_CHOICE" else bool(value.strip())


def acquire_person_locks(connection: Connection, data: dict[str, Any]) -> list[str]:
    name = "|".join(
        [
            data["last_name"].lower(),
            data["first_name"].lower(),
            (data["middle_name"] or "").lower(),
        ]
    )
    keys = sorted(
        [
            *([f"{name}|email:{data['email']}"] if data["email"] else []),
            f"{name}|phone:{data['phone']}",
            f"{name}|birth:{data['birth_date'].isoformat()}",
        ]
    )
    acquired: list[str] = []
    for key in keys:
        result = row(
            connection, "SELECT GET_LOCK(SHA2(:key,256),5) AS acquired", {"key": key}
        )
        if not result or int(result["acquired"] or 0) != 1:
            release_person_locks(connection, acquired)
            raise ApiError(409, "CONFLICT", "Registration is busy; retry")
        acquired.append(key)
    return acquired


def release_person_locks(connection: Connection, keys: list[str]) -> None:
    for key in reversed(keys):
        row(connection, "SELECT RELEASE_LOCK(SHA2(:key,256))", {"key": key})


def find_or_create_person(connection: Connection, data: dict[str, Any]) -> str:
    candidates = rows(
        connection,
        """SELECT id FROM persons WHERE merged_into_id IS NULL
        AND lower(last_name)=lower(:last) AND lower(first_name)=lower(:first)
        AND ((:middle IS NULL AND middle_name IS NULL) OR lower(middle_name)=lower(:middle))
        AND (email_normalized=:email OR phone_normalized=:phone OR birth_date=:birth)
        FOR UPDATE""",
        {
            "last": data["last_name"],
            "first": data["first_name"],
            "middle": data["middle_name"],
            "email": data["email"],
            "phone": data["phone"],
            "birth": data["birth_date"],
        },
    )
    ids = list(dict.fromkeys(item["id"] for item in candidates))
    if len(ids) == 1:
        person_id = ids[0]
        execute(
            connection,
            """UPDATE persons SET last_name=:last_name,first_name=:first_name,
            middle_name=:middle_name,birth_date=:birth_date,email=:email,email_normalized=:email,
            phone=:phone,phone_normalized=:phone,person_type=:person_type,organization=:organization,
            study_group=:study_group,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
            {**data, "id": person_id},
        )
        return person_id
    person_id = str(uuid4())
    execute(
        connection,
        """INSERT INTO persons
        (id,last_name,first_name,middle_name,birth_date,email,email_normalized,phone,
         phone_normalized,person_type,organization,study_group,dedup_review_required,
         created_at,updated_at)
        VALUES (:id,:last_name,:first_name,:middle_name,:birth_date,:email,:email,:phone,
                :phone,:person_type,:organization,:study_group,:review,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {**data, "id": person_id, "review": len(ids) > 1},
    )
    return person_id


def create_registration(
    connection: Connection,
    event_id: str,
    person_id: str,
    data: dict[str, Any],
    source: str,
    consent: bool,
    config: Settings,
) -> tuple[str, str]:
    registration_id, public_id = str(uuid4()), str(uuid4())
    execute(
        connection,
        """INSERT INTO registrations
        (id,public_id,event_id,person_id,source,status,last_name,first_name,middle_name,
         birth_date,email,phone,study_group,person_type,organization,consent_accepted,
         consent_version,consent_url,consent_accepted_at,registered_at,created_at,updated_at)
        VALUES (:id,:public,:event,:person,:source,'ACTIVE',:last_name,:first_name,:middle_name,
                :birth_date,:email,:phone,:study_group,:person_type,:organization,:consent,
                :consent_version,:consent_url,:consent_at,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {
            **data,
            "id": registration_id,
            "public": public_id,
            "event": event_id,
            "person": person_id,
            "source": source,
            "consent": consent,
            "consent_version": config.consent_version if consent else None,
            "consent_url": str(config.consent_url) if consent else None,
            "consent_at": datetime.now(UTC).replace(tzinfo=None) if consent else None,
        },
    )
    return registration_id, public_id


def update_registration(
    connection: Connection,
    registration_id: str,
    data: dict[str, Any],
    refresh_consent: bool,
    config: Settings,
) -> None:
    execute(
        connection,
        """UPDATE registrations SET last_name=:last_name,first_name=:first_name,
        middle_name=:middle_name,birth_date=:birth_date,email=:email,phone=:phone,
        study_group=:study_group,person_type=:person_type,organization=:organization,
        consent_accepted=CASE WHEN :refresh THEN true ELSE consent_accepted END,
        consent_version=CASE WHEN :refresh THEN :version ELSE consent_version END,
        consent_url=CASE WHEN :refresh THEN :url ELSE consent_url END,
        consent_accepted_at=CASE WHEN :refresh THEN UTC_TIMESTAMP(3) ELSE consent_accepted_at END,
        updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
        {
            **data,
            "id": registration_id,
            "refresh": refresh_consent,
            "version": config.consent_version,
            "url": str(config.consent_url),
        },
    )


def persist_answers(
    connection: Connection,
    registration_id: str,
    fields: list[RowMapping],
    values: ParticipantValues,
) -> None:
    by_id = {field["id"]: field for field in fields}
    for answer in values.custom_answers:
        field = by_id[str(answer.field_id)]
        execute(
            connection,
            """INSERT INTO registration_answers
            (id,registration_id,field_id,field_label_snapshot,field_type_snapshot,answer,created_at,updated_at)
            VALUES (:id,:registration,:field,:label,:type,:answer,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE field_label_snapshot=VALUES(field_label_snapshot),
            field_type_snapshot=VALUES(field_type_snapshot),answer=VALUES(answer),updated_at=UTC_TIMESTAMP(3)""",
            {
                "id": str(uuid4()),
                "registration": registration_id,
                "field": field["id"],
                "label": field["label"],
                "type": field["type"],
                "answer": db_json(answer.value),
            },
        )


def queue_ticket(
    connection: Connection, event_id: str, registration_id: str, email: str
) -> None:
    delivery_id = str(uuid4())
    execute(
        connection,
        """INSERT INTO email_deliveries
        (id,idempotency_key,type,recipient_email,event_id,registration_id,status,
         attempts,queued_at,created_at,updated_at)
        VALUES (:id,:key,'REGISTRATION_TICKET',:email,:event,:registration,'QUEUED',
                0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {
            "id": delivery_id,
            "key": f"registration-ticket:{registration_id}:{delivery_id}",
            "email": email,
            "event": event_id,
            "registration": registration_id,
        },
    )


def register(
    connection: Connection,
    event: RowMapping,
    values: ParticipantValues,
    config: Settings,
    source: str,
    consent: bool,
    actor: Staff | None,
    capacity_override: bool,
) -> dict[str, Any]:
    data = participant(values)
    fields = form_fields(connection, event["id"])
    validate_answers(fields, values)
    person_id = find_or_create_person(connection, data)
    existing = row(
        connection,
        """SELECT id,public_id FROM registrations
        WHERE event_id=:event AND person_id=:person AND status='ACTIVE' FOR UPDATE""",
        {"event": event["id"], "person": person_id},
    )
    if existing:
        update_registration(connection, existing["id"], data, consent, config)
        persist_answers(connection, existing["id"], fields, values)
        if data["email"]:
            queue_ticket(connection, event["id"], existing["id"], data["email"])
        registration_id, public_id, status = (
            existing["id"],
            existing["public_id"],
            "ALREADY_REGISTERED",
        )
    else:
        count = row(
            connection,
            "SELECT count(*) AS count FROM registrations WHERE event_id=:event AND status='ACTIVE'",
            {"event": event["id"]},
        )
        if (
            int(count["count"] if count else 0) >= int(event["capacity"])
            and not capacity_override
        ):
            raise ApiError(409, "CAPACITY_FULL", "Event capacity is full")
        registration_id, public_id = create_registration(
            connection, event["id"], person_id, data, source, consent, config
        )
        persist_answers(connection, registration_id, fields, values)
        if data["email"]:
            queue_ticket(connection, event["id"], registration_id, data["email"])
        status = "REGISTERED"
    execute(
        connection,
        "UPDATE events SET offline_data_version=offline_data_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=:id",
        {"id": event["id"]},
    )
    if actor:
        audit(
            connection,
            actor.id,
            "ONSITE_REGISTRATION",
            "Registration",
            registration_id,
            {
                "actorRole": actor.role,
                "capacityOverride": capacity_override,
                "existingRegistration": status == "ALREADY_REGISTERED",
            },
        )
    return {
        "status": status,
        "registrationId": registration_id,
        "ticketUrl": ticket_url(public_id, config),
    }


def qr_hash(public_id: str, config: Settings) -> str:
    return hashlib.sha256(
        registration_qr(public_id, config.qr_signing_secret).encode()
    ).hexdigest()
