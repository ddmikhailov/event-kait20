import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required; run this test through test:integration',
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

const insertPerson = async (
  values: {
    emailNormalized?: string;
    firstName?: string;
    phoneNormalized?: string;
  } = {},
): Promise<string> => {
  const id = randomUUID();

  await pool.query(
    `INSERT INTO persons (
      id, last_name, first_name, email, email_normalized, phone,
      phone_normalized, person_type, created_at, updated_at
    ) VALUES ($1, 'Тестов', $2, $3, $3, $4, $4, 'KAIT_STUDENT', now(), now())`,
    [
      id,
      values.firstName ?? 'Участник',
      values.emailNormalized ?? null,
      values.phoneNormalized ?? null,
    ],
  );

  return id;
};

const insertStaffUser = async (): Promise<string> => {
  const id = randomUUID();
  const email = `${id}@example.test`;

  await pool.query(
    `INSERT INTO staff_users (
      id, email, email_normalized, password_hash, system_role,
      password_changed_at, created_at, updated_at
    ) VALUES ($1, $2, $2, 'argon2id-hash-placeholder', 'SUPER_ADMIN', now(), now(), now())`,
    [id, email],
  );

  return id;
};

const insertEvent = async (createdById: string): Promise<string> => {
  const id = randomUUID();

  await pool.query(
    `INSERT INTO events (
      id, title, slug, start_at, end_at, location, registration_deadline,
      capacity, status, created_by, created_at, updated_at
    ) VALUES (
      $1, 'Тестовое мероприятие', $2, now() + interval '1 day',
      now() + interval '2 days', 'КАИТ №20', now() + interval '12 hours',
      100, 'REGISTRATION_OPEN', $3, now(), now()
    )`,
    [id, `event-${id}`, createdById],
  );

  return id;
};

const insertRegistration = async (
  eventId: string,
  personId: string,
  values: { firstName?: string; status?: 'ACTIVE' | 'ANNULLED' } = {},
): Promise<string> => {
  const id = randomUUID();

  await pool.query(
    `INSERT INTO registrations (
      id, public_id, event_id, person_id, source, status, last_name,
      first_name, person_type, consent_accepted, consent_version,
      consent_url, consent_accepted_at, registered_at, annulled_at,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, 'PUBLIC_FORM', $5::registration_status, 'Тестов', $6,
      'KAIT_STUDENT', true, 'test-v1', 'https://example.test/consent',
      now(), now(), CASE WHEN $5::registration_status = 'ANNULLED' THEN now() ELSE NULL END,
      now(), now()
    )`,
    [
      id,
      randomUUID(),
      eventId,
      personId,
      values.status ?? 'ACTIVE',
      values.firstName ?? 'Снимок',
    ],
  );

  return id;
};

const insertFormField = async (eventId: string): Promise<string> => {
  const id = randomUUID();

  await pool.query(
    `INSERT INTO event_form_fields (
      id, event_id, type, label, required, sort_order, active,
      created_at, updated_at
    ) VALUES ($1, $2, 'SHORT_TEXT', 'Комментарий', false, 1, true, now(), now())`,
    [id, eventId],
  );

  return id;
};

