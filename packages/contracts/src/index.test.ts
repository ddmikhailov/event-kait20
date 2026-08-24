import { describe, expect, it } from 'vitest';

import {
  createEventRequestSchema,
  healthResponseSchema,
  passwordResetRequestSchema,
  scannerOnsiteRegistrationRequestSchema,
  publicRegistrationRequestSchema,
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

  it('normalizes a public registration and enforces conditional fields', () => {
    const result = publicRegistrationRequestSchema.parse({
      lastName: ' Иванов ',
      firstName: 'Иван',
      birthDate: '2005-01-02',
      email: ' IVAN@example.test ',
      phone: '8 (999) 123-45-67',
      studyGroup: 'ИС-21',
      personType: 'KAIT_STUDENT',
      consentAccepted: true,
      consentVersion: 'v1',
      customAnswers: [],
    });
    expect(result.email).toBe('ivan@example.test');
    expect(result.phone).toBe('+79991234567');
    expect(() =>
      publicRegistrationRequestSchema.parse({
        ...result,
        personType: 'EXTERNAL_STUDENT',
        organization: null,
      }),
    ).toThrow();
  });

  it('allows onsite registration without email but rejects scanner overbooking flags', () => {
    const values = {
      lastName: 'Петров',
      firstName: 'Пётр',
      birthDate: '2004-03-04',
      phone: '8 999 555 44 33',
      studyGroup: 'ИС-22',
      personType: 'KAIT_STUDENT' as const,
      customAnswers: [],
    };
    expect(scannerOnsiteRegistrationRequestSchema.parse(values).email).toBe(
      undefined,
    );
    expect(() =>
      scannerOnsiteRegistrationRequestSchema.parse({
        ...values,
        capacityOverride: true,
      }),
    ).toThrow();
  });
});
