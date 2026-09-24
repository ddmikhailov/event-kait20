import { describe, expect, it } from 'vitest';

import {
  activityOperationResponseSchema,
  calculationSnapshotSchema,
  createEventRequestSchema,
  attendanceSyncRequestSchema,
  excelImportCommitRequestSchema,
  healthResponseSchema,
  manualAdjustmentPointsSchema,
  manualAdjustmentRequestSchema,
  passwordResetRequestSchema,
  participationConfirmRequestSchema,
  policyVersionDetailSchema,
  publicProfileSchema,
  scannerOnsiteRegistrationRequestSchema,
  publicRegistrationRequestSchema,
  publicRegistrationResponseSchema,
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

  it('normalizes registration; event configuration controls conditional requirements', () => {
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
    ).not.toThrow();
    for (const personType of ['PARENT', 'OTHER'] as const) {
      expect(
        publicRegistrationRequestSchema.parse({
          ...result,
          personType,
          studyGroup: null,
          organization: null,
        }).personType,
      ).toBe(personType);
    }
  });

  it('keeps an existing public registration response free of ticket capabilities', () => {
    const response = publicRegistrationResponseSchema.parse({
      status: 'ALREADY_REGISTERED',
      recoveryQueued: true,
    });
    expect(response).toEqual({
      status: 'ALREADY_REGISTERED',
      recoveryQueued: true,
    });
    expect(() =>
      publicRegistrationResponseSchema.parse({
        status: 'ALREADY_REGISTERED',
        recoveryQueued: true,
        registrationId: '22222222-2222-4222-8222-222222222222',
        ticketUrl: 'https://example.test/ticket',
      }),
    ).toThrow();
  });

  it('allows onsite registration without email and an explicit capacity override', () => {
    const values = {
      consentAccepted: true,
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
    expect(
      scannerOnsiteRegistrationRequestSchema.parse({
        ...values,
        capacityOverride: true,
      }).capacityOverride,
    ).toBe(true);
    expect(
      scannerOnsiteRegistrationRequestSchema.parse(values).capacityOverride,
    ).toBeUndefined();
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

  it('requires an audit reason when participation is confirmed without attendance', () => {
    const registrationId = '11111111-1111-4111-8111-111111111111';
    expect(() =>
      participationConfirmRequestSchema.parse({
        registrationIds: [registrationId],
        confirmWithoutAttendance: true,
      }),
    ).toThrow();
    expect(
      participationConfirmRequestSchema.parse({
        registrationIds: [registrationId],
        confirmWithoutAttendance: true,
        overrideReason: 'Подтверждено по ведомости организатора',
      }).confirmWithoutAttendance,
    ).toBe(true);
  });

  it('keeps public activity profiles free of internal person identifiers and PII', () => {
    expect(
      publicProfileSchema.parse({
        publicSlug: 'public-profile-slug',
        displayName: 'Иванов Иван',
        totalPoints: '25.0000',
      }),
    ).toEqual({
      publicSlug: 'public-profile-slug',
      displayName: 'Иванов Иван',
      totalPoints: '25.0000',
    });
    expect(() =>
      publicProfileSchema.parse({
        publicSlug: 'public-profile-slug',
        personId: '22222222-2222-4222-8222-222222222222',
        email: 'student@example.com',
      }),
    ).toThrow();
  });

  it('parses idempotent activity operation responses', () => {
    expect(activityOperationResponseSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    });
  });

  it('requires explicit UTC in scoring calculation Event timestamps', () => {
    const snapshot = {
      snapshotSchemaVersion: 1,
      engineVersion: 'V2',
      scoringPolicyId: '11111111-1111-4111-8111-111111111111',
      policyVersionId: '22222222-2222-4222-8222-222222222222',
      policyVersion: 1,
      policyVersionStatus: 'PUBLISHED',
      eventId: '33333333-3333-4333-8333-333333333333',
      eventStartAt: '2026-10-01T10:00:00Z',
      eventMoscowDate: '2026-10-01',
      seasonId: '44444444-4444-4444-8444-444444444444',
      participationId: '55555555-5555-4555-8555-555555555555',
      personId: '66666666-6666-4666-8666-666666666666',
      role: {
        id: 'role',
        code: 'ORGANIZER',
        name: 'Организатор',
        value: '3.0000',
      },
      level: { id: 'level', code: 'CITY', name: 'Городской', value: '2.0000' },
      statuses: [],
      newcomer: { sequence: 1, value: '1.0000' },
      result: null,
      multiplicativeSubtotal: '6.0000',
      resultBonus: '0.0000',
      finalPoints: '6.0000',
      roundingMode: 'ROUND_HALF_UP',
      calculatedAt: '2026-10-02T10:00:00Z',
    };
    expect(calculationSnapshotSchema.parse(snapshot).eventStartAt).toBe(
      '2026-10-01T10:00:00Z',
    );
    expect(() =>
      calculationSnapshotSchema.parse({
        ...snapshot,
        eventStartAt: '2026-10-01T13:00:00+03:00',
      }),
    ).toThrow();
  });

  it('parses a policy version detail with its components', () => {
    const detail = policyVersionDetailSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      scoringPolicyId: '22222222-2222-4222-8222-222222222222',
      version: 1,
      status: 'DRAFT',
      effectiveFrom: null,
      effectiveTo: null,
      createdAt: '2026-01-01T00:00:00Z',
      publishedAt: null,
      retiredAt: null,
      createdBy: '33333333-3333-4333-8333-333333333333',
      roleBases: [
        {
          classifierId: '44444444-4444-4444-8444-444444444444',
          value: '3.0000',
        },
      ],
      levelMultipliers: [],
      statusMultipliers: [],
      newcomerTiers: [{ sequenceFrom: 1, sequenceTo: null, value: '1.5000' }],
      resultBonuses: [],
    });
    expect(detail.status).toBe('DRAFT');
    expect(detail.roleBases[0]?.value).toBe('3.0000');
    expect(() =>
      policyVersionDetailSchema.parse({ id: 'not-a-uuid' }),
    ).toThrow();
  });

  it('accepts exactly the range the backend Manual Adjustment Decimal(ge=-1_000_000, le=1_000_000, decimal_places=4) allows', () => {
    for (const value of [
      '0.0001',
      '-0.0001',
      '999999.9999',
      '1000000',
      '1000000.0000',
      '-1000000.0000',
      '5',
      '0.5',
      '-0.5000',
    ]) {
      expect(
        manualAdjustmentPointsSchema.safeParse(value).success,
        `expected ${value} to PASS`,
      ).toBe(true);
    }
    for (const value of [
      '0',
      '0.0000',
      '-0.0000',
      '1000000.0001',
      '-1000000.0001',
      '1000001',
      '-1000001',
      '1.00000',
      '00.5',
      '000001',
      'not-a-number',
    ]) {
      expect(
        manualAdjustmentPointsSchema.safeParse(value).success,
        `expected ${value} to FAIL`,
      ).toBe(false);
    }
  });

  it('requires the full Manual Adjustment request (points AND reason) to pass before a request is considered valid', () => {
    const base = {
      requestId: '11111111-1111-4111-8111-111111111111',
      personId: '22222222-2222-4222-8222-222222222222',
      seasonId: '33333333-3333-4333-8333-333333333333',
      points: '5.0000',
      reason: 'Подтверждённая ручная корректировка',
    };
    expect(manualAdjustmentRequestSchema.safeParse(base).success).toBe(true);
    expect(
      manualAdjustmentRequestSchema.safeParse({ ...base, reason: 'ab' })
        .success,
    ).toBe(false);
    expect(
      manualAdjustmentRequestSchema.safeParse({ ...base, reason: 'abc' })
        .success,
    ).toBe(true);
    expect(
      manualAdjustmentRequestSchema.safeParse({
        ...base,
        reason: 'x'.repeat(500),
      }).success,
    ).toBe(true);
    expect(
      manualAdjustmentRequestSchema.safeParse({
        ...base,
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false);
    expect(
      manualAdjustmentRequestSchema.safeParse({ ...base, points: '1000001' })
        .success,
    ).toBe(false);
  });
});
