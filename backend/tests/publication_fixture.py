"""Explicit, fictional scoring configuration for registration API fixtures."""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from test_scoring_v2 import activate_policy, create_season, login, policy_values


def roster_group(client: TestClient, group: str) -> None:
    """Add a fictional directory entry for public group-selection fixtures."""
    identity = str(uuid4())
    with client.app.state.database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO persons
        (id,tenant_id,last_name,first_name,person_type,study_group,dedup_review_required,created_at,updated_at)
        VALUES (:id,'50000000-0000-4000-8000-000000000001','Справочный','Вымышленный',
        'KAIT_STUDENT',:group,false,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))"""),
            {"id": identity, "group": group},
        )
        connection.execute(
            text("INSERT INTO student_roster_members(person_id) VALUES (:id)"),
            {"id": identity},
        )


def publication_fields(client: TestClient) -> dict[str, str]:
    cached = getattr(client.app.state, "publication_fixture", None)
    if cached is not None:
        return dict(cached)
    # A separate cookie jar preserves the caller's role/session (including ORGANIZER).
    setup = TestClient(client.app)
    try:
        headers = login(setup)
        season = create_season(setup, headers)
        response = setup.post(
            "/admin/activity/scoring-v2/policies",
            headers=headers,
            json={
                "code": f"FIXTURE_{uuid4().hex[:10].upper()}",
                "name": "Fictional publication fixture",
            },
        )
        assert response.status_code == 201, response.text
        policy = response.json()["id"]
        values = policy_values()
        values["roleBases"] = [
            {"classifierId": "30000000-0000-4000-8000-000000000001", "value": "1.0000"}
        ]
        version = setup.post(
            f"/admin/activity/scoring-v2/policies/{policy}/versions",
            headers=headers,
            json=values,
        )
        assert version.status_code == 201, version.text
        published = setup.post(
            f"/admin/activity/scoring-v2/versions/{version.json()['id']}/publish",
            headers=headers,
            json={"effectiveFrom": "2020-01-01T00:00:00Z"},
        )
        assert published.status_code == 200, published.text
        activate_policy(setup, headers, season, policy, "2020-01-01T00:00:00Z")
    finally:
        setup.close()
    fields = {"seasonId": season, "levelId": "20000000-0000-4000-8000-000000000003"}
    client.app.state.publication_fixture = fields
    return dict(fields)
