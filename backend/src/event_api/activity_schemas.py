from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .schemas import Contract

Code = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_upper=True,
        pattern=r"^[A-Z][A-Z0-9_]{1,49}$",
    ),
]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
]
Reason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)
]


class ReferenceValues(Contract):
    code: Code
    name: Label
    description: Annotated[str, StringConstraints(max_length=500)] | None = None
    sort_order: int = Field(default=0, ge=0, le=100_000)
    active: bool = True


class ReferenceUpdate(Contract):
    name: Label | None = None
    description: Annotated[str, StringConstraints(max_length=500)] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    active: bool | None = None

    @model_validator(mode="after")
    def non_empty(self) -> "ReferenceUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self


class SeasonValues(Contract):
    code: Code
    name: Label
    starts_at: datetime
    ends_at: datetime
    active: bool = False

    @model_validator(mode="after")
    def valid_period(self) -> "SeasonValues":
        if self.ends_at <= self.starts_at:
            raise ValueError("Season end must be after start")
        return self


class ScoringRuleValues(Contract):
    season_id: UUID
    event_category_id: UUID | None = None
    event_level_id: UUID | None = None
    participation_role_id: UUID | None = None
    participation_result_id: UUID | None = None
    points: int = Field(ge=-1_000_000, le=1_000_000)
    priority: int = Field(default=0, ge=0, le=100_000)
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    active: bool = True

    @model_validator(mode="after")
    def valid_rule(self) -> "ScoringRuleValues":
        if self.points == 0:
            raise ValueError("Rule points cannot be zero")
        if self.valid_from and self.valid_to and self.valid_to <= self.valid_from:
            raise ValueError("Rule end must be after start")
        return self


class ParticipationUpdate(Contract):
    role_id: UUID | None = None
    result_id: UUID | None = None
    reason: Reason

    @model_validator(mode="after")
    def has_change(self) -> "ParticipationUpdate":
        if not ({"role_id", "result_id"} & self.model_fields_set):
            raise ValueError("Role or result is required")
        return self


class ParticipationConfirmRequest(Contract):
    registration_ids: list[UUID] = Field(min_length=1, max_length=500)
    role_id: UUID | None = None
    result_id: UUID | None = None
    source: Literal["ADMIN", "ATTENDANCE_BULK"] = "ADMIN"
    confirm_without_attendance: bool = False
    override_reason: Reason | None = None

    @model_validator(mode="after")
    def valid_override(self) -> "ParticipationConfirmRequest":
        if self.confirm_without_attendance and not self.override_reason:
            raise ValueError("Override reason is required")
        if len(self.registration_ids) != len(set(self.registration_ids)):
            raise ValueError("Registration IDs must be unique")
        return self


class ParticipationAssignRequest(Contract):
    registration_ids: list[UUID] = Field(min_length=1, max_length=500)
    role_id: UUID
    result_id: UUID | None = None
    reason: Reason

    @model_validator(mode="after")
    def unique_ids(self) -> "ParticipationAssignRequest":
        if len(self.registration_ids) != len(set(self.registration_ids)):
            raise ValueError("Registration IDs must be unique")
        return self


class ParticipationCancelRequest(Contract):
    participation_ids: list[UUID] = Field(min_length=1, max_length=500)
    reason: Reason

    @model_validator(mode="after")
    def unique_ids(self) -> "ParticipationCancelRequest":
        if len(self.participation_ids) != len(set(self.participation_ids)):
            raise ValueError("Participation IDs must be unique")
        return self


class ManualAdjustmentRequest(Contract):
    person_id: UUID
    season_id: UUID
    points: int = Field(ge=-1_000_000, le=1_000_000)
    reason: Reason
    request_id: UUID

    @model_validator(mode="after")
    def non_zero(self) -> "ManualAdjustmentRequest":
        if self.points == 0:
            raise ValueError("Adjustment cannot be zero")
        return self


class ProfileUpdate(Contract):
    visibility: Literal["PRIVATE", "LINK_ONLY", "PUBLIC"]


class ProfileConsentRequest(Contract):
    consent_version: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    allowed_fields: list[
        Literal[
            "NAME",
            "STUDY_GROUP",
            "ORGANIZATION",
            "PARTICIPATIONS",
            "ACHIEVEMENTS",
            "SCORES",
        ]
    ] = Field(min_length=1, max_length=6)
    source: Literal["ADMIN", "ACTIVE_UI", "IMPORT"] = "ADMIN"

    @model_validator(mode="after")
    def unique_fields(self) -> "ProfileConsentRequest":
        if len(self.allowed_fields) != len(set(self.allowed_fields)):
            raise ValueError("Allowed fields must be unique")
        return self


class StudentMembershipValues(Contract):
    study_group: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    department: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
        ]
        | None
    ) = None
    valid_from: date
    valid_to: date | None = None

    @model_validator(mode="after")
    def valid_period(self) -> "StudentMembershipValues":
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("Membership end cannot be before start")
        return self


class AchievementValues(Contract):
    person_id: UUID
    event_id: UUID | None = None
    participation_id: UUID | None = None
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    description: Annotated[str, StringConstraints(max_length=20_000)] | None = None
    achievement_type: Code
    level_id: UUID | None = None
    result_id: UUID | None = None
    source: Literal["EVENT_KAIT20", "MANUAL", "IMPORT", "EXTERNAL_SYSTEM"]
    occurred_at: datetime


class AchievementDecision(Contract):
    status: Literal["VERIFIED", "REJECTED", "CANCELLED"]
    reason: Reason
