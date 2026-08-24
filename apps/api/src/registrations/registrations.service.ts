import { randomUUID } from 'node:crypto';

import type {
  FormFieldResponse,
  PublicEventResponse,
  PublicRegistrationRequest,
  PublicRegistrationResponse,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { ApiError } from '../common/api-error.js';
import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG, DATABASE_POOL } from '../common/tokens.js';
import { RegistrationReferenceService } from './registration-reference.service.js';

type EventRow = {
  capacity: number;
  cover_object_key: string | null;
  description: string | null;
  end_at: Date;
  id: string;
  location: string;
  registration_deadline: Date;
  slug: string;
  start_at: Date;
  status: string;
  timezone: string;
  title: string;
};

type FieldRow = {
  id: string;
  label: string;
  options: unknown;
  required: boolean;
  sort_order: number;
  type: FormFieldResponse['type'];
};

type PersonRow = { id: string };
type RegistrationRow = { id: string; public_id: string };

const KAIT_ORGANIZATION = 'КАИТ №20';

@Injectable()
export class RegistrationsService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(RegistrationReferenceService)
    private readonly references: RegistrationReferenceService,
  ) {}

  public async publicEvent(slug: string): Promise<PublicEventResponse> {
    const eventResult = await this.pool.query<EventRow>(
      `SELECT id, title, slug, description, cover_object_key, start_at, end_at,
              timezone, location, registration_deadline, capacity, status
       FROM events WHERE slug = $1`,
      [slug],
    );
    const event = eventResult.rows[0];
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');

    const [fields, activeCount] = await Promise.all([
      this.formFields(this.pool, event.id),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM registrations
         WHERE event_id = $1 AND status = 'ACTIVE'`,
        [event.id],
      ),
    ]);
    const count = Number(activeCount.rows[0]?.count ?? 0);

    return {
      id: event.id,
      title: event.title,
      slug: event.slug,
      description: event.description,
      coverObjectKey: event.cover_object_key,
      startAt: event.start_at.toISOString(),
      endAt: event.end_at.toISOString(),
      timezone: event.timezone,
      location: event.location,
      availability: this.availability(event, count),
      consentUrl: this.config.CONSENT_URL,
      consentVersion: this.config.CONSENT_VERSION,
      formFields: fields.map((field) => ({
        id: field.id,
        type: field.type,
        label: field.label,
        required: field.required,
        sortOrder: field.sort_order,
        options: this.options(field.options),
      })),
    };
  }

  public async register(
    slug: string,
    values: PublicRegistrationRequest,
  ): Promise<PublicRegistrationResponse> {
    if (values.consentVersion !== this.config.CONSENT_VERSION) {
      throw new ApiError(
        409,
        'FORM_VERSION_INVALID',
        'Consent version is no longer current',
      );
    }

    const participant = this.participant(values);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const event = await this.lockEvent(client, slug);
      this.assertRegistrationOpen(event);
      await this.lockPersonKeys(client, participant);
      const fields = await this.formFields(client, event.id);
      this.validateAnswers(fields, values);

      const person = await this.findOrCreatePerson(client, participant);
      const existing = await client.query<RegistrationRow>(
        `SELECT id, public_id FROM registrations
         WHERE event_id = $1 AND person_id = $2 AND status = 'ACTIVE'
         FOR UPDATE`,
        [event.id, person.id],
      );

      if (existing.rows[0]) {
        const registration = existing.rows[0];
        await this.updateRegistration(client, registration.id, participant);
        await this.persistAnswers(client, registration.id, fields, values);
        await this.queueTicket(client, event.id, registration.id, values.email);
        await this.bumpOfflineVersion(client, event.id);
        await client.query('COMMIT');
        return {
          status: 'ALREADY_REGISTERED',
          registrationId: registration.id,
          ticketUrl: this.references.ticketUrl(registration.public_id),
        };
      }

      const activeCount = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM registrations
         WHERE event_id = $1 AND status = 'ACTIVE'`,
        [event.id],
      );
      if (Number(activeCount.rows[0]?.count ?? 0) >= event.capacity) {
        throw new ApiError(409, 'CAPACITY_FULL', 'Event capacity is full');
      }

      const registration = await this.createRegistration(
        client,
        event.id,
        person.id,
        participant,
      );
      await this.persistAnswers(client, registration.id, fields, values);
      await this.queueTicket(client, event.id, registration.id, values.email);
      await this.bumpOfflineVersion(client, event.id);
      await client.query('COMMIT');
      return {
        status: 'REGISTERED',
        registrationId: registration.id,
        ticketUrl: this.references.ticketUrl(registration.public_id),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private participant(values: PublicRegistrationRequest) {
    const student = values.personType.endsWith('_STUDENT');
    const external = values.personType.startsWith('EXTERNAL_');
    return {
      ...values,
      middleName: values.middleName ?? null,
      organization: external ? values.organization! : KAIT_ORGANIZATION,
      studyGroup: student ? values.studyGroup! : null,
    };
  }

  private async lockEvent(client: PoolClient, slug: string): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT id, title, slug, description, cover_object_key, start_at, end_at,
              timezone, location, registration_deadline, capacity, status
       FROM events WHERE slug = $1 FOR UPDATE`,
      [slug],
    );
    const event = result.rows[0];
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    return event;
  }

  private assertRegistrationOpen(event: EventRow): void {
    if (
      event.status !== 'REGISTRATION_OPEN' ||
      event.registration_deadline <= new Date()
    ) {
      throw new ApiError(409, 'REGISTRATION_CLOSED', 'Registration is closed');
    }
  }

  private availability(
    event: EventRow,
    activeRegistrations: number,
  ): 'OPEN' | 'CLOSED' | 'FULL' {
    if (
      event.status !== 'REGISTRATION_OPEN' ||
      event.registration_deadline <= new Date()
    )
      return 'CLOSED';
    return activeRegistrations >= event.capacity ? 'FULL' : 'OPEN';
  }

  private async lockPersonKeys(
    client: PoolClient,
    participant: ReturnType<RegistrationsService['participant']>,
  ): Promise<void> {
    const name = [
      participant.lastName.toLocaleLowerCase('ru'),
      participant.firstName.toLocaleLowerCase('ru'),
      participant.middleName?.toLocaleLowerCase('ru') ?? '',
    ].join('|');
    const keys = [
      `${name}|email:${participant.email}`,
      `${name}|phone:${participant.phone}`,
      `${name}|birth:${participant.birthDate}`,
    ].sort();
    for (const key of keys) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key],
      );
    }
  }

  private async findOrCreatePerson(
    client: PoolClient,
    participant: ReturnType<RegistrationsService['participant']>,
  ): Promise<PersonRow> {
    const candidates = await client.query<PersonRow>(
      `SELECT id FROM persons
       WHERE merged_into_id IS NULL
         AND lower(last_name) = lower($1)
         AND lower(first_name) = lower($2)
         AND (($3::text IS NULL AND middle_name IS NULL) OR lower(middle_name) = lower($3))
         AND (email_normalized = $4 OR phone_normalized = $5 OR birth_date = $6::date)
       FOR UPDATE`,
      [
        participant.lastName,
        participant.firstName,
        participant.middleName,
        participant.email,
        participant.phone,
        participant.birthDate,
      ],
    );
    const candidateIds = [...new Set(candidates.rows.map((row) => row.id))];
    if (candidateIds.length === 1) {
      const id = candidateIds[0]!;
      await client.query(
        `UPDATE persons SET last_name = $2, first_name = $3, middle_name = $4,
           birth_date = $5, email = $6, email_normalized = $6, phone = $7,
           phone_normalized = $7, person_type = $8, organization = $9,
           study_group = $10, updated_at = now() WHERE id = $1`,
        [
          id,
          participant.lastName,
          participant.firstName,
          participant.middleName,
          participant.birthDate,
          participant.email,
          participant.phone,
          participant.personType,
          participant.organization,
          participant.studyGroup,
        ],
      );
      return { id };
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO persons
        (id, last_name, first_name, middle_name, birth_date, email,
         email_normalized, phone, phone_normalized, person_type, organization,
         study_group, dedup_review_required, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7, $8, $9, $10, $11, now(), now())`,
      [
        id,
        participant.lastName,
        participant.firstName,
        participant.middleName,
        participant.birthDate,
        participant.email,
        participant.phone,
        participant.personType,
        participant.organization,
        participant.studyGroup,
        candidateIds.length > 1,
      ],
    );
    return { id };
  }

  private async createRegistration(
    client: PoolClient,
    eventId: string,
    personId: string,
    participant: ReturnType<RegistrationsService['participant']>,
  ): Promise<RegistrationRow> {
    const id = randomUUID();
    const publicId = randomUUID();
    await client.query(
      `INSERT INTO registrations
        (id, public_id, event_id, person_id, source, status, last_name,
         first_name, middle_name, birth_date, email, phone, study_group,
         person_type, organization, consent_accepted, consent_version,
         consent_url, consent_accepted_at, registered_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'PUBLIC_FORM', 'ACTIVE', $5, $6, $7, $8,
               $9, $10, $11, $12, $13, true, $14, $15, now(), now(), now(), now())`,
      [
        id,
        publicId,
        eventId,
        personId,
        participant.lastName,
        participant.firstName,
        participant.middleName,
        participant.birthDate,
        participant.email,
        participant.phone,
        participant.studyGroup,
        participant.personType,
        participant.organization,
        this.config.CONSENT_VERSION,
        this.config.CONSENT_URL,
      ],
    );
    return { id, public_id: publicId };
  }

  private async updateRegistration(
    client: PoolClient,
    registrationId: string,
    participant: ReturnType<RegistrationsService['participant']>,
  ): Promise<void> {
    await client.query(
      `UPDATE registrations SET last_name = $2, first_name = $3,
         middle_name = $4, birth_date = $5, email = $6, phone = $7,
         study_group = $8, person_type = $9, organization = $10,
         consent_accepted = true, consent_version = $11, consent_url = $12,
         consent_accepted_at = now(), updated_at = now() WHERE id = $1`,
      [
        registrationId,
        participant.lastName,
        participant.firstName,
        participant.middleName,
        participant.birthDate,
        participant.email,
        participant.phone,
        participant.studyGroup,
        participant.personType,
        participant.organization,
        this.config.CONSENT_VERSION,
        this.config.CONSENT_URL,
      ],
    );
  }

  private async formFields(
    client: Pool | PoolClient,
    eventId: string,
  ): Promise<FieldRow[]> {
    const result = await client.query<FieldRow>(
      `SELECT id, type, label, required, sort_order, options
       FROM event_form_fields WHERE event_id = $1 AND active = true
       ORDER BY sort_order, created_at`,
      [eventId],
    );
    return result.rows;
  }

  private validateAnswers(
    fields: FieldRow[],
    values: PublicRegistrationRequest,
  ): void {
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const answerMap = new Map(
      values.customAnswers.map((answer) => [answer.fieldId, answer.value]),
    );
    for (const answer of values.customAnswers) {
      const field = fieldMap.get(answer.fieldId);
      if (!field || !this.validAnswer(field, answer.value)) {
        throw new ApiError(
          409,
          'FORM_VERSION_INVALID',
          'Registration form has changed',
        );
      }
    }
    for (const field of fields) {
      if (field.required && !answerMap.has(field.id)) {
        throw new ApiError(
          409,
          'FORM_VERSION_INVALID',
          'Registration form has changed',
        );
      }
    }
  }

  private validAnswer(field: FieldRow, value: unknown): boolean {
    const options = this.options(field.options) ?? [];
    if (field.type === 'BOOLEAN') return typeof value === 'boolean';
    if (field.type === 'MULTI_CHOICE')
      return (
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every(
          (item) => typeof item === 'string' && options.includes(item),
        )
      );
    if (typeof value !== 'string') return false;
    if (field.type === 'SINGLE_CHOICE') return options.includes(value);
    return value.trim().length > 0;
  }

  private options(value: unknown): string[] | null {
    return Array.isArray(value) &&
      value.every((item) => typeof item === 'string')
      ? value
      : null;
  }

  private async persistAnswers(
    client: PoolClient,
    registrationId: string,
    fields: FieldRow[],
    values: PublicRegistrationRequest,
  ): Promise<void> {
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    for (const answer of values.customAnswers) {
      const field = fieldMap.get(answer.fieldId)!;
      await client.query(
        `INSERT INTO registration_answers
          (id, registration_id, field_id, field_label_snapshot,
           field_type_snapshot, answer, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
         ON CONFLICT (registration_id, field_id) DO UPDATE SET
           field_label_snapshot = EXCLUDED.field_label_snapshot,
           field_type_snapshot = EXCLUDED.field_type_snapshot,
           answer = EXCLUDED.answer, updated_at = now()`,
        [
          randomUUID(),
          registrationId,
          field.id,
          field.label,
          field.type,
          JSON.stringify(answer.value),
        ],
      );
    }
  }

  private async queueTicket(
    client: PoolClient,
    eventId: string,
    registrationId: string,
    recipientEmail: string,
  ): Promise<void> {
    const deliveryId = randomUUID();
    await client.query(
      `INSERT INTO email_deliveries
        (id, idempotency_key, type, recipient_email, event_id,
         registration_id, status, attempts, queued_at, created_at, updated_at)
       VALUES ($1, $2, 'REGISTRATION_TICKET', $3, $4, $5,
               'QUEUED', 0, now(), now(), now())`,
      [
        deliveryId,
        `registration-ticket:${registrationId}:${deliveryId}`,
        recipientEmail,
        eventId,
        registrationId,
      ],
    );
  }

  private async bumpOfflineVersion(
    client: PoolClient,
    eventId: string,
  ): Promise<void> {
    await client.query(
      'UPDATE events SET offline_data_version = offline_data_version + 1, updated_at = now() WHERE id = $1',
      [eventId],
    );
  }
}
