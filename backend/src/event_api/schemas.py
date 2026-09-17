import re
from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


def camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(item.capitalize() for item in tail)


class Contract(BaseModel):
    model_config = ConfigDict(
        alias_generator=camel,
        populate_by_name=True,
        extra="forbid",
        use_enum_values=True,
    )


Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]
Phone = Annotated[str, StringConstraints(min_length=10, max_length=32)]


class StaffRole(StrEnum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ORGANIZER = "ORGANIZER"
    SCANNER = "SCANNER"


class PersonType(StrEnum):
    KAIT_STUDENT = "KAIT_STUDENT"
    KAIT_TEACHER = "KAIT_TEACHER"
    EXTERNAL_STUDENT = "EXTERNAL_STUDENT"
    EXTERNAL_TEACHER = "EXTERNAL_TEACHER"
    PARENT = "PARENT"
    OTHER = "OTHER"


class EventStatus(StrEnum):
    DRAFT = "DRAFT"
    REGISTRATION_OPEN = "REGISTRATION_OPEN"
    REGISTRATION_CLOSED = "REGISTRATION_CLOSED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"


class FormFieldType(StrEnum):
    SHORT_TEXT = "SHORT_TEXT"
    LONG_TEXT = "LONG_TEXT"
    SINGLE_CHOICE = "SINGLE_CHOICE"
    MULTI_CHOICE = "MULTI_CHOICE"
    BOOLEAN = "BOOLEAN"


class LoginRequest(Contract):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class PasswordForgotRequest(Contract):
    email: EmailStr


class PasswordResetRequest(Contract):
    token: Annotated[str, StringConstraints(min_length=20, max_length=500)]
    password: Password


class InvitationAcceptRequest(Contract):
    password: Password


SystemFieldKey = Literal[
    "middleName",
    "birthDate",
    "email",
    "phone",
    "personType",
    "studyGroup",
    "organization",
]
SYSTEM_FIELD_KEYS = (
    "middleName",
    "birthDate",
    "email",
    "phone",
    "personType",
    "studyGroup",
    "organization",
)


class SystemFieldConfig(Contract):
    key: SystemFieldKey
    mode: Literal["HIDDEN", "OPTIONAL", "REQUIRED"] = "OPTIONAL"


class RegistrationFormConfig(Contract):
    public: list[SystemFieldConfig] = Field(min_length=7, max_length=7)
    onsite: list[SystemFieldConfig] = Field(min_length=7, max_length=7)

    @field_validator("public", "onsite")
    @classmethod
    def complete_keys(cls, values: list[SystemFieldConfig]) -> list[SystemFieldConfig]:
        if {value.key for value in values} != set(SYSTEM_FIELD_KEYS):
            raise ValueError("Each configurable field must appear exactly once")
        return values


def default_form_config() -> RegistrationFormConfig:
    fields = [{"key": key, "mode": "OPTIONAL"} for key in SYSTEM_FIELD_KEYS]
    return RegistrationFormConfig.model_validate({"public": fields, "onsite": fields})


class EventValues(Contract):
    season_id: UUID | None = None
    category_id: UUID | None = None
    level_id: UUID | None = None
    form_config: RegistrationFormConfig = Field(default_factory=default_form_config)
    is_listed: bool = True
    allowed_person_types: list[PersonType] | None = Field(
        default=None, min_length=1, max_length=6
    )

    @field_validator("allowed_person_types")
    @classmethod
    def unique_types(cls, values: list[PersonType] | None) -> list[PersonType] | None:
        if values is not None and len(values) != len(set(values)):
            raise ValueError("Participant types must be unique")
        return values

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    slug: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
            min_length=2,
            max_length=255,
        ),
    ]
    description: Annotated[str, StringConstraints(max_length=20_000)] | None = None
    direction: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None
    ) = None
    start_at: datetime
    end_at: datetime
    timezone: Literal["Europe/Moscow"] = "Europe/Moscow"
    location: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ]
    registration_deadline: datetime
    capacity: int = Field(gt=0)
    status: EventStatus = EventStatus.DRAFT


