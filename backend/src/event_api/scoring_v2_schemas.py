from datetime import date, datetime
from decimal import Decimal
from itertools import pairwise
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator

from .schemas import Contract

DecimalText = Annotated[str, StringConstraints(pattern=r"^-?\d{1,8}(\.\d{1,4})?$")]
Code = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_upper=True, pattern=r"^[A-Z][A-Z0-9_]{1,49}$"
    ),
]


class PolicyCreate(Contract):
    code: Code
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
    ]


class ComponentValue(Contract):
    classifier_id: UUID
    value: DecimalText


class NewcomerTier(Contract):
    sequence_from: int = Field(gt=0)
    sequence_to: int | None = Field(default=None, gt=0)
    value: DecimalText


class PolicyVersionValues(Contract):
    role_bases: list[ComponentValue] = Field(min_length=1)
    level_multipliers: list[ComponentValue] = Field(min_length=1)
    status_multipliers: list[ComponentValue] = Field(default_factory=list)
    newcomer_tiers: list[NewcomerTier] = Field(min_length=1)
    result_bonuses: list[ComponentValue] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_components(self) -> "PolicyVersionValues":
        for items in (
            self.role_bases,
            self.level_multipliers,
            self.status_multipliers,
            self.result_bonuses,
        ):
            ids = [item.classifier_id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError("Component classifier IDs must be unique")
        starts = [item.sequence_from for item in self.newcomer_tiers]
        if len(starts) != len(set(starts)):
            raise ValueError("Newcomer tiers must be unique")
        ordered = sorted(self.newcomer_tiers, key=lambda item: item.sequence_from)
        for previous, current in pairwise(ordered):
            if (
                previous.sequence_to is None
                or current.sequence_from <= previous.sequence_to
            ):
                raise ValueError("Newcomer tiers must not overlap")
        if any(Decimal(item.value) < 0 for item in self.role_bases):
            raise ValueError("Role bases must be non-negative")
        if any(Decimal(item.value) <= 0 for item in self.level_multipliers):
            raise ValueError("Level multipliers must be positive")
        if any(Decimal(item.value) <= 0 for item in self.status_multipliers):
            raise ValueError("Status multipliers must be positive")
        if any(Decimal(item.value) <= 0 for item in self.newcomer_tiers):
            raise ValueError("Newcomer multipliers must be positive")
        if any(Decimal(item.value) < 0 for item in self.result_bonuses):
            raise ValueError("Result bonuses must be non-negative")
        return self


class PublishVersion(Contract):
    effective_from: datetime
    effective_to: datetime | None = None

    @model_validator(mode="after")
    def valid_period(self) -> "PublishVersion":
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError("Effective end must be after start")
        return self


class AssignPolicy(Contract):
    scoring_policy_id: UUID | None
    effective_from: datetime | None = None

    @model_validator(mode="after")
    def consistent_boundary(self) -> "AssignPolicy":
        if (self.scoring_policy_id is None) != (self.effective_from is None):
            raise ValueError("Policy and activation boundary must be set together")
        return self


class ScoringPreview(Contract):
    participation_id: UUID
    policy_version_id: UUID | None = None


class StatusAssignment(Contract):
    status_type_id: UUID
    valid_from: date
    valid_to: date | None = None

    @model_validator(mode="after")
    def valid_period(self) -> "StatusAssignment":
        if self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("Status end must not precede start")
        return self
