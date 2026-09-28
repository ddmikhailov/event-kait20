"""Current roster metadata, separate from registration and membership history."""

import hashlib
import json
from typing import Annotated

from pydantic import StringConstraints
from sqlalchemy.engine import RowMapping

from .schemas import Contract

ROSTER_FIELDS = (
    "education_status",
    "campus_address",
    "course_label",
    "program_name",
    "program_code",
)
RosterText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


class RosterMetadataUpdate(Contract):
    education_status: RosterText | None
    campus_address: RosterText | None
    course: RosterText | None
    program_name: RosterText | None
    program_code: RosterText | None
    expected_version: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)
    ]


def roster_version(person_id: str, item: RowMapping) -> str:
    values = [person_id, *[item[field] for field in ROSTER_FIELDS]]
    return hashlib.sha256(json.dumps(values, ensure_ascii=False).encode()).hexdigest()
