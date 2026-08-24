import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseEmailDeliveryRepository } from '../src/database-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for worker integration tests');
}

const pool = new Pool({ connectionString: databaseUrl });
const repository = new DatabaseEmailDeliveryRepository(pool);

beforeAll(async () => {
  await pool.query(
    `INSERT INTO email_deliveries
      (id, idempotency_key, type, recipient_email, status, attempts,
       queued_at, created_at, updated_at)
     VALUES ($1, $2, 'REGISTRATION_TICKET', 'participant@example.test',
             'QUEUED', 0, now(), now(), now())`,
    [randomUUID(), `worker-integration:${randomUUID()}`],
  );
});

afterAll(async () => pool.end());

describe.sequential('email delivery repository on PostgreSQL 18', () => {
  it('claims, retries, and completes a delivery with bounded attempts', async () => {
    const first = await repository.claimNext(2);
    expect(first).toMatchObject({ attempts: 1, type: 'REGISTRATION_TICKET' });
    await repository.markFailed(first!, 'PROVIDER_TEMPORARY_ERROR', 2);

    const retry = await repository.claimNext(2);
    expect(retry).toMatchObject({ id: first?.id, attempts: 2 });
    await repository.markSent(retry!.id, 'provider-message-1');

    const persisted = await pool.query<{
      attempts: number;
      last_error_code: string | null;
      provider_message_id: string | null;
      sent_at: Date | null;
      status: string;
    }>('SELECT * FROM email_deliveries WHERE id = $1', [retry!.id]);
    expect(persisted.rows[0]).toMatchObject({
      attempts: 2,
      last_error_code: null,
      provider_message_id: 'provider-message-1',
      status: 'SENT',
    });
    expect(persisted.rows[0]?.sent_at).toBeInstanceOf(Date);
    await expect(repository.claimNext(2)).resolves.toBeUndefined();
  });

  it('moves the final failed attempt to FAILED', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO email_deliveries
        (id, idempotency_key, type, recipient_email, status, attempts,
         queued_at, created_at, updated_at)
       VALUES ($1, $2, 'PASSWORD_RESET', 'staff@example.test',
               'QUEUED', 0, now(), now(), now())`,
      [id, `worker-terminal:${id}`],
    );
    const claimed = await repository.claimNext(1);
    expect(claimed?.id).toBe(id);
    await repository.markFailed(claimed!, 'PERMANENT_ERROR', 1);

    const persisted = await pool.query<{ status: string }>(
      'SELECT status FROM email_deliveries WHERE id = $1',
      [id],
    );
    expect(persisted.rows[0]?.status).toBe('FAILED');
  });
});
