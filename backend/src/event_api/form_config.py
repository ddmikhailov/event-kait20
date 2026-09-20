import json
from typing import Any

from .errors import ApiError
from .schemas import SYSTEM_FIELD_KEYS, ParticipantValues


def event_form_config(event: Any) -> dict[str, Any]:
    stored = event["form_config"]
    if stored:
        return json.loads(stored) if isinstance(stored, str) else dict(stored)
    # Existing deployments retain their former requirements until the organiser saves changes.
    return {
        mode: [
            {
                "key": key,
                "mode": "REQUIRED"
                if key
                in {"birthDate", "phone", "personType", "studyGroup", "organization"}
                or (mode == "public" and key == "email")
                else "OPTIONAL",
            }
            for key in SYSTEM_FIELD_KEYS
        ]
        for mode in ("public", "onsite")
    }


def validate_system_fields(event: Any, values: ParticipantValues, mode: str) -> None:
    fields = event_form_config(event)[mode]
    submitted = values.model_dump(by_alias=True)
    person_type = str(values.person_type or "OTHER")
    allowed = event["allowed_person_types"]
    allowed = json.loads(allowed) if isinstance(allowed, str) else allowed
    restricted = allowed is not None and len(allowed) < 6
    for field in fields:
        key, setting = field["key"], field["mode"]
        if key == "studyGroup" and person_type != "KAIT_STUDENT":
            continue
        if key == "organization" and not person_type.startswith("EXTERNAL_"):
            continue
        if key == "personType" and restricted:
            setting = "REQUIRED"
        value = submitted.get(key)
        if setting == "REQUIRED" and value is None:
            raise ApiError(
                409, "FORM_VERSION_INVALID", "Fill the required registration fields"
            )
        if setting == "HIDDEN" and value is not None:
            raise ApiError(
                409,
                "FORM_VERSION_INVALID",
                "The form has changed; refresh before submitting",
            )
