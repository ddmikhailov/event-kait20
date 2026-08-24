import type {
  AttendanceSyncRequest,
  AttendanceSyncResponse,
  OfflineBundleResponse,
  ResolveQrResponse,
} from '@event-registration/contracts';
import Dexie, { type Table } from 'dexie';

export type PreparedEventRecord = {
  checksum: string;
  clockOffsetMs: number;
  eventId: string;
  endAt: string;
  expiresAt: string;
  location: string;
  preparedAt: string;
  registrationCount: number;
  startAt: string;
  timezone: string;
  title: string;
  version: string;
};

export type OfflineRegistrationRecord = ResolveQrResponse & {
  eventId: string;
  qrPayloadHash: string;
  searchText: string;
};

export type PendingAttendanceRecord =
  AttendanceSyncRequest['events'][number] & {
    createdAt: string;
    deviceId: string;
    eventId: string;
    rejectionStatus?: AttendanceSyncResponse['results'][number]['status'];
    status: 'PENDING' | 'SYNCING' | 'REJECTED';
  };

type SyncStateRecord = {
  eventId: string;
  lastError: string | null;
  lastSyncAt: string | null;
  serverVersion: string | null;
};

type DeviceRecord = { key: 'device'; deviceId: string };

const confirmedStatuses = new Set([
  'ACCEPTED',
  'ALREADY_PROCESSED',
  'REGISTRATION_ALREADY_ATTENDED',
]);

export class BundleIntegrityError extends Error {
  public override readonly name = 'BUNDLE_INTEGRITY_ERROR';
}

export class ScannerDatabase extends Dexie {
  public preparedEvents!: Table<PreparedEventRecord, string>;
  public offlineRegistrations!: Table<
    OfflineRegistrationRecord,
    [string, string]
  >;
  public pendingAttendance!: Table<PendingAttendanceRecord, string>;
  public syncState!: Table<SyncStateRecord, string>;
  public devices!: Table<DeviceRecord, string>;

  public constructor(name = 'event-registration-scanner') {
    super(name);
    this.version(1).stores({
      preparedEvents: '&eventId,expiresAt',
      offlineRegistrations:
        '&[eventId+registrationId],[eventId+qrPayloadHash],eventId,searchText',
      pendingAttendance: '&clientEventId,eventId,status,createdAt',
      syncState: '&eventId',
      devices: '&key',
    });
  }

  public async replaceBundle(
    bundle: OfflineBundleResponse,
    clockOffsetMs: number,
    event?: {
      endAt: string;
      location: string;
      startAt: string;
      timezone: string;
      title: string;
    },
  ): Promise<void> {
    if (
      bundle.registrationCount !== bundle.registrations.length ||
      (await sha256(JSON.stringify(bundle.registrations))) !== bundle.checksum
    ) {
      throw new BundleIntegrityError('Offline bundle integrity check failed');
    }
    const registrations = bundle.registrations.map((registration) => ({
      ...registration,
      eventId: bundle.eventId,
      searchText: normalizeSearch([
        registration.lastName,
        registration.firstName,
        registration.middleName,
        registration.phone,
        registration.studyGroup,
        registration.organization,
      ]),
    }));
    const previous = await this.preparedEvents.get(bundle.eventId);
    const summary = event ?? previous;
    if (!summary) {
      throw new BundleIntegrityError(
        'Event summary is required for preparation',
      );
    }
    await this.transaction(
      'rw',
      this.preparedEvents,
      this.offlineRegistrations,
      this.syncState,
      async () => {
        await this.offlineRegistrations
          .where('eventId')
          .equals(bundle.eventId)
          .delete();
        await this.offlineRegistrations.bulkPut(registrations);
        await this.preparedEvents.put({
          eventId: bundle.eventId,
          title: summary.title,
          startAt: summary.startAt,
          endAt: summary.endAt,
          timezone: summary.timezone,
          location: summary.location,
          version: bundle.version,
          checksum: bundle.checksum,
          registrationCount: bundle.registrationCount,
          expiresAt: bundle.expiresAt,
          preparedAt: new Date().toISOString(),
          clockOffsetMs,
        });
        await this.syncState.put({
          eventId: bundle.eventId,
          lastError: null,
          lastSyncAt: new Date().toISOString(),
          serverVersion: bundle.version,
        });
      },
    );
  }

  public async lookupQr(
    eventId: string,
    qrPayload: string,
  ): Promise<OfflineRegistrationRecord | undefined> {
    const hash = await sha256(qrPayload);
    return this.offlineRegistrations
      .where('[eventId+qrPayloadHash]')
      .equals([eventId, hash])
      .first();
  }

  public async search(
    eventId: string,
    query: string,
    limit = 50,
  ): Promise<OfflineRegistrationRecord[]> {
    const normalized = normalizeSearch([query]);
    const terms = normalized.split(' ').filter(Boolean);
    return this.offlineRegistrations
      .where('eventId')
      .equals(eventId)
      .filter(
        (registration) =>
          terms.length === 0 ||
          terms.every((term) => registration.searchText.includes(term)),
      )
      .limit(Math.min(limit, 100))
      .toArray();
  }

