import { describe, expect, it } from 'vitest';

import {
  createEventRequestSchema,
  attendanceSyncRequestSchema,
  excelImportCommitRequestSchema,
  healthResponseSchema,
  passwordResetRequestSchema,
  scannerOnsiteRegistrationRequestSchema,
  publicRegistrationRequestSchema,
  sendTicketsRequestSchema,
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

  it('bounds attendance batches and rejects duplicate client event ids', () => {
    const clientEventId = '11111111-1111-4111-8111-111111111111';
    const item = {
      clientEventId,
      registrationId: '22222222-2222-4222-8222-222222222222',
      mode: 'FAST_SCAN',
      source: 'OFFLINE_SYNC',
      deviceScannedAt: '2027-06-10T10:00:00.000Z',
      estimatedScannedAt: '2027-06-10T10:00:00.000Z',
    };
    expect(() =>
      attendanceSyncRequestSchema.parse({
        deviceId: '33333333-3333-4333-8333-333333333333',
        events: [item, item],
      }),
    ).toThrow();
  });

  it('requires a Person selection for Excel USE_PERSON decisions', () => {
    const request = {
      mapping: {
        lastName: 'Фамилия',
        firstName: 'Имя',
        birthDate: 'Дата рождения',
        personType: 'Тип участника',
        phone: 'Телефон',
        customFields: {},
      },
      decisions: [{ rowNumber: 2, action: 'USE_PERSON' }],
    };
    expect(() => excelImportCommitRequestSchema.parse(request)).toThrow();
    expect(
      excelImportCommitRequestSchema.parse({
        ...request,
        decisions: [
          {
            rowNumber: 2,
            action: 'USE_PERSON',
            personId: '44444444-4444-4444-8444-444444444444',
          },
        ],
      }).capacityOverride,
    ).toBe(false);
  });

  it('requires an idempotency id and unique explicit ticket recipients', () => {
    const requestId = '55555555-5555-4555-8555-555555555555';
    const registrationId = '66666666-6666-4666-8666-666666666666';
    expect(
      sendTicketsRequestSchema.parse({ requestId, selection: 'IMPORTED' }),
    ).toEqual({ requestId, selection: 'IMPORTED' });
    expect(() =>
      sendTicketsRequestSchema.parse({
        requestId,
        selection: 'REGISTRATION_IDS',
        registrationIds: [registrationId, registrationId],
      }),
    ).toThrow();
  });
});
