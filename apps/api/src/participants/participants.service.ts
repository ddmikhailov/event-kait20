import { randomUUID } from 'node:crypto';

import type {
  PersonDetailResponse,
  PersonListResponse,
  PersonSummary,
  RegistrationDetailResponse,
  RegistrationListResponse,
  ScannerRegistrationListResponse,
  UpdatePersonRequest,
  UpdateRegistrationRequest,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { ApiError } from '../common/api-error.js';
import { DATABASE_POOL } from '../common/tokens.js';
import { RegistrationReferenceService } from '../registrations/registration-reference.service.js';

type PersonRow = {
  birth_date: Date | string | null;
  created_at: Date;
  dedup_review_required: boolean;
  email: string | null;
  first_name: string;
  id: string;
  last_name: string;
  middle_name: string | null;
  organization: string | null;
  person_type: PersonSummary['personType'];
  phone: string | null;
  study_group: string | null;
  updated_at: Date;
};

type RegistrationRow = {
  annulled_at: Date | null;
  birth_date: Date | string | null;
  email: string | null;
  event_id: string;
  first_attended_at: Date | null;
  first_name: string;
  id: string;
  last_name: string;
  middle_name: string | null;
  organization: string | null;
  person_id: string;
  person_type: RegistrationDetailResponse['personType'];
  phone: string | null;
  public_id: string;
  registered_at: Date;
  source: RegistrationDetailResponse['source'];
  status: RegistrationDetailResponse['status'];
  study_group: string | null;
};

@Injectable()
export class ParticipantsService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(RegistrationReferenceService)
    private readonly references: RegistrationReferenceService,
  ) {}

  public async listPeople(
    query: string,
    page: number,
    pageSize: number,
  ): Promise<PersonListResponse> {
    const search = searchPattern(query);
    const result = await this.pool.query<PersonRow & { total: string }>(
      `SELECT p.*, count(*) OVER()::text AS total
       FROM persons p
       WHERE p.merged_into_id IS NULL AND (
         $1 = '' OR concat_ws(' ', p.last_name, p.first_name, p.middle_name) ILIKE $2 ESCAPE '\\'
         OR coalesce(p.email, '') ILIKE $2 ESCAPE '\\'
         OR coalesce(p.phone, '') ILIKE $2 ESCAPE '\\'
         OR coalesce(p.study_group, '') ILIKE $2 ESCAPE '\\'
       )
       ORDER BY p.last_name, p.first_name, p.middle_name NULLS FIRST, p.id
       LIMIT $3 OFFSET $4`,
      [query, search, pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map(personResponse),
      page,
      pageSize,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  public async getPerson(personId: string): Promise<PersonDetailResponse> {
    const [personResult, registrations] = await Promise.all([
      this.pool.query<PersonRow>(
        'SELECT * FROM persons WHERE id = $1 AND merged_into_id IS NULL',
        [personId],
      ),
      this.pool.query<{
        event_id: string;
        event_title: string;
        first_attended_at: Date | null;
        id: string;
        registered_at: Date;
        source: RegistrationDetailResponse['source'];
        status: RegistrationDetailResponse['status'];
      }>(
        `SELECT r.id, r.event_id, e.title AS event_title, r.source, r.status,
                r.registered_at, r.first_attended_at
         FROM registrations r JOIN events e ON e.id = r.event_id
         WHERE r.person_id = $1 ORDER BY r.registered_at DESC, r.id`,
        [personId],
      ),
    ]);
    const person = personResult.rows[0];
    if (!person) throw new ApiError(404, 'NOT_FOUND', 'Person not found');
    return {
      ...personResponse(person),
      registrations: registrations.rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        eventTitle: row.event_title,
        source: row.source,
        status: row.status,
        registeredAt: row.registered_at.toISOString(),
        firstAttendedAt: row.first_attended_at?.toISOString() ?? null,
      })),
    };
  }

  public async updatePerson(
    personId: string,
    values: UpdatePersonRequest,
    actorId: string,
  ): Promise<PersonDetailResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<PersonRow>(
        'SELECT * FROM persons WHERE id = $1 AND merged_into_id IS NULL FOR UPDATE',
        [personId],
      );
      const row = existing.rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Person not found');
      const current = personResponse(row);
      const next = mergeDefined(current, values);
      assertParticipantShape(next);
      await client.query(
        `UPDATE persons SET last_name = $2, first_name = $3, middle_name = $4,
           birth_date = $5, email = $6, email_normalized = $6, phone = $7,
           phone_normalized = $7, study_group = $8, person_type = $9,
           organization = $10, updated_at = now() WHERE id = $1`,
        [
          personId,
          next.lastName,
          next.firstName,
          next.middleName,
          next.birthDate,
          next.email,
          next.phone,
          next.studyGroup,
          next.personType,
          normalizedOrganization(next.personType, next.organization),
        ],
      );
      await this.audit(client, actorId, 'PERSON_UPDATED', 'Person', personId, {
        fields: Object.keys(values).sort(),
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getPerson(personId);
  }

  public async listRegistrations(
    eventId: string,
    query: string,
    status: 'ACTIVE' | 'ANNULLED' | undefined,
    page: number,
    pageSize: number,
  ): Promise<RegistrationListResponse> {
    await this.assertEvent(eventId);
    const result = await this.pool.query<RegistrationRow & { total: string }>(
      `SELECT r.*, count(*) OVER()::text AS total FROM registrations r
       WHERE r.event_id = $1 AND ($2::registration_status IS NULL OR r.status = $2)
         AND ($3 = '' OR concat_ws(' ', r.last_name, r.first_name, r.middle_name) ILIKE $4 ESCAPE '\\'
           OR coalesce(r.email, '') ILIKE $4 ESCAPE '\\'
           OR coalesce(r.phone, '') ILIKE $4 ESCAPE '\\'
           OR coalesce(r.study_group, '') ILIKE $4 ESCAPE '\\')
       ORDER BY r.registered_at DESC, r.id LIMIT $5 OFFSET $6`,
      [
        eventId,
        status ?? null,
        query,
        searchPattern(query),
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    return {
      items: result.rows.map(registrationResponse),
      page,
      pageSize,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  public async getRegistration(
    eventId: string,
    registrationId: string,
  ): Promise<RegistrationDetailResponse> {
    const [registrationResult, answers] = await Promise.all([
      this.pool.query<RegistrationRow>(
        'SELECT * FROM registrations WHERE id = $1 AND event_id = $2',
        [registrationId, eventId],
      ),
      this.pool.query<{
        answer: unknown;
        field_id: string;
        field_label_snapshot: string;
        field_type_snapshot: string;
      }>(
        `SELECT field_id, field_label_snapshot, field_type_snapshot, answer
         FROM registration_answers WHERE registration_id = $1
         ORDER BY created_at, id`,
        [registrationId],
      ),
    ]);
    const row = registrationResult.rows[0];
    if (!row) {
      throw new ApiError(
        404,
        'REGISTRATION_NOT_FOUND',
        'Registration not found',
      );
    }
    return {
      ...registrationResponse(row),
      answers: answers.rows.map((answer) => ({
        fieldId: answer.field_id,
        fieldLabel: answer.field_label_snapshot,
        fieldType: answer.field_type_snapshot,
        value: answer.answer,
      })),
      ticketUrl: this.references.ticketUrl(row.public_id),
    };
  }

  public async scannerSearch(
    eventId: string,
    query: string,
    page: number,
    pageSize: number,
    actor: { id: string; role: 'SUPER_ADMIN' | 'SCANNER' },
  ): Promise<ScannerRegistrationListResponse> {
    if (actor.role === 'SCANNER') {
      const access = await this.pool.query(
        `SELECT 1 FROM event_access
         WHERE event_id = $1 AND user_id = $2 AND role = 'SCANNER'`,
        [eventId, actor.id],
      );
      if (!access.rowCount) {
        throw new ApiError(403, 'FORBIDDEN', 'Event access is required');
      }
    } else {
      await this.assertEvent(eventId);
    }
    const result = await this.pool.query<RegistrationRow & { total: string }>(
      `SELECT r.*, count(*) OVER()::text AS total FROM registrations r
       WHERE r.event_id = $1 AND r.status = 'ACTIVE'
         AND ($2 = '' OR concat_ws(' ', r.last_name, r.first_name, r.middle_name) ILIKE $3 ESCAPE '\\'
           OR coalesce(r.email, '') ILIKE $3 ESCAPE '\\'
           OR coalesce(r.phone, '') ILIKE $3 ESCAPE '\\'
           OR coalesce(r.study_group, '') ILIKE $3 ESCAPE '\\')
       ORDER BY r.last_name, r.first_name, r.middle_name NULLS FIRST, r.id
       LIMIT $4 OFFSET $5`,
      [eventId, query, searchPattern(query), pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        lastName: row.last_name,
        firstName: row.first_name,
        middleName: row.middle_name,
        phone: row.phone,
        studyGroup: row.study_group,
        personType: row.person_type,
        organization: row.organization,
        firstAttendedAt: row.first_attended_at?.toISOString() ?? null,
      })),
      page,
      pageSize,
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  public async updateRegistration(
    eventId: string,
    registrationId: string,
    values: UpdateRegistrationRequest,
    actorId: string,
  ): Promise<RegistrationDetailResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<RegistrationRow>(
        'SELECT * FROM registrations WHERE id = $1 AND event_id = $2 FOR UPDATE',
        [registrationId, eventId],
      );
      const row = result.rows[0];
      if (!row) this.registrationNotFound();
      if (row.status === 'ANNULLED') this.registrationAnnulled();
      const current = registrationResponse(row);
      const next = mergeDefined(current, values);
      assertParticipantShape(next);
      await client.query(
        `UPDATE registrations SET last_name = $2, first_name = $3,
           middle_name = $4, birth_date = $5, email = $6, phone = $7,
           study_group = $8, person_type = $9, organization = $10,
           updated_at = now() WHERE id = $1`,
        [
          registrationId,
          next.lastName,
          next.firstName,
          next.middleName,
          next.birthDate,
          next.email,
          next.phone,
          next.studyGroup,
          next.personType,
          normalizedOrganization(next.personType, next.organization),
        ],
      );
      await this.bumpOfflineVersion(client, eventId);
      await this.audit(
        client,
        actorId,
        'REGISTRATION_UPDATED',
        'Registration',
        registrationId,
        { fields: Object.keys(values).sort() },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getRegistration(eventId, registrationId);
  }

  public async annul(
    eventId: string,
    registrationId: string,
    actorId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ status: string }>(
        `SELECT status FROM registrations
         WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [registrationId, eventId],
      );
      const row = result.rows[0];
      if (!row) this.registrationNotFound();
      if (row.status === 'ANNULLED') this.registrationAnnulled();
      await client.query(
        `UPDATE registrations SET status = 'ANNULLED', annulled_at = now(),
           annulled_by = $2, updated_at = now() WHERE id = $1`,
        [registrationId, actorId],
      );
      await this.bumpOfflineVersion(client, eventId);
      await this.audit(
        client,
        actorId,
        'REGISTRATION_ANNULLED',
        'Registration',
        registrationId,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async resendTicket(
    eventId: string,
    registrationId: string,
    actorId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        email: string | null;
        status: string;
      }>(
        `SELECT email, status FROM registrations
         WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [registrationId, eventId],
      );
      const row = result.rows[0];
      if (!row) this.registrationNotFound();
      if (row.status === 'ANNULLED') this.registrationAnnulled();
      if (!row.email) {
        throw new ApiError(
          409,
          'CONFLICT',
          'Registration has no email recipient',
        );
      }
      const deliveryId = randomUUID();
      await client.query(
        `INSERT INTO email_deliveries
          (id, idempotency_key, type, recipient_email, event_id,
           registration_id, status, attempts, queued_at, created_at, updated_at)
         VALUES ($1, $2, 'REGISTRATION_TICKET', $3, $4, $5,
                 'QUEUED', 0, now(), now(), now())`,
        [
          deliveryId,
          `registration-ticket:manual:${registrationId}:${deliveryId}`,
          row.email,
          eventId,
          registrationId,
        ],
      );
      await this.audit(
        client,
        actorId,
        'REGISTRATION_TICKET_QUEUED',
        'Registration',
        registrationId,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertEvent(eventId: string): Promise<void> {
    const result = await this.pool.query(
      'SELECT id FROM events WHERE id = $1',
      [eventId],
    );
    if (!result.rowCount) {
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    }
  }

  private registrationNotFound(): never {
    throw new ApiError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found');
  }

  private registrationAnnulled(): never {
    throw new ApiError(
      409,
      'REGISTRATION_ANNULLED',
      'Registration is annulled',
    );
  }

  private async bumpOfflineVersion(
    client: PoolClient,
    eventId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE events SET offline_data_version = offline_data_version + 1,
         updated_at = now() WHERE id = $1`,
      [eventId],
    );
  }

  private async audit(
    client: PoolClient,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log
        (id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [randomUUID(), actorId, action, entityType, entityId, metadata ?? null],
    );
  }
}

const personResponse = (row: PersonRow): PersonSummary => ({
  id: row.id,
  lastName: row.last_name,
  firstName: row.first_name,
  middleName: row.middle_name,
  birthDate: dateOnly(row.birth_date),
  email: row.email,
  phone: row.phone,
  studyGroup: row.study_group,
  personType: row.person_type,
  organization: row.organization,
  dedupReviewRequired: row.dedup_review_required,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const registrationResponse = (row: RegistrationRow) => ({
  id: row.id,
  eventId: row.event_id,
  personId: row.person_id,
  source: row.source,
  status: row.status,
  lastName: row.last_name,
  firstName: row.first_name,
  middleName: row.middle_name,
  birthDate: dateOnly(row.birth_date),
  email: row.email,
  phone: row.phone,
  studyGroup: row.study_group,
  personType: row.person_type,
  organization: row.organization,
  registeredAt: row.registered_at.toISOString(),
  firstAttendedAt: row.first_attended_at?.toISOString() ?? null,
  annulledAt: row.annulled_at?.toISOString() ?? null,
});

const dateOnly = (value: Date | string | null): string | null =>
  value
    ? typeof value === 'string'
      ? value
      : value.toISOString().slice(0, 10)
    : null;

const searchPattern = (query: string): string =>
  `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

const normalizedOrganization = (
  personType: PersonSummary['personType'],
  organization: string | null,
): string | null =>
  personType.startsWith('KAIT_') ? 'КАИТ №20' : organization;

const assertParticipantShape = (value: {
  organization: string | null;
  personType: PersonSummary['personType'];
  studyGroup: string | null;
}): void => {
  if (value.personType.endsWith('_STUDENT') && !value.studyGroup) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Study group is required');
  }
  if (value.personType.startsWith('EXTERNAL_') && !value.organization) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Organization is required');
  }
};

const mergeDefined = <T extends object>(
  current: T,
  values: { [Key in keyof T]?: T[Key] | undefined },
): T =>
  Object.assign(
    {},
    current,
    Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined),
    ),
  ) as T;
