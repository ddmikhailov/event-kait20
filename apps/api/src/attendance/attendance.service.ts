import { createHash, randomUUID } from 'node:crypto';

import type {
  AttendanceSyncRequest,
  AttendanceSyncResponse,
  OfflineBundleResponse,
  ResolveQrResponse,
} from '@event-registration/contracts';
import { registrationQrPayloadHash } from '@event-registration/utils';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { ApiError } from '../common/api-error.js';
import { DATABASE_POOL } from '../common/tokens.js';
import { RegistrationReferenceService } from '../registrations/registration-reference.service.js';

type ScannerActor = { id: string; role: 'SUPER_ADMIN' | 'SCANNER' };
type EventContext = {
  end_at: Date;
  id: string;
  offline_data_version: string;
  start_at: Date;
};
type ScannerRegistrationRow = {
  first_attended_at: Date | null;
  first_name: string;
  id: string;
  last_name: string;
  middle_name: string | null;
  organization: string | null;
  person_type: ResolveQrResponse['personType'];
  phone: string | null;
  public_id: string;
  status: 'ACTIVE' | 'ANNULLED';
  study_group: string | null;
};
type SyncResult = AttendanceSyncResponse['results'][number];

@Injectable()
export class AttendanceService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(RegistrationReferenceService)
    private readonly references: RegistrationReferenceService,
  ) {}

  public async resolveQr(
    eventId: string,
    qrPayload: string,
    actor: ScannerActor,
  ): Promise<ResolveQrResponse> {
    await this.eventContext(eventId, actor);
    const [publicId, signature, extra] = qrPayload.split('.');
    if (
      !publicId ||
      !signature ||
      extra ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        publicId,
      ) ||
      !this.references.verify(publicId, signature)
    ) {
      this.invalidQr();
    }
    const result = await this.pool.query<ScannerRegistrationRow>(
      `SELECT id, public_id, status, last_name, first_name, middle_name, phone,
              study_group, person_type, organization, first_attended_at
       FROM registrations WHERE event_id = $1 AND public_id = $2`,
      [eventId, publicId],
    );
    const registration = result.rows[0];
    if (!registration) this.invalidQr();
    if (registration.status === 'ANNULLED') {
      throw new ApiError(
        409,
        'REGISTRATION_ANNULLED',
        'Registration is annulled',
      );
    }
    return scannerParticipant(registration);
  }

  public async offlineBundle(
    eventId: string,
    actor: ScannerActor,
  ): Promise<OfflineBundleResponse> {
    const event = await this.eventContext(eventId, actor);
    const result = await this.pool.query<ScannerRegistrationRow>(
      `SELECT id, public_id, status, last_name, first_name, middle_name, phone,
              study_group, person_type, organization, first_attended_at
       FROM registrations WHERE event_id = $1 AND status = 'ACTIVE'
       ORDER BY id`,
      [eventId],
    );
    if (result.rows.length > 5_000) {
      throw new ApiError(
        409,
        'CONFLICT',
        'Offline bundle exceeds the reviewed MVP limit',
      );
    }
    const registrations = result.rows.map((registration) => ({
      ...scannerParticipant(registration),
      qrPayloadHash: registrationQrPayloadHash(
        this.references.qrPayload(registration.public_id),
      ),
    }));
    const now = new Date();
    const expiresAt = new Date(event.end_at.getTime() + 24 * 60 * 60 * 1_000);
    return {
      eventId,
      version: String(event.offline_data_version),
      generatedAt: now.toISOString(),
      serverTime: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      registrationCount: registrations.length,
      checksum: createHash('sha256')
        .update(JSON.stringify(registrations))
        .digest('hex'),
      registrations,
    };
  }

  public async sync(
    eventId: string,
    request: AttendanceSyncRequest,
    actor: ScannerActor,
  ): Promise<AttendanceSyncResponse> {
    const event = await this.eventContext(eventId, actor);
    const results: SyncResult[] = [];
    for (const item of request.events) {
      results.push(
        await this.processItem(event, request.deviceId, item, actor.id),
      );
    }
    const version = await this.pool.query<{ offline_data_version: string }>(
      'SELECT offline_data_version FROM events WHERE id = $1',
      [eventId],
    );
    return {
      results,
      offlineDataVersion: String(
        version.rows[0]?.offline_data_version ?? event.offline_data_version,
      ),
    };
  }

  private async processItem(
    event: EventContext,
    deviceId: string,
    item: AttendanceSyncRequest['events'][number],
    scannerUserId: string,
  ): Promise<SyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ first_attended_at: Date | null }>(
        `SELECT CASE WHEN ae.event_id = $2 THEN r.first_attended_at ELSE NULL END
                AS first_attended_at
         FROM attendance_events ae
         JOIN registrations r ON r.id = ae.registration_id
         WHERE ae.client_event_id = $1 FOR UPDATE OF ae`,
        [item.clientEventId, event.id],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return {
          clientEventId: item.clientEventId,
          status: 'ALREADY_PROCESSED',
          firstAttendedAt:
            existing.rows[0].first_attended_at?.toISOString() ?? null,
        };
      }

      const registrationResult = await client.query<{
        first_attended_at: Date | null;
        status: 'ACTIVE' | 'ANNULLED';
      }>(
        `SELECT status, first_attended_at FROM registrations
         WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [item.registrationId, event.id],
      );
      const registration = registrationResult.rows[0];
      if (!registration) {
        await client.query('COMMIT');
        return syncResult(item.clientEventId, 'INVALID_REGISTRATION');
      }
      if (registration.status === 'ANNULLED') {
        await client.query('COMMIT');
        return syncResult(item.clientEventId, 'REGISTRATION_ANNULLED');
      }
      const estimatedScannedAt = new Date(item.estimatedScannedAt);
      if (!credibleTimestamp(estimatedScannedAt, event)) {
        await client.query('COMMIT');
        return syncResult(item.clientEventId, 'INVALID_TIMESTAMP');
      }

      const duplicate = registration.first_attended_at !== null;
      const receivedAt = new Date();
      await client.query(
        `INSERT INTO attendance_events
          (id, client_event_id, event_id, registration_id, scanner_user_id,
           device_id, mode, source, device_scanned_at, estimated_scanned_at,
           received_at, duplicate, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
        [
          randomUUID(),
          item.clientEventId,
          event.id,
          item.registrationId,
          scannerUserId,
          deviceId,
          item.mode,
          item.source,
          new Date(item.deviceScannedAt),
          estimatedScannedAt,
          receivedAt,
          duplicate,
        ],
      );
      if (!duplicate) {
        await client.query(
          `UPDATE registrations SET first_attended_at = $2, updated_at = now()
           WHERE id = $1`,
          [item.registrationId, estimatedScannedAt],
        );
        await client.query(
          `UPDATE events SET offline_data_version = offline_data_version + 1,
             updated_at = now() WHERE id = $1`,
          [event.id],
        );
      }
      await client.query('COMMIT');
      return {
        clientEventId: item.clientEventId,
        status: duplicate ? 'REGISTRATION_ALREADY_ATTENDED' : 'ACCEPTED',
        firstAttendedAt: (
          registration.first_attended_at ?? estimatedScannedAt
        ).toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (postgresCode(error) === '23505') {
        const existing = await this.pool.query<{
          first_attended_at: Date | null;
        }>(
          `SELECT r.first_attended_at FROM attendance_events ae
           JOIN registrations r ON r.id = ae.registration_id
           WHERE ae.client_event_id = $1 AND ae.event_id = $2`,
          [item.clientEventId, event.id],
        );
        return {
          clientEventId: item.clientEventId,
          status: 'ALREADY_PROCESSED',
          firstAttendedAt:
            existing.rows[0]?.first_attended_at?.toISOString() ?? null,
        };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async eventContext(
    eventId: string,
    actor: ScannerActor,
  ): Promise<EventContext> {
    const result = await this.pool.query<EventContext>(
      actor.role === 'SUPER_ADMIN'
        ? `SELECT id, start_at, end_at, offline_data_version
           FROM events WHERE id = $1`
        : `SELECT e.id, e.start_at, e.end_at, e.offline_data_version
           FROM events e JOIN event_access ea ON ea.event_id = e.id
           WHERE e.id = $1 AND ea.user_id = $2 AND ea.role = 'SCANNER'`,
      actor.role === 'SUPER_ADMIN' ? [eventId] : [eventId, actor.id],
    );
    const event = result.rows[0];
    if (!event) {
      if (actor.role === 'SCANNER') {
        throw new ApiError(403, 'FORBIDDEN', 'Event access is required');
      }
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    }
    return event;
  }

  private invalidQr(): never {
    throw new ApiError(400, 'INVALID_QR', 'QR is not valid for this Event');
  }
}

const scannerParticipant = (
  registration: ScannerRegistrationRow,
): ResolveQrResponse => ({
  registrationId: registration.id,
  lastName: registration.last_name,
  firstName: registration.first_name,
  middleName: registration.middle_name,
  phone: registration.phone,
  studyGroup: registration.study_group,
  personType: registration.person_type,
  organization: registration.organization,
  firstAttendedAt: registration.first_attended_at?.toISOString() ?? null,
});

const credibleTimestamp = (
  value: Date,
  event: Pick<EventContext, 'start_at' | 'end_at'>,
): boolean => {
  const tolerance = 24 * 60 * 60 * 1_000;
  return (
    value.getTime() >= event.start_at.getTime() - tolerance &&
    value.getTime() <= event.end_at.getTime() + tolerance
  );
};

const syncResult = (
  clientEventId: string,
  status: SyncResult['status'],
): SyncResult => ({ clientEventId, status, firstAttendedAt: null });

const postgresCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
