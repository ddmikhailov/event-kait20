"""The temporary domain journal must not accumulate or erase business history."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import bindparam, text

from event_api.activity_service import prune_domain_outbox


def test_outbox_retention_is_bounded_and_leaves_audit_untouched(client):
    database = client.app.state.database
    now = datetime.now(UTC).replace(microsecond=0)
    old = (now - timedelta(days=91)).replace(tzinfo=None)
    recent = (now - timedelta(days=89)).replace(tzinfo=None)
    identities = [str(uuid4()) for _ in range(3)]
    audit_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            text("""INSERT INTO domain_outbox
                (id,event_type,aggregate_type,aggregate_id,payload,occurred_at,created_at)
                VALUES (:id,'TEST','Person',:id,'{}',:at,:at)"""),
            [
                {"id": identities[0], "at": old},
                {"id": identities[1], "at": old},
                {"id": identities[2], "at": recent},
            ],
        )
        connection.execute(
            text("""INSERT INTO audit_log
                (id,action,entity_type,entity_id,created_at)
                VALUES (:id,'RETENTION_TEST','Person',:person,:at)"""),
            {"id": audit_id, "person": identities[0], "at": old},
        )
    assert prune_domain_outbox(database, now, batch_size=1) == 1
    assert prune_domain_outbox(database, now, batch_size=1) == 1
    assert prune_domain_outbox(database, now, batch_size=1) == 0
    with database.connect() as connection:
        remaining = (
            connection.execute(
                text("SELECT id FROM domain_outbox WHERE id IN :ids").bindparams(
                    bindparam("ids", expanding=True)
                ),
                {"ids": identities},
            )
            .scalars()
            .all()
        )
        audit = connection.execute(
            text("SELECT id FROM audit_log WHERE id=:id"), {"id": audit_id}
        ).scalar_one()
    assert remaining == [identities[2]]
    assert audit == audit_id
