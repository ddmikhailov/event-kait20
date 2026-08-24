import { randomUUID } from 'node:crypto';

import type {
  CreateEventRequest,
  CreateFormFieldRequest,
  EventListResponse,
  EventResponse,
  FormFieldListResponse,
  FormFieldResponse,
  ScannerEventListResponse,
  UpdateEventRequest,
  UpdateFormFieldRequest,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { ApiError } from '../common/api-error.js';
import { DATABASE_POOL } from '../common/tokens.js';

type EventStatus = EventResponse['status'];
type EventRow = {
  archived_at: Date | null;
  capacity: number;
  cover_object_key: string | null;
  created_at: Date;
  description: string | null;
  end_at: Date;
  id: string;
  location: string;
  registration_deadline: Date;
  slug: string;
  start_at: Date;
  status: EventStatus;
  timezone: string;
  title: string;
  updated_at: Date;
};

type FormFieldRow = {
  active: boolean;
  created_at: Date;
  event_id: string;
  id: string;
  label: string;
  options: unknown;
  required: boolean;
  sort_order: number;
  type: FormFieldResponse['type'];
  updated_at: Date;
};

const transitions: Record<EventStatus, ReadonlySet<EventStatus>> = {
  DRAFT: new Set(['DRAFT', 'REGISTRATION_OPEN']),
  REGISTRATION_OPEN: new Set([
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'ACTIVE',
  ]),
  REGISTRATION_CLOSED: new Set([
    'REGISTRATION_CLOSED',
    'REGISTRATION_OPEN',
    'ACTIVE',
    'COMPLETED',
  ]),
  ACTIVE: new Set(['ACTIVE', 'COMPLETED']),
  COMPLETED: new Set(['COMPLETED']),
  ARCHIVED: new Set(['ARCHIVED']),
};

@Injectable()
export class EventsService {
  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public async list(
    page: number,
    pageSize: number,
  ): Promise<EventListResponse> {
    const [events, count] = await Promise.all([
      this.pool.query<EventRow>(
        `SELECT * FROM events ORDER BY start_at DESC
         OFFSET $1 LIMIT $2`,
        [(page - 1) * pageSize, pageSize],
      ),
      this.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM events',
      ),
    ]);

    return {
      items: events.rows.map(mapEvent),
      page,
      pageSize,
      total: Number(count.rows[0]?.count ?? 0),
    };
  }

  public async get(eventId: string): Promise<EventResponse> {
    return mapEvent(await this.eventRow(this.pool, eventId));
  }

  public async create(
    values: CreateEventRequest,
    actorId: string,
  ): Promise<EventResponse> {
    if (!['DRAFT', 'REGISTRATION_OPEN'].includes(values.status)) {
      throw new ApiError(
        409,
        'INVALID_EVENT_STATE',
        'New Event must start as DRAFT or REGISTRATION_OPEN',
      );
    }
    validateDates(values.startAt, values.endAt, values.registrationDeadline);
    await this.assertSlugAvailable(values.slug);
    const id = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<EventRow>(
        `INSERT INTO events
          (id, title, slug, description, cover_object_key, start_at, end_at,
           timezone, location, registration_deadline, capacity, status,
           created_by, offline_data_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, 1, now(), now()) RETURNING *`,
        [
          id,
          values.title,
          values.slug,
          values.description ?? null,
          values.coverObjectKey ?? null,
          values.startAt,
          values.endAt,
          values.timezone,
          values.location,
          values.registrationDeadline,
          values.capacity,
          values.status,
          actorId,
        ],
      );
      await this.audit(client, actorId, 'EVENT_CREATED', 'Event', id, {
        fields: Object.keys(values),
      });
      await client.query('COMMIT');
      return mapEvent(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async update(
    eventId: string,
    values: UpdateEventRequest,
    actorId: string,
  ): Promise<EventResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.eventRow(client, eventId, true);
      if (existing.status === 'ARCHIVED') {
        throw new ApiError(
          409,
          'INVALID_EVENT_STATE',
          'Archived Event is immutable',
        );
      }
      const nextStatus = values.status ?? existing.status;
      if (
        nextStatus === 'ARCHIVED' ||
        !transitions[existing.status].has(nextStatus)
      ) {
        throw new ApiError(
          409,
          'INVALID_EVENT_STATE',
          'Event status transition is not allowed',
        );
      }

      const startAt = values.startAt ?? existing.start_at.toISOString();
      const endAt = values.endAt ?? existing.end_at.toISOString();
      const deadline =
        values.registrationDeadline ??
        existing.registration_deadline.toISOString();
      validateDates(startAt, endAt, deadline);

      if (values.slug && values.slug !== existing.slug) {
        await this.assertSlugAvailable(values.slug, eventId, client);
      }
      const capacity = values.capacity ?? existing.capacity;
      if (capacity < existing.capacity) {
        const active = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM registrations
           WHERE event_id = $1 AND status = 'ACTIVE'`,
          [eventId],
        );
        if (capacity < Number(active.rows[0]?.count ?? 0)) {
          throw new ApiError(
            409,
            'CAPACITY_BELOW_ACTIVE_REGISTRATIONS',
            'Capacity cannot be below active registrations',
          );
        }
      }

      const result = await client.query<EventRow>(
        `UPDATE events SET
          title = $2, slug = $3, description = $4, cover_object_key = $5,
          start_at = $6, end_at = $7, timezone = $8, location = $9,
          registration_deadline = $10, capacity = $11, status = $12,
          offline_data_version = offline_data_version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          eventId,
          values.title ?? existing.title,
          values.slug ?? existing.slug,
          values.description === undefined
            ? existing.description
            : values.description,
          values.coverObjectKey === undefined
            ? existing.cover_object_key
            : values.coverObjectKey,
          startAt,
          endAt,
          values.timezone ?? existing.timezone,
          values.location ?? existing.location,
          deadline,
          capacity,
          nextStatus,
        ],
      );
      await this.audit(client, actorId, 'EVENT_UPDATED', 'Event', eventId, {
        fields: Object.keys(values),
      });
      await client.query('COMMIT');
      return mapEvent(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async archive(
    eventId: string,
    actorId: string,
  ): Promise<EventResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.eventRow(client, eventId, true);
      if (existing.status === 'ARCHIVED') {
        await client.query('COMMIT');
        return mapEvent(existing);
      }
      const result = await client.query<EventRow>(
        `UPDATE events SET status = 'ARCHIVED', archived_at = now(),
           offline_data_version = offline_data_version + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [eventId],
      );
      await this.audit(client, actorId, 'EVENT_ARCHIVED', 'Event', eventId);
      await client.query('COMMIT');
      return mapEvent(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async scannerEvents(
    userId: string,
  ): Promise<ScannerEventListResponse> {
    const result = await this.pool.query<EventRow>(
      `SELECT e.* FROM events e
       JOIN event_access ea ON ea.event_id = e.id
       WHERE ea.user_id = $1 AND ea.role = 'SCANNER' AND e.status <> 'ARCHIVED'
       ORDER BY e.start_at`,
      [userId],
    );
    return {
      items: result.rows.map((row) => {
        const event = mapEvent(row);
        return {
          id: event.id,
          title: event.title,
          startAt: event.startAt,
          endAt: event.endAt,
          timezone: event.timezone,
          location: event.location,
          status: event.status,
        };
      }),
    };
  }

  public async listFormFields(eventId: string): Promise<FormFieldListResponse> {
    await this.eventRow(this.pool, eventId);
    const result = await this.pool.query<FormFieldRow>(
      `SELECT * FROM event_form_fields
       WHERE event_id = $1 ORDER BY sort_order, created_at`,
      [eventId],
    );
    return { items: result.rows.map(mapFormField) };
  }

  public async createFormField(
    eventId: string,
    values: CreateFormFieldRequest,
    actorId: string,
  ): Promise<FormFieldResponse> {
    validateOptions(values.type, values.options);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const event = await this.eventRow(client, eventId, true);
      if (event.status === 'ARCHIVED') {
        throw new ApiError(
          409,
          'INVALID_EVENT_STATE',
          'Archived Event is immutable',
        );
      }
      const id = randomUUID();
      const result = await client.query<FormFieldRow>(
        `INSERT INTO event_form_fields
          (id, event_id, type, label, required, sort_order, options, active,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, now(), now()) RETURNING *`,
        [
          id,
          eventId,
          values.type,
          values.label,
          values.required,
          values.sortOrder,
          values.options ? JSON.stringify(values.options) : null,
        ],
      );
      await client.query(
        'UPDATE events SET offline_data_version = offline_data_version + 1 WHERE id = $1',
        [eventId],
      );
      await this.audit(
        client,
        actorId,
        'EVENT_FORM_FIELD_CREATED',
        'EventFormField',
        id,
        {
          fields: Object.keys(values),
        },
      );
      await client.query('COMMIT');
      return mapFormField(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async updateFormField(
    eventId: string,
    fieldId: string,
    values: UpdateFormFieldRequest,
    actorId: string,
  ): Promise<FormFieldResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const event = await this.eventRow(client, eventId, true);
      if (event.status === 'ARCHIVED') {
        throw new ApiError(
          409,
          'INVALID_EVENT_STATE',
          'Archived Event is immutable',
        );
      }
      const fieldResult = await client.query<FormFieldRow>(
        `SELECT * FROM event_form_fields
         WHERE id = $1 AND event_id = $2 FOR UPDATE`,
        [fieldId, eventId],
      );
      const existing = fieldResult.rows[0];
      if (!existing)
        throw new ApiError(404, 'NOT_FOUND', 'Form field not found');
      const type = values.type ?? existing.type;
      const options =
        values.options === undefined ? existing.options : values.options;
      validateOptions(type, options);

      const result = await client.query<FormFieldRow>(
        `UPDATE event_form_fields SET type = $3, label = $4, required = $5,
           sort_order = $6, options = $7, updated_at = now()
         WHERE id = $1 AND event_id = $2 RETURNING *`,
        [
          fieldId,
          eventId,
          type,
          values.label ?? existing.label,
          values.required ?? existing.required,
          values.sortOrder ?? existing.sort_order,
          options ? JSON.stringify(options) : null,
        ],
      );
      await client.query(
        'UPDATE events SET offline_data_version = offline_data_version + 1 WHERE id = $1',
        [eventId],
      );
      await this.audit(
        client,
        actorId,
        'EVENT_FORM_FIELD_UPDATED',
        'EventFormField',
        fieldId,
        { fields: Object.keys(values) },
      );
      await client.query('COMMIT');
      return mapFormField(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async deactivateFormField(
    eventId: string,
    fieldId: string,
    actorId: string,
  ): Promise<FormFieldResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const event = await this.eventRow(client, eventId, true);
      if (event.status === 'ARCHIVED') {
        throw new ApiError(
          409,
          'INVALID_EVENT_STATE',
          'Archived Event is immutable',
        );
      }
      const result = await client.query<FormFieldRow>(
        `UPDATE event_form_fields SET active = false, updated_at = now()
         WHERE id = $1 AND event_id = $2 RETURNING *`,
        [fieldId, eventId],
      );
      const field = result.rows[0];
      if (!field) throw new ApiError(404, 'NOT_FOUND', 'Form field not found');
      await client.query(
        'UPDATE events SET offline_data_version = offline_data_version + 1 WHERE id = $1',
        [eventId],
      );
      await this.audit(
        client,
        actorId,
        'EVENT_FORM_FIELD_DEACTIVATED',
        'EventFormField',
        fieldId,
      );
      await client.query('COMMIT');
      return mapFormField(field);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async eventRow(
    client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    eventId: string,
    forUpdate = false,
  ): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT * FROM events WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [eventId],
    );
    const event = result.rows[0];
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    return event;
  }

  private async assertSlugAvailable(
    slug: string,
    eventId?: string,
    client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool,
  ): Promise<void> {
    const result = await client.query(
      'SELECT id FROM events WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)',
      [slug, eventId ?? null],
    );
    if (result.rowCount)
      throw new ApiError(409, 'CONFLICT', 'Event slug already exists');
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

const validateDates = (
  startAt: string,
  endAt: string,
  deadline: string,
): void => {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const registrationDeadline = new Date(deadline);

  if (end <= start || registrationDeadline > start) {
    throw new ApiError(
      400,
      'INVALID_TIME_RANGE',
      'Event end must follow start and registration deadline cannot follow start',
    );
  }
};

const validateOptions = (
  type: FormFieldResponse['type'],
  options: unknown,
): void => {
  const choice = type === 'SINGLE_CHOICE' || type === 'MULTI_CHOICE';
  if (choice) {
    if (!Array.isArray(options) || options.length < 2) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Choice fields require at least two options',
      );
    }
    if (new Set(options).size !== options.length) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Choice field options must be unique',
      );
    }
    return;
  }
  if (options !== null && options !== undefined) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'This field type cannot define options',
    );
  }
};

const mapEvent = (row: EventRow): EventResponse => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  description: row.description,
  coverObjectKey: row.cover_object_key,
  startAt: row.start_at.toISOString(),
  endAt: row.end_at.toISOString(),
  timezone: row.timezone,
  location: row.location,
  registrationDeadline: row.registration_deadline.toISOString(),
  capacity: row.capacity,
  status: row.status,
  archivedAt: row.archived_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapFormField = (row: FormFieldRow): FormFieldResponse => ({
  id: row.id,
  eventId: row.event_id,
  type: row.type,
  label: row.label,
  required: row.required,
  sortOrder: row.sort_order,
  options: Array.isArray(row.options) ? (row.options as string[]) : null,
  active: row.active,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