const expectConstraintViolation = async (
  operation: Promise<unknown>,
  code: '23001' | '23503' | '23505' | '23514',
): Promise<void> => {
  await expect(operation).rejects.toMatchObject({ code });
};

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL domain migration', () => {
  it('applies all approved MVP tables to an empty PostgreSQL database', async () => {
    const expectedTables = [
      'attendance_events',
      'audit_log',
      'email_deliveries',
      'event_access',
      'event_form_fields',
      'events',
      'import_job_files',
      'import_jobs',
      'password_reset_tokens',
      'persons',
      'registration_answers',
      'registrations',
      'sessions',
      'staff_invitations',
      'staff_users',
    ];
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    expect(result.rows.map(({ table_name }) => table_name)).toEqual([
      '_prisma_migrations',
      ...expectedTables,
    ]);
  });

  it('allows one Person to have ACTIVE registrations for different Events', async () => {
    const adminId = await insertStaffUser();
    const personId = await insertPerson();
    const firstEventId = await insertEvent(adminId);
    const secondEventId = await insertEvent(adminId);

    await insertRegistration(firstEventId, personId);
    await insertRegistration(secondEventId, personId);

    const result = await pool.query<{ count: string }>(
      `SELECT count(*) FROM registrations
       WHERE person_id = $1 AND status = 'ACTIVE'`,
      [personId],
    );

    expect(result.rows[0]?.count).toBe('2');
  });

  it('enforces partial ACTIVE Registration uniqueness and permits re-registration after annulment', async () => {
    const adminId = await insertStaffUser();
    const personId = await insertPerson();
    const eventId = await insertEvent(adminId);
    const firstRegistrationId = await insertRegistration(eventId, personId);

    await expectConstraintViolation(
      insertRegistration(eventId, personId),
      '23505',
    );

    await pool.query(
      `UPDATE registrations
       SET status = 'ANNULLED', annulled_at = now(), updated_at = now()
       WHERE id = $1`,
      [firstRegistrationId],
    );
    await insertRegistration(eventId, personId);

    const result = await pool.query<{ status: string }>(
      `SELECT status FROM registrations
       WHERE event_id = $1 AND person_id = $2
       ORDER BY created_at`,
      [eventId, personId],
    );

    expect(result.rows.map(({ status }) => status).sort()).toEqual([
      'ACTIVE',
      'ANNULLED',
    ]);
  });

  it('allows different Persons to share normalized email and phone values', async () => {
    const sharedEmail = 'shared@example.test';
    const sharedPhone = '+79990000000';
    const firstPersonId = await insertPerson({
      emailNormalized: sharedEmail,
      phoneNormalized: sharedPhone,
    });
    const secondPersonId = await insertPerson({
      emailNormalized: sharedEmail,
      phoneNormalized: sharedPhone,
    });

    const result = await pool.query<{ count: string }>(
      `SELECT count(*) FROM persons
       WHERE id = ANY($1::uuid[]) AND email_normalized = $2 AND phone_normalized = $3`,
      [[firstPersonId, secondPersonId], sharedEmail, sharedPhone],
    );

    expect(result.rows[0]?.count).toBe('2');
  });

  it('keeps the Registration snapshot unchanged when Person is edited', async () => {
    const adminId = await insertStaffUser();
    const personId = await insertPerson({ firstName: 'Текущее имя' });
    const eventId = await insertEvent(adminId);
    const registrationId = await insertRegistration(eventId, personId, {
      firstName: 'Историческое имя',
    });

    await pool.query(
      `UPDATE persons SET first_name = 'Новое имя', updated_at = now() WHERE id = $1`,
      [personId],
    );

    const result = await pool.query<{ first_name: string }>(
      'SELECT first_name FROM registrations WHERE id = $1',
      [registrationId],
    );

    expect(result.rows[0]?.first_name).toBe('Историческое имя');
  });

  it('enforces globally unique attendance client_event_id', async () => {
    const adminId = await insertStaffUser();
    const personId = await insertPerson();
    const eventId = await insertEvent(adminId);
    const registrationId = await insertRegistration(eventId, personId);
    const clientEventId = randomUUID();
    const insertAttendance = () =>
      pool.query(
        `INSERT INTO attendance_events (
          id, client_event_id, event_id, registration_id, mode, source,
          device_scanned_at, estimated_scanned_at, received_at, created_at
        ) VALUES ($1, $2, $3, $4, 'FAST_SCAN', 'OFFLINE_SYNC', now(), now(), now(), now())`,
        [randomUUID(), clientEventId, eventId, registrationId],
      );

    await insertAttendance();
    await expectConstraintViolation(insertAttendance(), '23505');
  });

  it('enforces one RegistrationAnswer per registration and field', async () => {
    const adminId = await insertStaffUser();
    const personId = await insertPerson();
    const eventId = await insertEvent(adminId);
    const registrationId = await insertRegistration(eventId, personId);
    const fieldId = await insertFormField(eventId);
    const insertAnswer = () =>
      pool.query(
        `INSERT INTO registration_answers (
          id, registration_id, field_id, field_label_snapshot,
          field_type_snapshot, answer, created_at, updated_at
        ) VALUES ($1, $2, $3, 'Комментарий', 'SHORT_TEXT', $4::jsonb, now(), now())`,
        [randomUUID(), registrationId, fieldId, JSON.stringify('Ответ')],
      );

    await insertAnswer();
    await expectConstraintViolation(insertAnswer(), '23505');
  });

  it('restricts destructive deletion of historical Person and form-field records', async () => {
    const adminId = await insertStaffUser();
    const personId = await insertPerson();
    const eventId = await insertEvent(adminId);
    const registrationId = await insertRegistration(eventId, personId);
    const fieldId = await insertFormField(eventId);

    await pool.query(
      `INSERT INTO registration_answers (
        id, registration_id, field_id, field_label_snapshot,
        field_type_snapshot, answer, created_at, updated_at
      ) VALUES ($1, $2, $3, 'Комментарий', 'SHORT_TEXT', '"Ответ"'::jsonb, now(), now())`,
      [randomUUID(), registrationId, fieldId],
    );

    await expectConstraintViolation(
      pool.query('DELETE FROM persons WHERE id = $1', [personId]),
      '23001',
    );
    await expectConstraintViolation(
      pool.query('DELETE FROM event_form_fields WHERE id = $1', [fieldId]),
      '23001',
    );
  });

  it('enforces EventAccess uniqueness for event and user', async () => {
    const adminId = await insertStaffUser();
    const scannerId = await insertStaffUser();
    const eventId = await insertEvent(adminId);
    const insertAccess = () =>
      pool.query(
        `INSERT INTO event_access (id, event_id, user_id, role, created_by, created_at)
         VALUES ($1, $2, $3, 'SCANNER', $4, now())`,
        [randomUUID(), eventId, scannerId, adminId],
      );

    await insertAccess();
    await expectConstraintViolation(insertAccess(), '23505');
  });

  it('enforces email delivery idempotency_key uniqueness', async () => {
    const idempotencyKey = `delivery-${randomUUID()}`;
    const insertDelivery = () =>
      pool.query(
        `INSERT INTO email_deliveries (
          id, idempotency_key, type, recipient_email, status, queued_at,
          created_at, updated_at
        ) VALUES ($1, $2, 'REGISTRATION_TICKET', 'participant@example.test', 'QUEUED', now(), now(), now())`,
        [randomUUID(), idempotencyKey],
      );

    await insertDelivery();
    await expectConstraintViolation(insertDelivery(), '23505');
  });

  it('stores only token hashes in auth support tables', async () => {
    const result = await pool.query<{
      column_name: string;
      table_name: string;
    }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name, column_name`,
      [['staff_invitations', 'sessions', 'password_reset_tokens']],
    );
    const columnsByTable = new Map<string, string[]>();

    for (const { column_name, table_name } of result.rows) {
      const columns = columnsByTable.get(table_name) ?? [];
      columns.push(column_name);
      columnsByTable.set(table_name, columns);
    }

    for (const tableName of [
      'staff_invitations',
      'sessions',
      'password_reset_tokens',
    ]) {
      const columns = columnsByTable.get(tableName) ?? [];
      expect(columns).toContain('token_hash');
      expect(columns).not.toContain('token');
      expect(columns).not.toContain('raw_token');
    }
  });

  it('creates the required indexes, including the PostgreSQL partial unique index', async () => {
    const expectedIndexes = [
      'attendance_events_client_event_id_key',
      'attendance_events_event_id_estimated_scanned_at_idx',
      'attendance_events_registration_id_idx',
      'email_deliveries_idempotency_key_key',
      'email_deliveries_status_idx',
      'event_access_event_id_user_id_key',
      'event_access_user_id_idx',
      'persons_birth_date_idx',
      'persons_email_normalized_idx',
      'persons_name_idx',
      'persons_phone_normalized_idx',
      'registration_answers_registration_id_field_id_key',
      'registration_answers_registration_id_idx',
      'registrations_event_id_email_idx',
      'registrations_event_id_last_name_idx',
      'registrations_event_id_person_id_active_key',
      'registrations_event_id_phone_idx',
      'registrations_event_id_status_idx',
      'registrations_event_id_study_group_idx',
      'registrations_person_id_idx',
    ];
    const result = await pool.query<{
      indexdef: string;
      indexname: string;
    }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expectedIndexes],
    );
    const definitions = new Map(
      result.rows.map(({ indexdef, indexname }) => [indexname, indexdef]),
    );

    expect([...definitions.keys()].sort()).toEqual(expectedIndexes.sort());
    expect(
      definitions.get('registrations_event_id_person_id_active_key'),
    ).toMatch(/UNIQUE.*\(event_id, person_id\).*WHERE.*status.*ACTIVE/i);
  });

  it('enforces positive Event capacity and documented timestamp/timezone defaults', async () => {
    const adminId = await insertStaffUser();
    const id = randomUUID();

    await expectConstraintViolation(
      pool.query(
        `INSERT INTO events (
          id, title, slug, start_at, end_at, location, registration_deadline,
          capacity, status, created_by, created_at, updated_at
        ) VALUES ($1, 'Invalid capacity', $2, now(), now(), 'КАИТ №20', now(), 0,
          'DRAFT', $3, now(), now())`,
        [id, `event-${id}`, adminId],
      ),
      '23514',
    );

    const metadata = await pool.query<{
      column_default: string | null;
      data_type: string;
      datetime_precision: number | null;
    }>(
      `SELECT data_type, datetime_precision, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'start_at'`,
    );
    const timezoneDefault = await pool.query<{ column_default: string | null }>(
      `SELECT column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'timezone'`,
    );

    expect(metadata.rows[0]).toMatchObject({
      data_type: 'timestamp with time zone',
      datetime_precision: 3,
    });
    expect(timezoneDefault.rows[0]?.column_default).toContain('Europe/Moscow');
  });
});
