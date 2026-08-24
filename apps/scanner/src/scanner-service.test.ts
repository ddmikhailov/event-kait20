import 'fake-indexeddb/auto';

import type {
  AttendanceSyncRequest,
  OfflineBundleResponse,
} from '@event-registration/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, type ScannerApiClient } from './api-client.js';
import { ScannerDatabase, sha256 } from './offline-database.js';
import { ScannerService } from './scanner-service.js';

const eventId = '10000000-0000-4000-8000-000000000001';
const registrationId = '20000000-0000-4000-8000-000000000001';
const qrPayload = 'ticket.payload.signature';
const event = {
  id: eventId,
  title: 'День открытых дверей',
  startAt: '2026-09-01T07:00:00.000Z',
  endAt: '2026-09-01T15:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'Главный корпус',
  status: 'ACTIVE' as const,
};

let database: ScannerDatabase;

const makeBundle = async (version = '1'): Promise<OfflineBundleResponse> => {
  const registrations = [
    {
      registrationId,
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: null,
      phone: null,
      studyGroup: 'ИС-101',
      personType: 'KAIT_STUDENT' as const,
      organization: null,
      firstAttendedAt: null,
      qrPayloadHash: await sha256(qrPayload),
    },
  ];
  return {
    eventId,
    version,
    generatedAt: '2026-08-31T09:00:00.000Z',
    expiresAt: '2026-09-02T09:00:00.000Z',
    serverTime: new Date().toISOString(),
    registrationCount: registrations.length,
    checksum: await sha256(JSON.stringify(registrations)),
    registrations,
  };
};

beforeEach(() => {
  database = new ScannerDatabase(`scanner-service-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await database.delete();
});

describe('scanner service', () => {
  it('revalidates, sends pending attendance, then refreshes the bundle', async () => {
    await database.replaceBundle(await makeBundle(), 0, event);
    const pending = await database.queueAttendance(
      eventId,
      registrationId,
      'FAST_SCAN',
      'OFFLINE_SYNC',
    );
    const order: string[] = [];
    const api = {
      restoreSession: vi.fn(() => {
        order.push('session');
        return Promise.resolve({ authenticated: true });
      }),
      sync: vi.fn((_id: string, request: AttendanceSyncRequest) => {
        order.push('sync');
        return Promise.resolve({
          offlineDataVersion: '2',
          results: request.events.map((item) => ({
            clientEventId: item.clientEventId,
            status: 'ACCEPTED' as const,
            firstAttendedAt: '2026-09-01T07:05:00.000Z',
          })),
        });
      }),
      bundle: vi.fn(async () => {
        order.push('bundle');
        return makeBundle('2');
      }),
    } as unknown as ScannerApiClient;

    await new ScannerService(api, database, () => true).reconnect(eventId);

    expect(order).toEqual(['session', 'sync', 'bundle']);
    await expect(
      database.pendingAttendance.get(pending.clientEventId),
    ).resolves.toBeUndefined();
    await expect(database.preparedEvents.get(eventId)).resolves.toMatchObject({
      version: '2',
    });
  });

  it('falls back to the verified local QR hash on a network failure', async () => {
    await database.replaceBundle(await makeBundle(), 0, event);
    const api = {
      resolveQr: vi.fn(() =>
        Promise.reject(
          new ApiClientError('NETWORK_ERROR', 0, 'Сервер недоступен'),
        ),
      ),
    } as unknown as ScannerApiClient;

    await expect(
      new ScannerService(api, database, () => true).resolveQr(
        eventId,
        qrPayload,
      ),
    ).resolves.toMatchObject({ registrationId, offline: true });
  });
});
