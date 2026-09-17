import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.engine import Connection, RowMapping

from .config import Settings
from .database import execute, row, rows
from .dependencies import Staff
from .errors import ApiError
from .form_config import validate_system_fields
from .schemas import ParticipantValues
from .security import registration_qr, registration_signature
from .service_utils import audit, db_json, json_value
from .streams import selected_stream

KAIT_ORGANIZATION = "КАИТ №20"


def ticket_url(public_id: str, config: Settings) -> str:
    base = str(config.public_web_base_url).rstrip("/")
    return f"{base}/tickets/{public_id}/{registration_signature(public_id, config.qr_signing_secret)}"


def participant(values: ParticipantValues) -> dict[str, Any]:
    person_type = str(values.person_type or "OTHER")
    return {
        "last_name": values.last_name,
        "first_name": values.first_name,
        "middle_name": values.middle_name,
        "birth_date": values.birth_date,
        "email": str(values.email).lower() if values.email else None,
        "phone": values.phone,
        "study_group": values.study_group if person_type == "KAIT_STUDENT" else None,
        "person_type": person_type,
        "organization": (
            values.organization
            if person_type.startswith("EXTERNAL_")
            else KAIT_ORGANIZATION
            if person_type.startswith("KAIT_")
            else None
        ),
    }


def form_fields(connection: Connection, event_id: str) -> list[RowMapping]:
    return list(
        rows(
            connection,
            """SELECT id,type,label,required,onsite_required,sort_order,options
        FROM event_form_fields WHERE event_id=:event AND active=true
        ORDER BY sort_order,created_at""",
            {"event": event_id},
        )
    )


def validate_answers(
    fields: list[RowMapping], values: ParticipantValues, onsite: bool = False
) -> None:
    by_id = {field["id"]: field for field in fields}
    answers = {str(answer.field_id): answer.value for answer in values.custom_answers}
    for field_id, value in answers.items():
        field = by_id.get(field_id)
        if not field or not valid_answer(field, value):
            raise ApiError(409, "FORM_VERSION_INVALID", "Registration form has changed")
    if any(
        (
            field["onsite_required"]
            if onsite and field["onsite_required"] is not None
            else field["required"]
        )
        and (field["id"] not in answers or answers[field["id"]] == [])
        for field in fields
    ):
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


