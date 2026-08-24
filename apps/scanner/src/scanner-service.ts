import type {
  AttendanceMode,
  AttendanceSyncResponse,
  OfflineBundleResponse,
  ResolveQrResponse,
} from './scanner-types.js';
import type { ScannerEventListResponse } from '@event-registration/contracts';

import { ApiClientError, type ScannerApiClient } from './api-client.js';
import type {
  OfflineRegistrationRecord,
  ScannerDatabase,
} from './offline-database.js';
import { scannerDatabase } from './offline-database.js';
import { scannerApi } from './api-client.js';

export type ScanResolution = ResolveQrResponse & { offline: boolean };
export type AttendanceOutcome =
  | AttendanceSyncResponse['results'][number]
  | { clientEventId: string; firstAttendedAt: null; status: 'QUEUED' };
export type ScannerEvent = ScannerEventListResponse['items'][number];

export class OfflineScannerError extends Error {
  public override readonly name = 'OFFLINE_SCANNER_ERROR';

  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ScannerService {
  public constructor(
    private readonly api: ScannerApiClient,
    private readonly database: ScannerDatabase,
    private readonly online: () => boolean = () => navigator.onLine,
  ) {}

  public async prepareEvent(
    event: ScannerEvent,
  ): Promise<OfflineBundleResponse> {
    await this.requireSession();
    return this.downloadAndReplace(event.id, event);
  }

  public async resolveQr(
    eventId: string,
    qrPayload: string,
  ): Promise<ScanResolution> {
    if (this.online()) {
      try {
        return {
          ...(await this.api.resolveQr(eventId, qrPayload)),
          offline: false,
        };
      } catch (error) {
        if (
          !(error instanceof ApiClientError) ||
          error.code !== 'NETWORK_ERROR'
        ) {
          throw error;
        }
      }
    }
    await this.database.clearExpired();
    const registration = await this.database.lookupQr(eventId, qrPayload);
    if (!registration) {
      throw new OfflineScannerError(
        'INVALID_QR',
        'QR отсутствует в подготовленных данных',
      );
    }
    return { ...scannerResponse(registration), offline: true };
  }

  public async search(
    eventId: string,
    query: string,
  ): Promise<ScanResolution[]> {
    if (this.online()) {
      try {
        const response = await this.api.search(eventId, query);
        return response.items.map((item) => ({
          registrationId: item.id,
          lastName: item.lastName,
          firstName: item.firstName,
          middleName: item.middleName,
          phone: item.phone,
          studyGroup: item.studyGroup,
          personType: item.personType,
          organization: item.organization,
          firstAttendedAt: item.firstAttendedAt,
          offline: false,
        }));
      } catch (error) {
        if (
          !(error instanceof ApiClientError) ||
          error.code !== 'NETWORK_ERROR'
        ) {
          throw error;
        }
      }
    }
    await this.database.clearExpired();
    return (await this.database.search(eventId, query)).map((item) => ({
      ...scannerResponse(item),
      offline: true,
    }));
  }

  public async recordAttendance(
    eventId: string,
    registrationId: string,
    mode: AttendanceMode,
  ): Promise<AttendanceOutcome> {
    const pending = await this.database.queueAttendance(
      eventId,
      registrationId,
      mode,
      this.online() ? 'ONLINE' : 'OFFLINE_SYNC',
    );
    if (!this.online()) {
      return {
        clientEventId: pending.clientEventId,
        status: 'QUEUED',
        firstAttendedAt: null,
      };
    }
    try {
      const response = await this.flushPending(eventId, false);
      return (
        response?.results.find(
          (result) => result.clientEventId === pending.clientEventId,
        ) ?? {
          clientEventId: pending.clientEventId,
          status: 'QUEUED',
          firstAttendedAt: null,
        }
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') {
        return {
          clientEventId: pending.clientEventId,
          status: 'QUEUED',
          firstAttendedAt: null,
        };
      }
      throw error;
    }
  }

  public async reconnect(eventId: string): Promise<void> {
    await this.requireSession();
    await this.flushPending(eventId, false);
    await this.downloadAndReplace(eventId);
  }

  public async flushPending(
    eventId: string,
    revalidateSession = true,
  ): Promise<AttendanceSyncResponse | undefined> {
    if (revalidateSession) await this.requireSession();
    const pending = await this.database.pendingForEvent(eventId);
    let lastResponse: AttendanceSyncResponse | undefined;
    for (let offset = 0; offset < pending.length; offset += 500) {
      const batch = pending.slice(offset, offset + 500);
      const ids = batch.map((item) => item.clientEventId);
      await this.database.markSyncing(ids);
      try {
        const response = await this.api.sync(eventId, {
          deviceId: batch[0]!.deviceId,
          events: batch.map((item) => ({
            clientEventId: item.clientEventId,
            registrationId: item.registrationId,
            mode: item.mode,
            source: item.source,
            deviceScannedAt: item.deviceScannedAt,
            estimatedScannedAt: item.estimatedScannedAt,
          })),
        });
        await this.database.applySyncResults(eventId, response);
        lastResponse = response;
      } catch (error) {
        await this.database.resetPending(ids);
        await this.database.recordSyncError(eventId, errorCode(error));
        throw error;
      }
    }
    return lastResponse;
  }

  private async requireSession(): Promise<void> {
    const session = await this.api.restoreSession();
    if (!session) {
      throw new OfflineScannerError(
        'ACCESS_REVALIDATION_REQUIRED',
        'Требуется повторный вход',
      );
    }
  }

  private async downloadAndReplace(
    eventId: string,
    event?: ScannerEvent,
  ): Promise<OfflineBundleResponse> {
    const startedAt = Date.now();
    const bundle = await this.api.bundle(eventId);
    const midpoint = startedAt + (Date.now() - startedAt) / 2;
    const clockOffsetMs = new Date(bundle.serverTime).getTime() - midpoint;
    await this.database.replaceBundle(bundle, clockOffsetMs, event);
    return bundle;
  }
}

const scannerResponse = (
  registration: OfflineRegistrationRecord,
): ResolveQrResponse => ({
  registrationId: registration.registrationId,
  lastName: registration.lastName,
  firstName: registration.firstName,
  middleName: registration.middleName,
  phone: registration.phone,
  studyGroup: registration.studyGroup,
  personType: registration.personType,
  organization: registration.organization,
  firstAttendedAt: registration.firstAttendedAt,
});

const errorCode = (error: unknown): string =>
  error instanceof ApiClientError || error instanceof OfflineScannerError
    ? error.code
    : 'SYNC_ERROR';

export const scannerService = new ScannerService(scannerApi, scannerDatabase);