class UpdateEventRequest(Contract):
    season_id: UUID | None = None
    category_id: UUID | None = None
    level_id: UUID | None = None
    form_config: RegistrationFormConfig | None = None
    is_listed: bool | None = None
    allowed_person_types: list[PersonType] | None = Field(
        default=None, min_length=1, max_length=6
    )

    @field_validator("allowed_person_types")
    @classmethod
    def unique_types(cls, values: list[PersonType] | None) -> list[PersonType] | None:
        if values is not None and len(values) != len(set(values)):
            raise ValueError("Participant types must be unique")
        return values

    title: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
        ]
        | None
    ) = None
    slug: (
        Annotated[
            str,
            StringConstraints(
                strip_whitespace=True,
                pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
                min_length=2,
                max_length=255,
            ),
        ]
        | None
    ) = None
    description: Annotated[str, StringConstraints(max_length=20_000)] | None = None
    direction: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None
    ) = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: Literal["Europe/Moscow"] | None = None
    location: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
        ]
        | None
    ) = None
    registration_deadline: datetime | None = None
    capacity: int | None = Field(default=None, gt=0)
    status: EventStatus | None = None

    @model_validator(mode="after")
    def non_empty(self) -> "UpdateEventRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        nullable = {
            "description",
            "direction",
            "allowed_person_types",
            "season_id",
            "category_id",
            "level_id",
        }
        invalid = sorted(
            field
            for field in self.model_fields_set - nullable
            if getattr(self, field) is None
        )
        if invalid:
            raise ValueError(f"Fields cannot be null: {', '.join(invalid)}")
        return self


class FormFieldValues(Contract):
    onsite_required: bool = False
    type: FormFieldType
    label: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    required: bool = False
    sort_order: int = Field(ge=0)
    options: (
        list[
            Annotated[
                str,
                StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
            ]
        ]
        | None
    ) = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def valid_options(self) -> "FormFieldValues":
        choice = self.type in {FormFieldType.SINGLE_CHOICE, FormFieldType.MULTI_CHOICE}
        if choice and (not self.options or len(set(self.options)) != len(self.options)):
            raise ValueError("Choice fields require unique options")
        if not choice and self.options is not None:
            raise ValueError("Non-choice fields cannot define options")
        return self


class UpdateFormFieldRequest(Contract):
    onsite_required: bool | None = None
    type: FormFieldType | None = None
    label: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
        ]
        | None
    ) = None
    required: bool | None = None
    sort_order: int | None = Field(default=None, ge=0)
    options: (
        list[
            Annotated[
                str,
                StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
            ]
        ]
        | None
    ) = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def non_empty(self) -> "UpdateFormFieldRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        invalid = sorted(
            field
            for field in self.model_fields_set - {"options"}
            if getattr(self, field) is None
        )
        if invalid:
            raise ValueError(f"Fields cannot be null: {', '.join(invalid)}")
        return self


class RegistrationAnswer(Contract):
    field_id: UUID
    value: (
        Annotated[str, StringConstraints(max_length=20_000)]
        | bool
        | Annotated[
            list[Annotated[str, StringConstraints(max_length=200)]],
            Field(max_length=100),
        ]
    )


class StreamValues(Contract):
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
    ]
    start_at: datetime
    end_at: datetime
    capacity: int = Field(gt=0, le=1_000_000)
    sort_order: int = Field(default=0, ge=0, le=100_000)
    active: bool = True


class ParticipantValues(Contract):
    request_id: UUID | None = None
    stream_id: UUID | None = None
    last_name: Name
    first_name: Name
    middle_name: Name | None = None
    birth_date: date | None = None
    email: EmailStr | None = None
    phone: Phone | None = None
    study_group: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
        ]
        | None
    ) = None
    person_type: PersonType | None = None
    organization: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
        ]
        | None
    ) = None
    custom_answers: list[RegistrationAnswer] = Field(
        default_factory=list, max_length=100
    )

    @field_validator("last_name", "first_name", "middle_name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return re.sub(r"\s+", " ", value).strip() if value else value

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        digits = re.sub(r"\D", "", value)
        if len(digits) == 10 and digits.startswith("9"):
            digits = "7" + digits
        if len(digits) == 11 and digits.startswith("8"):
            digits = "7" + digits[1:]
        normalized = "+" + digits
        if not re.fullmatch(r"\+7\d{10}", normalized):
            raise ValueError("Russian phone is invalid")
        return normalized

    @model_validator(mode="after")
    def conditional_fields(self) -> "ParticipantValues":
        ids = [answer.field_id for answer in self.custom_answers]
        if len(ids) != len(set(ids)):
            raise ValueError("Each form field may be answered only once")
        return self


class PublicRegistrationRequest(ParticipantValues):
    consent_accepted: Literal[True]
    consent_version: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]


