import 'fake-indexeddb/auto';

import type {
  AttendanceSyncResponse,
  OfflineBundleResponse,
} from '@event-registration/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BundleIntegrityError,
  ScannerDatabase,
  sha256,
} from './offline-database.js';

const eventId = '10000000-0000-4000-8000-000000000001';
const registrationId = '20000000-0000-4000-8000-000000000001';
const qrPayload = 'ticket.payload.signature';
const eventSummary = {
  title: 'День открытых дверей',
  startAt: '2026-09-01T07:00:00.000Z',
  endAt: '2026-09-01T15:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'Главный корпус',
};

let database: ScannerDatabase;

const bundle = async (
  overrides: Partial<OfflineBundleResponse> = {},
): Promise<OfflineBundleResponse> => {
  const registrations = [
    {
      registrationId,
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: 'Иванович',
      phone: '+79990000000',
      studyGroup: 'ИС-101',
      personType: 'KAIT_STUDENT' as const,
      organization: null,
      firstAttendedAt: null,
      qrPayloadHash: await sha256(qrPayload),
    },
  ];
  return {
    eventId,
    version: '1',
    generatedAt: '2026-08-31T09:00:00.000Z',
    expiresAt: '2026-09-02T09:00:00.000Z',
    serverTime: '2026-08-31T09:00:00.000Z',
    registrationCount: registrations.length,
    checksum: await sha256(JSON.stringify(registrations)),
    registrations,
    ...overrides,
  };
};

beforeEach(() => {
  database = new ScannerDatabase(`scanner-test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await database.delete();
});

describe('offline scanner database', () => {
  it('installs a verified bundle and supports QR lookup and local search', async () => {
    await database.replaceBundle(await bundle(), 250, eventSummary);

    await expect(database.lookupQr(eventId, qrPayload)).resolves.toMatchObject({
      registrationId,
      lastName: 'Иванов',
    });
    await expect(
      database.search(eventId, 'иванов ис-101'),
    ).resolves.toHaveLength(1);
  });

  it('rejects a corrupt replacement without destroying the active bundle', async () => {
    await database.replaceBundle(await bundle(), 0, eventSummary);
    const corrupt = await bundle({ checksum: '0'.repeat(64) });

    await expect(database.replaceBundle(corrupt, 0)).rejects.toBeInstanceOf(
      BundleIntegrityError,
    );
    await expect(database.lookupQr(eventId, qrPayload)).resolves.toMatchObject({
      registrationId,
    });
  });

  it('preserves queued attendance while replacing a bundle', async () => {
    await database.replaceBundle(await bundle(), 0, eventSummary);
    const pending = await database.queueAttendance(
      eventId,
      registrationId,
      'FAST_SCAN',
      'OFFLINE_SYNC',
    );

    await database.replaceBundle(await bundle({ version: '2' }), 0);

    await expect(
      database.pendingAttendance.get(pending.clientEventId),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('removes accepted items and keeps rejected items visible', async () => {
    await database.replaceBundle(await bundle(), 0, eventSummary);
    const accepted = await database.queueAttendance(
      eventId,
      registrationId,
      'FAST_SCAN',
      'ONLINE',
    );
    const rejected = await database.queueAttendance(
      eventId,
      registrationId,
      'MANUAL_CONFIRM',
      'OFFLINE_SYNC',
    );
    const response: AttendanceSyncResponse = {
      offlineDataVersion: '2',
      results: [
        {
          clientEventId: accepted.clientEventId,
          status: 'ACCEPTED',
          firstAttendedAt: '2026-09-01T07:05:00.000Z',
        },
        {
          clientEventId: rejected.clientEventId,
          status: 'INVALID_TIMESTAMP',
          firstAttendedAt: null,
        },
      ],
    };

    await database.applySyncResults(eventId, response);

    await expect(database.pendingCount(eventId)).resolves.toBe(0);
    await expect(database.rejectedForEvent(eventId)).resolves.toMatchObject([
      { clientEventId: rejected.clientEventId, status: 'REJECTED' },
    ]);
    await expect(
      database.offlineRegistrations.get([eventId, registrationId]),
    ).resolves.toMatchObject({ firstAttendedAt: '2026-09-01T07:05:00.000Z' });
  });

  it('expires cached PII without deleting pending attendance', async () => {
    await database.replaceBundle(
      await bundle({ expiresAt: '2026-08-30T09:00:00.000Z' }),
      0,
      eventSummary,
    );
    const pending = await database.queueAttendance(
      eventId,
      registrationId,
      'FAST_SCAN',
      'OFFLINE_SYNC',
    );

    await database.clearExpired(new Date('2026-08-31T09:00:00.000Z'));

    await expect(database.preparedEvents.count()).resolves.toBe(0);
    await expect(database.offlineRegistrations.count()).resolves.toBe(0);
    await expect(
      database.pendingAttendance.get(pending.clientEventId),
    ).resolves.toBeDefined();
  });

  it('clears business data on logout but retains the anonymous device id', async () => {
    await database.replaceBundle(await bundle(), 0, eventSummary);
    await database.queueAttendance(
      eventId,
      registrationId,
      'FAST_SCAN',
      'OFFLINE_SYNC',
    );
    const deviceId = await database.deviceId();

    await database.clearBusinessData();

    await expect(database.preparedEvents.count()).resolves.toBe(0);
    await expect(database.pendingAttendance.count()).resolves.toBe(0);
    await expect(database.deviceId()).resolves.toBe(deviceId);
  });
});
