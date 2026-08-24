import { describe, expect, it, vi } from 'vitest';

import {
  EmailDeliveryProcessor,
  type ClaimedDelivery,
  type EmailDeliveryRepository,
  type EmailMessage,
} from './email-delivery.js';

const delivery: ClaimedDelivery = {
  attempts: 1,
  id: '11111111-1111-4111-8111-111111111111',
  type: 'REGISTRATION_TICKET',
};
const message: EmailMessage = {
  attachments: [],
  html: '<p>Ticket</p>',
  subject: 'Ticket',
  to: 'participant@example.test',
};

const repository = (claimed: ClaimedDelivery | undefined) => ({
  claimNext: vi.fn(async () => claimed),
  markFailed: vi.fn(async () => undefined),
  markSent: vi.fn(async () => undefined),
});

describe('EmailDeliveryProcessor', () => {
  it('sends a claimed message with a stable idempotency key', async () => {
    const deliveries = repository(delivery);
    const messages = { create: vi.fn(async () => message) };
    const transport = { send: vi.fn(async () => 'provider-message-1') };
    const processor = new EmailDeliveryProcessor(
      deliveries,
      messages,
      transport,
      5,
    );

    await expect(processor.processOne()).resolves.toBe(true);
    expect(transport.send).toHaveBeenCalledWith(message, delivery.id);
    expect(deliveries.markSent).toHaveBeenCalledWith(
      delivery.id,
      'provider-message-1',
    );
    expect(deliveries.markFailed).not.toHaveBeenCalled();
  });

  it('records only a bounded error code and leaves retry policy to the repository', async () => {
    const deliveries = repository(delivery);
    const messages = {
      create: vi.fn(async () => {
        const error = new Error('participant@example.test must not be stored');
        error.name = 'PROVIDER_TEMPORARY_ERROR';
        throw error;
      }),
    };
    const processor = new EmailDeliveryProcessor(
      deliveries,
      messages,
      { send: vi.fn() },
      5,
    );

    await expect(processor.processOne()).resolves.toBe(true);
    expect(deliveries.markFailed).toHaveBeenCalledWith(
      delivery,
      'PROVIDER_TEMPORARY_ERROR',
      5,
    );
    expect(deliveries.markFailed.mock.calls[0]?.join(' ')).not.toContain(
      'participant@example.test',
    );
  });

  it('returns without side effects when no delivery is available', async () => {
    const deliveries = repository(undefined);
    const processor = new EmailDeliveryProcessor(
      deliveries as EmailDeliveryRepository,
      { create: vi.fn() },
      { send: vi.fn() },
      5,
    );

    await expect(processor.processOne()).resolves.toBe(false);
    expect(deliveries.markSent).not.toHaveBeenCalled();
  });
});
