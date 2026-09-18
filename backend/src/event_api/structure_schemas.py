from typing import Annotated
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
StructureName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
]


class DepartmentValues(Contract):
    organization_id: UUID | None = None
    code: Code
    name: StructureName
    active: bool = True
    sort_order: int = Field(default=0, ge=0, le=100_000)


class DepartmentUpdate(Contract):
    code: Code | None = None
    name: StructureName | None = None
    active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def non_empty(self) -> "DepartmentUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self


class StudyGroupValues(Contract):
    organization_id: UUID | None = None
    department_id: UUID
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    code: Code | None = None
    course: int = Field(ge=1, le=4)
    active: bool = True


class StudyGroupUpdate(Contract):
    department_id: UUID | None = None
    name: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
        ]
        | None
    ) = None
    code: Code | None = None
    course: int | None = Field(default=None, ge=1, le=4)
    active: bool | None = None

    @model_validator(mode="after")
    def non_empty(self) -> "StudyGroupUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self


class DirectionValues(Contract):
    organization_id: UUID | None = None
    code: Code
    name: StructureName
    description: Annotated[str, StringConstraints(max_length=500)] | None = None
    active: bool = True
    sort_order: int = Field(default=0, ge=0, le=100_000)


class DirectionUpdate(Contract):
    code: Code | None = None
    name: StructureName | None = None
    description: Annotated[str, StringConstraints(max_length=500)] | None = None
    active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def non_empty(self) -> "DirectionUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self
