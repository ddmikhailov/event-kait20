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
    SCANNER = "SCANNER"


class PersonType(StrEnum):
    KAIT_STUDENT = "KAIT_STUDENT"
    KAIT_TEACHER = "KAIT_TEACHER"
    EXTERNAL_STUDENT = "EXTERNAL_STUDENT"
    EXTERNAL_TEACHER = "EXTERNAL_TEACHER"


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


class EventValues(Contract):
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
    cover_object_key: Annotated[str, StringConstraints(max_length=1024)] | None = None
    start_at: datetime
    end_at: datetime
    timezone: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
    ] = "Europe/Moscow"
    location: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ]
    registration_deadline: datetime
    capacity: int = Field(gt=0)
    status: EventStatus = EventStatus.DRAFT


class UpdateEventRequest(Contract):
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
    cover_object_key: Annotated[str, StringConstraints(max_length=1024)] | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
        ]
        | None
    ) = None
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
        return self


class FormFieldValues(Contract):
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
        return self


class RegistrationAnswer(Contract):
    field_id: UUID
    value: str | bool | list[str]


class ParticipantValues(Contract):
    last_name: Name
    first_name: Name
    middle_name: Name | None = None
    birth_date: date
    email: EmailStr | None = None
    phone: Phone
    study_group: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
        ]
        | None
    ) = None
    person_type: PersonType
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
    def normalize_phone(cls, value: str) -> str:
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
        if str(self.person_type).endswith("_STUDENT") and not self.study_group:
            raise ValueError("Study group is required for students")
        if str(self.person_type).startswith("EXTERNAL_") and not self.organization:
            raise ValueError("Organization is required for external participants")
        ids = [answer.field_id for answer in self.custom_answers]
        if len(ids) != len(set(ids)):
            raise ValueError("Each form field may be answered only once")
        return self


class PublicRegistrationRequest(ParticipantValues):
    email: EmailStr
    consent_accepted: Literal[True]
    consent_version: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]


class OnsiteRegistrationRequest(ParticipantValues):
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
    event_id: UUID | None = None


class EventAccessRequest(Contract):
    user_id: UUID


class ResolveQrRequest(Contract):
    qr_payload: Annotated[str, StringConstraints(min_length=40, max_length=500)]


class AttendanceItem(Contract):
    client_event_id: UUID
    registration_id: UUID
    mode: Literal["MANUAL_CONFIRM", "FAST_SCAN", "MANUAL_SEARCH", "ONSITE_REGISTRATION"]
    source: Literal["ONLINE", "OFFLINE_SYNC"]
    device_scanned_at: datetime
    estimated_scanned_at: datetime


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
    last_name: str
    first_name: str
    middle_name: str | None = None
    birth_date: str
    person_type: str
    study_group: str | None = None
    organization: str | None = None
    phone: str
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