class OnsiteRegistrationRequest(ParticipantValues):
    consent_accepted: Literal[True]
    capacity_override: bool = False


class PersonUpdate(Contract):
    last_name: Name | None = None
    first_name: Name | None = None
    middle_name: Name | None = None
    birth_date: date | None = None
    email: EmailStr | None = None
    phone: Phone | None = None
    study_group: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
        ]
        | None
    ) = None
    person_type: PersonType | None = None
    organization: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def non_empty(self) -> "PersonUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self


class StaffInvitationRequest(Contract):
    email: EmailStr
    role: Literal["ORGANIZER", "SCANNER"] = "SCANNER"
    event_id: UUID | None = None

    @model_validator(mode="after")
    def event_scope_matches_role(self) -> "StaffInvitationRequest":
        if self.role == "ORGANIZER" and self.event_id is not None:
            raise ValueError("Organizer invitations cannot be event-scoped")
        return self


class InvitationResendRequest(Contract):
    request_id: UUID


class EventAccessRequest(Contract):
    user_id: UUID


class PurgeEventRequest(Contract):
    confirmation_slug: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
            min_length=2,
            max_length=255,
        ),
    ]


class ResolveQrRequest(Contract):
    qr_payload: Annotated[str, StringConstraints(min_length=40, max_length=500)]


class AttendanceItem(Contract):
    client_event_id: UUID
    registration_id: UUID
    mode: Literal["MANUAL_CONFIRM", "FAST_SCAN", "MANUAL_SEARCH", "ONSITE_REGISTRATION"]
    source: Literal["ONLINE", "OFFLINE_SYNC"]
    device_scanned_at: datetime
    estimated_scanned_at: datetime

    @field_validator("device_scanned_at", "estimated_scanned_at")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Attendance timestamps must include a UTC offset")
        return value


class AttendanceSyncRequest(Contract):
    device_id: UUID
    events: list[AttendanceItem] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique_ids(self) -> "AttendanceSyncRequest":
        ids = [item.client_event_id for item in self.events]
        if len(ids) != len(set(ids)):
            raise ValueError("clientEventId must be unique within a batch")
        return self


class SendTicketsRequest(Contract):
    request_id: UUID
    selection: Literal["IMPORTED", "REGISTRATION_IDS"]
    registration_ids: list[UUID] | None = Field(
        default=None, min_length=1, max_length=5_000
    )

    @model_validator(mode="after")
    def selection_shape(self) -> "SendTicketsRequest":
        if self.selection == "REGISTRATION_IDS" and not self.registration_ids:
            raise ValueError("registrationIds are required")
        if self.selection == "IMPORTED" and self.registration_ids is not None:
            raise ValueError("registrationIds are not allowed")
        return self


class ExcelMapping(Contract):
    stream_title: str | None = None
    last_name: str
    first_name: str
    middle_name: str | None = None
    birth_date: str | None = None
    person_type: str | None = None
    study_group: str | None = None
    organization: str | None = None
    phone: str | None = None
    email: str | None = None
    custom_fields: dict[UUID, str] = Field(default_factory=dict)


class ExcelDecision(Contract):
    row_number: int = Field(ge=2)
    action: Literal["SKIP", "CREATE_NEW", "USE_PERSON"]
    person_id: UUID | None = None

    @model_validator(mode="after")
    def valid_person(self) -> "ExcelDecision":
        if (self.action == "USE_PERSON") != (self.person_id is not None):
            raise ValueError("personId shape does not match action")
        return self


class ExcelCommitRequest(Contract):
    mapping: ExcelMapping
    decisions: list[ExcelDecision] = Field(default_factory=list, max_length=5_000)
    capacity_override: bool = False