  public async queueAttendance(
    eventId: string,
    registrationId: string,
    mode: AttendanceSyncRequest['events'][number]['mode'],
    source: AttendanceSyncRequest['events'][number]['source'],
    scannedAt = new Date(),
  ): Promise<PendingAttendanceRecord> {
    const [deviceId, prepared] = await Promise.all([
      this.deviceId(),
      this.preparedEvents.get(eventId),
    ]);
    const estimated = new Date(
      scannedAt.getTime() + (prepared?.clockOffsetMs ?? 0),
    );
    const pending: PendingAttendanceRecord = {
      clientEventId: crypto.randomUUID(),
      eventId,
      registrationId,
      deviceId,
      mode,
      source,
      deviceScannedAt: scannedAt.toISOString(),
      estimatedScannedAt: estimated.toISOString(),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    await this.pendingAttendance.add(pending);
    return pending;
  }

  public pendingForEvent(eventId: string): Promise<PendingAttendanceRecord[]> {
    return this.pendingAttendance
      .where('eventId')
      .equals(eventId)
      .filter((item) => item.status !== 'REJECTED')
      .sortBy('createdAt');
  }

  public pendingCount(eventId?: string): Promise<number> {
    const collection = eventId
      ? this.pendingAttendance.where('eventId').equals(eventId)
      : this.pendingAttendance.toCollection();
    return collection.filter((item) => item.status !== 'REJECTED').count();
  }

  public rejectedForEvent(eventId: string): Promise<PendingAttendanceRecord[]> {
    return this.pendingAttendance
      .where('eventId')
      .equals(eventId)
      .filter((item) => item.status === 'REJECTED')
      .sortBy('createdAt');
  }

  public async markSyncing(clientEventIds: string[]): Promise<void> {
    await this.updatePendingStatus(clientEventIds, 'SYNCING');
  }

  public async resetPending(clientEventIds: string[]): Promise<void> {
    await this.updatePendingStatus(clientEventIds, 'PENDING');
  }

  public async applySyncResults(
    eventId: string,
    response: AttendanceSyncResponse,
  ): Promise<void> {
    await this.transaction(
      'rw',
      this.pendingAttendance,
      this.offlineRegistrations,
      this.syncState,
      async () => {
        for (const result of response.results) {
          const pending = await this.pendingAttendance.get(
            result.clientEventId,
          );
          if (confirmedStatuses.has(result.status)) {
            await this.pendingAttendance.delete(result.clientEventId);
            if (result.firstAttendedAt && pending) {
              await this.offlineRegistrations.update(
                [eventId, pending.registrationId],
                { firstAttendedAt: result.firstAttendedAt },
              );
            }
          } else {
            await this.pendingAttendance.update(result.clientEventId, {
              status: 'REJECTED',
              rejectionStatus: result.status,
            });
          }
        }
        await this.syncState.put({
          eventId,
          lastError: null,
          lastSyncAt: new Date().toISOString(),
          serverVersion: response.offlineDataVersion,
        });
      },
    );
  }

  public async recordSyncError(
    eventId: string,
    errorCode: string,
  ): Promise<void> {
    const previous = await this.syncState.get(eventId);
    await this.syncState.put({
      eventId,
      lastError: errorCode.slice(0, 100),
      lastSyncAt: previous?.lastSyncAt ?? null,
      serverVersion: previous?.serverVersion ?? null,
    });
  }

  public async clearExpired(now = new Date()): Promise<void> {
    const expired = await this.preparedEvents
      .where('expiresAt')
      .belowOrEqual(now.toISOString())
      .primaryKeys();
    await this.transaction(
      'rw',
      this.preparedEvents,
      this.offlineRegistrations,
      this.syncState,
      async () => {
        for (const eventId of expired) {
          await this.preparedEvents.delete(eventId);
          await this.offlineRegistrations
            .where('eventId')
            .equals(eventId)
            .delete();
          await this.syncState.delete(eventId);
        }
      },
    );
  }

  public async clearBusinessData(): Promise<void> {
    await this.transaction(
      'rw',
      this.preparedEvents,
      this.offlineRegistrations,
      this.pendingAttendance,
      this.syncState,
      async () => {
        await Promise.all([
          this.preparedEvents.clear(),
          this.offlineRegistrations.clear(),
          this.pendingAttendance.clear(),
          this.syncState.clear(),
        ]);
      },
    );
  }

  public async deviceId(): Promise<string> {
    const existing = await this.devices.get('device');
    if (existing) return existing.deviceId;
    const deviceId = crypto.randomUUID();
    await this.devices.put({ key: 'device', deviceId });
    return deviceId;
  }

  private async updatePendingStatus(
    clientEventIds: string[],
    status: PendingAttendanceRecord['status'],
  ): Promise<void> {
    await this.transaction('rw', this.pendingAttendance, async () => {
      for (const clientEventId of clientEventIds) {
        await this.pendingAttendance.update(clientEventId, { status });
      }
    });
  }
}

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const normalizeSearch = (values: (string | null | undefined)[]): string =>
  values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase('ru')
    .replace(/\s+/g, ' ')
    .trim();

export const scannerDatabase = new ScannerDatabase();