def acquire_person_locks(
    connection: Connection, data: dict[str, Any], tenant_id: str
) -> list[str]:
    name = "|".join(
        [
            tenant_id,
            data["last_name"].lower(),
            data["first_name"].lower(),
            (data["middle_name"] or "").lower(),
        ]
    )
    keys = sorted(
        [
            *([f"{name}|email:{data['email']}"] if data["email"] else []),
            *([f"{name}|phone:{data['phone']}"] if data["phone"] else []),
            *(
                [f"{name}|birth:{data['birth_date'].isoformat()}"]
                if data["birth_date"]
                else []
            ),
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


def create_person(
    connection: Connection,
    data: dict[str, Any],
    tenant_id: str,
    *,
    dedup_review_required: bool = False,
) -> str:
    person_id = str(uuid4())
    execute(
        connection,
        """INSERT INTO persons
        (id,tenant_id,last_name,first_name,middle_name,birth_date,email,email_normalized,phone,
         phone_normalized,person_type,organization,study_group,dedup_review_required,
         created_at,updated_at)
        VALUES (:id,:tenant,:last_name,:first_name,:middle_name,:birth_date,:email,:email,:phone,
                :phone,:person_type,:organization,:study_group,:review,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {**data, "id": person_id, "tenant": tenant_id, "review": dedup_review_required},
    )
    return person_id


def update_person(connection: Connection, person_id: str, data: dict[str, Any]) -> None:
    execute(
        connection,
        """UPDATE persons SET last_name=:last_name,first_name=:first_name,
        middle_name=:middle_name,birth_date=COALESCE(:birth_date,birth_date),email=COALESCE(:email,email),email_normalized=COALESCE(:email,email_normalized),
        phone=COALESCE(:phone,phone),phone_normalized=COALESCE(:phone,phone_normalized),person_type=:person_type,organization=:organization,
        study_group=:study_group,updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
        {**data, "id": person_id},
    )


def find_or_create_person(
    connection: Connection,
    data: dict[str, Any],
    tenant_id: str,
    *,
    update_existing: bool = True,
) -> str:
    candidates = rows(
        connection,
        """SELECT id FROM persons WHERE tenant_id=:tenant AND merged_into_id IS NULL
        AND lower(last_name)=lower(:last) AND lower(first_name)=lower(:first)
        AND ((:middle IS NULL AND middle_name IS NULL) OR lower(middle_name)=lower(:middle))
        AND (email_normalized=:email OR phone_normalized=:phone OR birth_date=:birth)
        FOR UPDATE""",
        {
            "last": data["last_name"],
            "tenant": tenant_id,
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
        if update_existing:
            update_person(connection, person_id, data)
        return person_id
    return create_person(
        connection, data, tenant_id, dedup_review_required=len(ids) > 1
    )


def create_registration(
    connection: Connection,
    event_id: str,
    person_id: str,
    data: dict[str, Any],
    source: str,
    consent: bool,
    config: Settings,
    stream_id: str | None = None,
) -> tuple[str, str]:
    registration_id, public_id = str(uuid4()), str(uuid4())
    execute(
        connection,
        """INSERT INTO registrations
        (id,public_id,event_id,stream_id,person_id,source,status,last_name,first_name,middle_name,
         birth_date,email,phone,study_group,person_type,organization,consent_accepted,
         consent_version,consent_url,privacy_policy_url,consent_accepted_at,registered_at,created_at,updated_at)
        VALUES (:id,:public,:event,:stream,:person,:source,'ACTIVE',:last_name,:first_name,:middle_name,
                :birth_date,:email,:phone,:study_group,:person_type,:organization,:consent,
                :consent_version,:consent_url,:privacy_policy_url,:consent_at,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
        {
            **data,
            "id": registration_id,
            "public": public_id,
            "event": event_id,
            "stream": stream_id,
            "person": person_id,
            "source": source,
            "consent": consent,
            "consent_version": config.consent_version if consent else None,
            "consent_url": str(config.consent_url) if consent else None,
            "privacy_policy_url": (str(config.privacy_policy_url) if consent else None),
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
        middle_name=:middle_name,birth_date=COALESCE(:birth_date,birth_date),email=COALESCE(:email,email),phone=COALESCE(:phone,phone),
        study_group=:study_group,person_type=:person_type,organization=:organization,
        consent_accepted=CASE WHEN :refresh THEN true ELSE consent_accepted END,
        consent_version=CASE WHEN :refresh THEN :version ELSE consent_version END,
        consent_url=CASE WHEN :refresh THEN :url ELSE consent_url END,
        privacy_policy_url=CASE WHEN :refresh THEN :privacy_policy_url ELSE privacy_policy_url END,
        consent_accepted_at=CASE WHEN :refresh THEN UTC_TIMESTAMP(3) ELSE consent_accepted_at END,
        updated_at=UTC_TIMESTAMP(3) WHERE id=:id""",
        {
            **data,
            "id": registration_id,
            "refresh": refresh_consent,
            "version": config.consent_version,
            "url": str(config.consent_url),
            "privacy_policy_url": str(config.privacy_policy_url),
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


def public_repeat_response(
    connection: Connection,
    event_id: str,
    registration_id: str,
    saved_email: str | None,
) -> dict[str, Any]:
    if saved_email:
        queue_ticket(connection, event_id, registration_id, saved_email)
    return {
        "status": "ALREADY_REGISTERED",
        "recoveryQueued": bool(saved_email),
    }


def validate_participant_type(event: Any, person_type: str) -> None:
    allowed = json_value(event["allowed_person_types"])
    if allowed is not None and person_type not in allowed:
        raise ApiError(
            409,
            "PARTICIPANT_TYPE_NOT_ALLOWED",
            "Event is not available for this participant type",
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
    scope = row(
        connection,
        """SELECT o.tenant_id FROM organizations o
        WHERE o.id=:organization""",
        {"organization": event["organization_id"]},
    )
    if not scope:
        raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
    tenant_id = scope["tenant_id"]
    validate_system_fields(
        event, values, "public" if source == "PUBLIC_FORM" else "onsite"
    )
    validate_participant_type(event, str(values.person_type or "OTHER"))
    request_hash = (
        hashlib.sha256(
            f"{event['id']}:{actor.id if actor else 'public'}:{values.request_id}".encode()
        ).hexdigest()
        if values.request_id
        else None
    )
    payload_hash = hmac.new(
        config.session_secret.encode(),
        json.dumps(
            values.model_dump(mode="json", exclude={"capacity_override"}),
            sort_keys=True,
            ensure_ascii=False,
        ).encode(),
        hashlib.sha256,
    ).hexdigest()
    if request_hash:
        previous = row(
            connection,
            """SELECT q.payload_hash,r.id,r.public_id,r.status,r.email FROM registration_requests q
            JOIN registrations r ON r.id=q.registration_id WHERE q.request_hash=:key""",
            {"key": request_hash},
        )
        if previous:
            if (
                not hmac.compare_digest(previous["payload_hash"], payload_hash)
                or previous["status"] != "ACTIVE"
            ):
                raise ApiError(
                    409, "REQUEST_ALREADY_USED", "This submission has already been used"
                )
            if source == "PUBLIC_FORM":
                return public_repeat_response(
                    connection, event["id"], previous["id"], previous["email"]
                )
            return {
                "status": "ALREADY_REGISTERED",
                "registrationId": previous["id"],
                "ticketUrl": ticket_url(previous["public_id"], config),
            }
    if not request_hash and not any((values.email, values.phone, values.birth_date)):
        raise ApiError(
            400,
            "VALIDATION_ERROR",
            "A request id is required without contact identifiers",
        )
    stream = selected_stream(
        connection, event, str(values.stream_id) if values.stream_id else None
    )
    data = participant(values)
    fields = form_fields(connection, event["id"])
    validate_answers(fields, values, onsite=source != "PUBLIC_FORM")
    person_id = find_or_create_person(
        connection, data, tenant_id, update_existing=source != "PUBLIC_FORM"
    )
    existing = row(
        connection,
        """SELECT id,public_id,stream_id,email FROM registrations
        WHERE event_id=:event AND person_id=:person AND status='ACTIVE' FOR UPDATE""",
        {"event": event["id"], "person": person_id},
    )
    if existing:
        if source == "PUBLIC_FORM":
            return public_repeat_response(
                connection, event["id"], existing["id"], existing["email"]
            )
        if existing["stream_id"] != (stream["id"] if stream else None):
            raise ApiError(
                409,
                "STREAM_ALREADY_SELECTED",
                "Participant already registered for another stream; contact organizer",
            )
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
        if source == "PUBLIC_FORM":
            update_person(connection, person_id, data)
        count = row(
            connection,
            "SELECT count(*) AS count FROM registrations WHERE event_id=:event AND status='ACTIVE'",
            {"event": event["id"]},
        )
        if (
            stream is None
            and int(count["count"] if count else 0) >= int(event["capacity"])
            and not capacity_override
        ):
            raise ApiError(409, "CAPACITY_FULL", "Event capacity is full")
        if stream:
            occupied = row(
                connection,
                "SELECT COUNT(*) AS total FROM registrations WHERE stream_id=:stream AND status='ACTIVE'",
                {"stream": stream["id"]},
            )
            if (
                int(occupied["total"] if occupied else 0) >= stream["capacity"]
                and not capacity_override
            ):
                raise ApiError(409, "CAPACITY_FULL", "Stream capacity is full")
        registration_id, public_id = create_registration(
            connection,
            event["id"],
            person_id,
            data,
            source,
            consent,
            config,
            stream["id"] if stream else None,
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
    if request_hash:
        execute(
            connection,
            "INSERT INTO registration_requests(request_hash,event_id,registration_id,payload_hash) VALUES (:key,:event,:registration,:payload)",
            {
                "key": request_hash,
                "event": event["id"],
                "registration": registration_id,
                "payload": payload_hash,
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
