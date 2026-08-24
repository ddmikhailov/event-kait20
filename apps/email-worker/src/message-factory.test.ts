import { authLinkToken } from '@event-registration/utils';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseEmailMessageFactory } from './message-factory.js';

const config = {
  AUTH_LINK_BASE_URL: 'https://web.example.test/auth',
  AUTH_LINK_SECRET: 'a'.repeat(32),
  PUBLIC_WEB_BASE_URL: 'https://web.example.test',
  QR_SIGNING_SECRET: 'q'.repeat(32),
};

describe('DatabaseEmailMessageFactory', () => {
  it('renders an escaped registration ticket with an inline QR image', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          recipient_email: 'participant@example.test',
          public_id: '11111111-1111-4111-8111-111111111111',
          last_name: '<Иванов>',
          first_name: 'Иван',
          middle_name: null,
          title: 'Backend & Security\r\nInjected',
          start_at: new Date('2027-06-10T10:00:00.000Z'),
          end_at: new Date('2027-06-10T18:00:00.000Z'),
          timezone: 'Europe/Moscow',
          location: '<Москва>',
        },
      ],
    }));
    const factory = new DatabaseEmailMessageFactory(
      { query } as unknown as Pool,
      config,
    );
    const message = await factory.create({
      attempts: 1,
      id: '22222222-2222-4222-8222-222222222222',
      type: 'REGISTRATION_TICKET',
    });

    expect(message.subject).not.toContain('\r');
    expect(message.subject).not.toContain('\n');
    expect(message.html).toContain('&lt;Иванов&gt;');
    expect(message.html).toContain('&lt;Москва&gt;');
    expect(message.html).not.toContain('<Иванов>');
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.contentType).toBe('image/png');
    expect(message.attachments[0]?.content.length).toBeGreaterThan(100);
  });

  it('reconstructs a one-time auth link from durable record context', async () => {
    const expiresAt = new Date('2027-06-10T10:00:00.000Z');
    const recordId = '33333333-3333-4333-8333-333333333333';
    const query = vi.fn(async () => ({
      rows: [
        {
          recipient_email: 'scanner@example.test',
          record_id: recordId,
          expires_at: expiresAt,
        },
      ],
    }));
    const factory = new DatabaseEmailMessageFactory(
      { query } as unknown as Pool,
      config,
    );
    const message = await factory.create({
      attempts: 1,
      id: '44444444-4444-4444-8444-444444444444',
      type: 'STAFF_INVITATION',
    });
    const expectedToken = authLinkToken(
      'invitation',
      recordId,
      expiresAt,
      config.AUTH_LINK_SECRET,
    );

    expect(message.html).toContain(encodeURIComponent(expectedToken));
    expect(message.attachments).toEqual([]);
  });
});
