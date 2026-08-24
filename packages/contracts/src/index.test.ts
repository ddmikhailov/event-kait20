import { describe, expect, it } from 'vitest';

import {
  createEventRequestSchema,
  healthResponseSchema,
  passwordResetRequestSchema,
} from './index';

describe('healthResponseSchema', () => {
  it('accepts the shared health response', () => {
    expect(
      healthResponseSchema.parse({ service: 'api', status: 'ok' }),
    ).toEqual({ service: 'api', status: 'ok' });
  });

  it('enforces the staff password baseline', () => {
    expect(() =>
      passwordResetRequestSchema.parse({
        token: 'x'.repeat(20),
        password: 'short',
      }),
    ).toThrow();
  });

  it('accepts a valid event request', () => {
    expect(
      createEventRequestSchema.parse({
        title: 'Event',
        slug: 'event',
        startAt: '2027-01-02T10:00:00.000Z',
        endAt: '2027-01-02T12:00:00.000Z',
        registrationDeadline: '2027-01-01T10:00:00.000Z',
        location: 'Moscow',
        capacity: 100,
      }).timezone,
    ).toBe('Europe/Moscow');
  });
});
