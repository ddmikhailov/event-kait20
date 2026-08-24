import type { Pool } from 'pg';

import type {
  ClaimedDelivery,
  EmailDeliveryRepository,
} from './email-delivery.js';

export class DatabaseEmailDeliveryRepository implements EmailDeliveryRepository {
  public constructor(private readonly pool: Pool) {}

  public async claimNext(
    maxAttempts: number,
  ): Promise<ClaimedDelivery | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ClaimedDelivery>(
        `WITH candidate AS (
           SELECT id FROM email_deliveries
           WHERE attempts < $1 AND (
             status = 'QUEUED' OR
             (status = 'SENDING' AND updated_at < now() - interval '5 minutes')
           )
           ORDER BY queued_at, created_at
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE email_deliveries ed SET status = 'SENDING',
           attempts = attempts + 1, updated_at = now()
         FROM candidate WHERE ed.id = candidate.id
         RETURNING ed.id, ed.type, ed.attempts`,
        [maxAttempts],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async markSent(
    deliveryId: string,
    providerMessageId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE email_deliveries SET status = 'SENT', sent_at = now(),
         provider_message_id = $2, last_error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'SENDING'`,
      [deliveryId, providerMessageId],
    );
  }

  public async markFailed(
    delivery: ClaimedDelivery,
    errorCode: string,
    maxAttempts: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE email_deliveries SET status = $2::email_delivery_status,
         last_error_code = $3, updated_at = now()
       WHERE id = $1 AND status = 'SENDING'`,
      [
        delivery.id,
        delivery.attempts >= maxAttempts ? 'FAILED' : 'QUEUED',
        errorCode,
      ],
    );
  }
}
