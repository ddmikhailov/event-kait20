import { randomUUID } from 'node:crypto';

import type {
  EventStatisticsResponse,
  SendTicketsRequest,
  SendTicketsResponse,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { ApiError } from '../common/api-error.js';
import { DATABASE_POOL } from '../common/tokens.js';

type EventRow = { capacity: number; id: string };
type RegistrationRecipient = {
  email: string | null;
  id: string;
  status: 'ACTIVE' | 'ANNULLED';
};

@Injectable()
export class ReportingService {
  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public async statistics(eventId: string): Promise<EventStatisticsResponse> {
    const [event, totals, arrivals] = await Promise.all([
      this.event(this.pool, eventId),
      this.pool.query<{
        attended: string;
        registered: string;
      }>(
        `SELECT count(*)::text AS registered,
                count(*) FILTER (WHERE first_attended_at IS NOT NULL)::text AS attended
         FROM registrations WHERE event_id = $1 AND status = 'ACTIVE'`,
        [eventId],
      ),
      this.pool.query<{ bucket_start: Date; count: string }>(
        `SELECT date_bin(
                  INTERVAL '15 minutes', first_attended_at,
                  TIMESTAMPTZ '1970-01-01 00:00:00+00'
                ) AS bucket_start,
                count(*)::text AS count
         FROM registrations
         WHERE event_id = $1 AND status = 'ACTIVE'
           AND first_attended_at IS NOT NULL
         GROUP BY bucket_start ORDER BY bucket_start`,
        [eventId],
      ),
    ]);
    const registered = Number(totals.rows[0]?.registered ?? 0);
    const attended = Number(totals.rows[0]?.attended ?? 0);
    let cumulative = 0;
    return {
      eventId,
      capacity: event.capacity,
      registered,
      freePlaces: Math.max(0, event.capacity - registered),
      attended,
      absent: registered - attended,
      attendancePercentage:
        registered === 0 ? 0 : Math.round((attended / registered) * 1_000) / 10,
      arrivalSeries: arrivals.rows.map((row) => {
        const count = Number(row.count);
        cumulative += count;
        return {
          bucketStart: row.bucket_start.toISOString(),
          count,
          cumulative,
        };
      }),
    };
  }

  public async sendTickets(
    eventId: string,
    actorId: string,
    values: SendTicketsRequest,
  ): Promise<SendTicketsResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.event(client, eventId, true);
      const recipients = await this.recipients(client, eventId, values);
      const selectedRows =
        values.selection === 'IMPORTED'
          ? recipients.length
          : values.registrationIds.length;
      if (recipients.length > 5_000) {
        throw new ApiError(
          409,
          'CONFLICT',
          'Ticket batch exceeds the 5000 registration limit',
        );
      }
      const active = recipients.filter((row) => row.status === 'ACTIVE');
      const deliverable = active.filter((row) => row.email);
      let queuedRows = 0;
      for (const recipient of deliverable) {
        const delivery = await client.query(
          `INSERT INTO email_deliveries
            (id, idempotency_key, type, recipient_email, event_id,
             registration_id, status, attempts, queued_at, created_at, updated_at)
           VALUES ($1, $2, 'REGISTRATION_TICKET', $3, $4, $5,
                   'QUEUED', 0, now(), now(), now())
           ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
          [
            randomUUID(),
            `registration-ticket:bulk:${values.requestId}:${recipient.id}`,
            recipient.email,
            eventId,
            recipient.id,
          ],
        );
        queuedRows += delivery.rowCount ?? 0;
      }
      const result: SendTicketsResponse = {
        requestId: values.requestId,
        queuedRows,
        alreadyQueuedRows: deliverable.length - queuedRows,
        withoutEmailRows: active.filter((row) => !row.email).length,
        inactiveOrMissingRows: selectedRows - active.length,
      };
      if (queuedRows > 0) {
        await client.query(
          `INSERT INTO audit_log
            (id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
           VALUES ($1, $2, 'REGISTRATION_TICKET_BATCH_QUEUED', 'Event', $3,
                   $4::jsonb, now())`,
          [
            randomUUID(),
            actorId,
            eventId,
            JSON.stringify({
              requestId: values.requestId,
              selection: values.selection,
              queuedRows,
              withoutEmailRows: result.withoutEmailRows,
              inactiveOrMissingRows: result.inactiveOrMissingRows,
            }),
          ],
        );
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async recipients(
    client: PoolClient,
    eventId: string,
    values: SendTicketsRequest,
  ): Promise<RegistrationRecipient[]> {
    const result = await client.query<RegistrationRecipient>(
      values.selection === 'IMPORTED'
        ? `SELECT id, email, status FROM registrations
           WHERE event_id = $1 AND source = 'EXCEL_IMPORT'
           ORDER BY registered_at, id FOR UPDATE`
        : `SELECT id, email, status FROM registrations
           WHERE event_id = $1 AND id = ANY($2::uuid[])
           ORDER BY registered_at, id FOR UPDATE`,
      values.selection === 'IMPORTED'
        ? [eventId]
        : [eventId, values.registrationIds],
    );
    return result.rows;
  }

  private async event(
    db: Pool | PoolClient,
    eventId: string,
    lock = false,
  ): Promise<EventRow> {
    const result = await db.query<EventRow>(
      `SELECT id, capacity FROM events WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [eventId],
    );
    if (!result.rows[0]) {
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    }
    return result.rows[0];
  }
}
