"""Validate default participation scoring before opening registration."""

from datetime import datetime

from sqlalchemy.engine import Connection

from .database import row
from .errors import ApiError
from .scoring_v2 import policy_version_for_event
from .service_utils import naive_utc


def require_scoring_ready(
    connection: Connection,
    season_id: str | None,
    level_id: str | None,
    start_at: datetime,
    organization_id: str,
) -> None:
    def missing(reason: str) -> None:
        raise ApiError(
            409,
            "SCORING_SETUP_REQUIRED",
            "Scoring must be configured before opening registration",
            {"reason": reason},
        )

    if not season_id:
        missing("SEASON_REQUIRED")
    if not level_id:
        missing("LEVEL_REQUIRED")
    season = row(
        connection,
        "SELECT * FROM seasons WHERE id=:id AND organization_id=:organization",
        {"id": season_id, "organization": organization_id},
    )
    if not season:
        raise ApiError(404, "SEASON_NOT_FOUND", "Season not found")
    at = naive_utc(start_at)
    if (
        not season["scoring_policy_id"]
        or not season["scoring_policy_effective_from"]
        or season["scoring_policy_effective_from"] > at
    ):
        missing("POLICY_REQUIRED")
    version = policy_version_for_event(connection, season["scoring_policy_id"], at)
    if not version:
        missing("POLICY_VERSION_REQUIRED")
        return
    if not row(
        connection,
        """SELECT 1 FROM scoring_policy_role_bases b
        JOIN participation_roles r ON r.id=b.role_id WHERE b.policy_version_id=:version
        AND r.code='PARTICIPANT' AND r.active=true""",
        {"version": version["id"]},
    ):
        missing("PARTICIPANT_BASE_REQUIRED")
    if not row(
        connection,
        """SELECT 1 FROM scoring_policy_level_multipliers m
        JOIN event_levels l ON l.id=m.level_id WHERE m.policy_version_id=:version
        AND m.level_id=:level AND l.active=true""",
        {"version": version["id"], "level": level_id},
    ):
        missing("LEVEL_MULTIPLIER_REQUIRED")
