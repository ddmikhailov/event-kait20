import type { Pool } from '@event-registration/database';

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
        `SELECT id, type, attempts FROM email_deliveries
           WHERE attempts < $1 AND (
             status = 'QUEUED' OR
             (status = 'SENDING' AND updated_at < DATE_SUB(now(), INTERVAL 5 MINUTE))
           )
           ORDER BY queued_at, created_at
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [maxAttempts],
      );
      const delivery = result.rows[0];
      if (!delivery) {
        await client.query('COMMIT');
        return undefined;
      }
      await client.query(
        `UPDATE email_deliveries SET status = 'SENDING',
           attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [delivery.id],
      );
      await client.query('COMMIT');
      return { ...delivery, attempts: delivery.attempts + 1 };
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
