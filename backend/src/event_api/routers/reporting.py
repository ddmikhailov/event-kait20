from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Response

from ..database import Database, execute, row, rows
from ..dependencies import Staff, csrf_super_admin, database, super_admin
from ..errors import ApiError
from ..schemas import SendTicketsRequest
from ..service_utils import audit, utc_iso

router = APIRouter(prefix="/admin/events", tags=["reporting"])


@router.get("/{event_id}/statistics")
def statistics(
    event_id: UUID,
    response: Response,
    _staff: Annotated[Staff, Depends(super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "private, no-store"
    with db.connect() as connection:
        event = row(
            connection,
            "SELECT id,capacity FROM events WHERE id=:id",
            {"id": str(event_id)},
        )
        if not event:
            raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
        totals = row(
            connection,
            """SELECT count(*) AS registered,SUM(first_attended_at IS NOT NULL) AS attended
            FROM registrations WHERE event_id=:event AND status='ACTIVE'""",
            {"event": str(event_id)},
        )
        arrivals = rows(
            connection,
            """SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(first_attended_at)/900)*900) AS bucket_start,
            count(*) AS count FROM registrations WHERE event_id=:event AND status='ACTIVE' AND first_attended_at IS NOT NULL
            GROUP BY bucket_start ORDER BY bucket_start""",
            {"event": str(event_id)},
        )
    registered = int(totals["registered"] if totals else 0)
    attended = int((totals["attended"] or 0) if totals else 0)
    cumulative = 0
    series = []
    for item in arrivals:
        count = int(item["count"])
        cumulative += count
        series.append(
            {
                "bucketStart": utc_iso(item["bucket_start"]),
                "count": count,
                "cumulative": cumulative,
            }
        )
    return {
        "eventId": str(event_id),
        "capacity": event["capacity"],
        "registered": registered,
        "freePlaces": max(0, event["capacity"] - registered),
        "attended": attended,
        "absent": registered - attended,
        "attendancePercentage": 0
        if registered == 0
        else round(attended / registered * 100, 1),
        "arrivalSeries": series,
    }


@router.post("/{event_id}/send-tickets")
def send_tickets(
    event_id: UUID,
    values: SendTicketsRequest,
    staff: Annotated[Staff, Depends(csrf_super_admin)],
    db: Annotated[Database, Depends(database)],
) -> dict[str, Any]:
    event_id_s = str(event_id)
    with db.transaction() as connection:
        if not row(
            connection,
            "SELECT id FROM events WHERE id=:id FOR UPDATE",
            {"id": event_id_s},
        ):
            raise ApiError(404, "EVENT_NOT_FOUND", "Event not found")
        all_items = rows(
            connection,
            "SELECT id,email,status,source FROM registrations WHERE event_id=:event ORDER BY registered_at,id FOR UPDATE",
            {"event": event_id_s},
        )
        if values.selection == "IMPORTED":
            recipients = [
                item for item in all_items if item["source"] == "EXCEL_IMPORT"
            ]
            selected_rows = len(recipients)
        else:
            selected = {str(item) for item in values.registration_ids or []}
            recipients = [item for item in all_items if item["id"] in selected]
            selected_rows = len(selected)
        if len(recipients) > 5_000:
            raise ApiError(
                409, "CONFLICT", "Ticket batch exceeds the 5000 registration limit"
            )
        active = [item for item in recipients if item["status"] == "ACTIVE"]
        deliverable = [item for item in active if item["email"]]
        queued = 0
        for item in deliverable:
            queued += execute(
                connection,
                """INSERT IGNORE INTO email_deliveries
                (id,idempotency_key,type,recipient_email,event_id,registration_id,status,attempts,queued_at,created_at,updated_at)
                VALUES (:id,:key,'REGISTRATION_TICKET',:email,:event,:registration,'QUEUED',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))""",
                {
                    "id": str(uuid4()),
                    "key": f"registration-ticket:bulk:{values.request_id}:{item['id']}",
                    "email": item["email"],
                    "event": event_id_s,
                    "registration": item["id"],
                },
            )
        result = {
            "requestId": str(values.request_id),
            "queuedRows": queued,
            "alreadyQueuedRows": len(deliverable) - queued,
            "withoutEmailRows": len([item for item in active if not item["email"]]),
            "inactiveOrMissingRows": selected_rows - len(active),
        }
        if queued:
            audit(
                connection,
                staff.id,
                "REGISTRATION_TICKET_BATCH_QUEUED",
                "Event",
                event_id_s,
                {
                    "requestId": str(values.request_id),
                    "selection": values.selection,
                    "queuedRows": queued,
                    "withoutEmailRows": result["withoutEmailRows"],
                    "inactiveOrMissingRows": result["inactiveOrMissingRows"],
                },
            )
    return result
