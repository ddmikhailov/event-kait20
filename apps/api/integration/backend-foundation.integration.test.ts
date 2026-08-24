import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapSuperAdmin } from '../scripts/bootstrap-super-admin.js';
import { AppModule } from '../src/app.module.js';
import { AuthLinkService } from '../src/auth/auth-link.service.js';
import { hashPassword } from '../src/auth/password.service.js';
import { configureApplication } from '../src/bootstrap.js';
import type { ApiConfig } from '../src/common/config.module.js';
import { APP_CONFIG } from '../src/common/tokens.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required for backend integration tests',
  );
}

const trustedOrigin = 'http://127.0.0.1:5173';
const adminEmail = 'admin@example.test';
const adminPassword = 'correct horse battery staple';
const scannerEmail = 'scanner@example.test';
const scannerPassword = 'scanner secure password';
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
let app: INestApplication;
let baseUrl: string;
let adminId: string;
let scannerId: string;
let eventId: string;
let registrationEventId: string;
let registrationFieldId: string;

type SessionClient = { cookie: string; csrf: string };

const api = async (
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    csrf?: string;
    method?: string;
    origin?: string | null;
  } = {},
): Promise<Response> => {
  const method = options.method ?? 'GET';
  const headers = new Headers();
  if (options.body !== undefined)
    headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.csrf) headers.set('x-csrf-token', options.csrf);
  if (!['GET', 'HEAD'].includes(method) && options.origin !== null) {
    headers.set('origin', options.origin ?? trustedOrigin);
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
};

const login = async (
  email = adminEmail,
  password = adminPassword,
): Promise<SessionClient> => {
  const response = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Lax');

  return {
    cookie: setCookie!.split(';')[0]!,
    csrf: body.csrfToken,
  };
};

const createEvent = async (
  session: SessionClient,
  suffix = '',
  capacity = 100,
) => {
  const response = await api('/admin/events', {
    method: 'POST',
    cookie: session.cookie,
    csrf: session.csrf,
    body: {
      title: `Foundation Event ${suffix}`.trim(),
      slug: `foundation-event${suffix ? `-${suffix}` : ''}`,
      startAt: '2027-06-10T10:00:00.000Z',
      endAt: '2027-06-10T18:00:00.000Z',
      registrationDeadline: '2027-06-09T18:00:00.000Z',
      location: 'Moscow',
      capacity,
      status: 'REGISTRATION_OPEN',
    },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    status: string;
    title: string;
  };
};

const participant = (
  suffix: string,
  overrides: Record<string, unknown> = {},
) => ({
  lastName: `Иванов${suffix}`,
  firstName: 'Иван',
  birthDate: '2005-01-02',
  email: `participant-${suffix.toLowerCase()}@example.test`,
  phone: `+7999${suffix.padStart(7, '0').slice(-7)}`,
  studyGroup: 'ИС-21',
  personType: 'KAIT_STUDENT',
  consentAccepted: true,
  consentVersion: 'test-v1',
  customAnswers: [] as { fieldId: string; value: unknown }[],
  ...overrides,
});

beforeAll(async () => {
  adminId = await bootstrapSuperAdmin(pool, adminEmail, adminPassword);
  app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: false,
  });
  configureApplication(app, app.get<ApiConfig>(APP_CONFIG));
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe.sequential('backend foundation', () => {
  it('authenticates valid staff, creates only a token hash, and exposes session state', async () => {
    const session = await login();
    const rawToken = session.cookie.split('=')[1]!;
    const stored = await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT 1',
    );
    expect(stored.rows[0]?.token_hash).not.toBe(rawToken);
    expect(stored.rows[0]?.token_hash).not.toContain(rawToken);

    const response = await api('/auth/session', { cookie: session.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authenticated: true,
      user: { id: adminId, role: 'SUPER_ADMIN' },
    });
  });

  it('returns the same generic failure for invalid, unknown, and inactive accounts', async () => {
    const passwordHash = await hashPassword(scannerPassword);
    const inactiveId = randomUUID();
    await pool.query(
      `INSERT INTO staff_users
        (id, email, email_normalized, password_hash, system_role, active,
         password_changed_at, created_at, updated_at)
       VALUES ($1, 'inactive@example.test', 'inactive@example.test', $2,
               'SCANNER', false, now(), now(), now())`,
      [inactiveId, passwordHash],
    );

    for (const credentials of [
      { email: adminEmail, password: 'incorrect password value' },
      { email: 'unknown@example.test', password: 'incorrect password value' },
      { email: 'inactive@example.test', password: scannerPassword },
    ]) {
      const response = await api('/auth/login', {
        method: 'POST',
        body: credentials,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS' },
      });
    }
  });

  it('enforces session expiry, revocation, and logout', async () => {
    const expired = await login();
    await pool.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second'
       WHERE token_hash = (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT 1)`,
    );
    expect(
      (await api('/auth/session', { cookie: expired.cookie })).status,
    ).toBe(401);

    const revoked = await login();
    await pool.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE token_hash = (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT 1)`,
    );
    expect(
      (await api('/auth/session', { cookie: revoked.cookie })).status,
    ).toBe(401);

    const logoutSession = await login();
    const logoutResponse = await api('/auth/logout', {
      method: 'POST',
      cookie: logoutSession.cookie,
      csrf: logoutSession.csrf,
    });
    expect(logoutResponse.status).toBe(200);
    expect(
      (await api('/auth/session', { cookie: logoutSession.cookie })).status,
    ).toBe(401);
  });

  it('rejects untrusted origins and missing/invalid CSRF while accepting valid CSRF', async () => {
    const session = await login();
    expect(
      (
        await api('/admin/events', {
          method: 'POST',
          cookie: session.cookie,
          body: {},
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('/admin/events', {
          method: 'POST',
          cookie: session.cookie,
          body: {},
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('/admin/events', {
          method: 'POST',
          cookie: session.cookie,
          csrf: 'invalid-csrf-token',
          body: {},
        })
      ).status,
    ).toBe(403);

    const created = await createEvent(session);
    eventId = created.id;
  });

  it('creates durable password reset intent, enforces expiry and one-time use, and revokes sessions', async () => {
    const oldSession = await login();
    const forgotResponse = await api('/auth/password/forgot', {
      method: 'POST',
      body: { email: adminEmail },
    });
    expect(forgotResponse.status).toBe(202);
    const record = await pool.query<{
      expires_at: Date;
      id: string;
      token_hash: string;
    }>(
      `SELECT id, expires_at, token_hash FROM password_reset_tokens
       ORDER BY created_at DESC LIMIT 1`,
    );
    const row = record.rows[0]!;
    const token = app
      .get(AuthLinkService)
      .createToken('password-reset', row.id, row.expires_at);
    expect(row.token_hash).not.toBe(token);
    const delivery = await pool.query(
      'SELECT id FROM email_deliveries WHERE password_reset_token_id = $1',
      [row.id],
    );
    expect(delivery.rowCount).toBe(1);

    const tamperedToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect(
      (
        await api('/auth/password/reset', {
          method: 'POST',
          body: {
            token: tamperedToken,
            password: 'tampered token must not work',
          },
        })
      ).status,
    ).toBe(400);
    const wrongPurposeToken = app
      .get(AuthLinkService)
      .createToken('invitation', row.id, row.expires_at);
    expect(
      (
        await api('/auth/password/reset', {
          method: 'POST',
          body: {
            token: wrongPurposeToken,
            password: 'wrong purpose must not work',
          },
        })
      ).status,
    ).toBe(400);

    const newPassword = 'new correct horse battery staple';
    const reset = await api('/auth/password/reset', {
      method: 'POST',
      body: { token, password: newPassword },
    });
    expect(reset.status).toBe(200);
    expect(
      (await api('/auth/session', { cookie: oldSession.cookie })).status,
    ).toBe(401);
    expect(
      (
        await api('/auth/password/reset', {
          method: 'POST',
          body: { token, password: newPassword },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/auth/login', {
          method: 'POST',
          body: { email: adminEmail, password: adminPassword },
        })
      ).status,
    ).toBe(401);
    await login(adminEmail, newPassword);
    await pool.query(
      'UPDATE staff_users SET password_hash = $1 WHERE id = $2',
      [await hashPassword(adminPassword), adminId],
    );

    await api('/auth/password/forgot', {
      method: 'POST',
      body: { email: adminEmail },
    });
    const expired = await pool.query<{
      expires_at: Date;
      id: string;
      token_hash: string;
    }>(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'
       WHERE id = (SELECT id FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1)
       RETURNING id, expires_at, token_hash`,
    );
    const expiredRow = expired.rows[0]!;
    const expiredToken = app
      .get(AuthLinkService)
      .createToken('password-reset', expiredRow.id, expiredRow.expires_at);
    expect(
      (
        await api('/auth/password/reset', {
          method: 'POST',
          body: { token: expiredToken, password: newPassword },
        })
      ).status,
    ).toBe(400);
  });

  it('does not let bootstrap overwrite the existing SUPER_ADMIN', async () => {
    await expect(
      bootstrapSuperAdmin(
        pool,
        'replacement@example.test',
        'replacement secure password',
      ),
    ).rejects.toThrow('already exists');
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM staff_users WHERE system_role = 'SUPER_ADMIN'`,
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('supports Event CRUD validation, transitions, listing, and history-safe archive', async () => {
    const session = await login();
    const invalidCapacity = await api('/admin/events', {
      method: 'POST',
      cookie: session.cookie,
      csrf: session.csrf,
      body: {
        title: 'Invalid',
        slug: 'invalid-capacity',
        startAt: '2027-06-10T10:00:00.000Z',
        endAt: '2027-06-10T18:00:00.000Z',
        registrationDeadline: '2027-06-09T18:00:00.000Z',
        location: 'Moscow',
        capacity: 0,
      },
    });
    expect(invalidCapacity.status).toBe(400);
    const invalidDates = await api('/admin/events', {
      method: 'POST',
      cookie: session.cookie,
      csrf: session.csrf,
      body: {
        title: 'Invalid',
        slug: 'invalid-dates',
        startAt: '2027-06-10T10:00:00.000Z',
        endAt: '2027-06-10T09:00:00.000Z',
        registrationDeadline: '2027-06-09T18:00:00.000Z',
        location: 'Moscow',
        capacity: 10,
      },
    });
    expect(invalidDates.status).toBe(400);

    const updated = await api(`/admin/events/${eventId}`, {
      method: 'PATCH',
      cookie: session.cookie,
      csrf: session.csrf,
      body: { title: 'Updated Foundation Event', status: 'REGISTRATION_OPEN' },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: eventId,
      title: 'Updated Foundation Event',
      status: 'REGISTRATION_OPEN',
    });
    expect(
      (await api(`/admin/events/${eventId}`, { cookie: session.cookie }))
        .status,
    ).toBe(200);
    const list = await api('/admin/events', { cookie: session.cookie });
    expect(list.status).toBe(200);
    expect((await list.json()) as { total: number }).toMatchObject({
      total: 1,
    });
  });

  it('invites and activates a SCANNER without persisting raw invitation tokens', async () => {
    const session = await login();
    const invitationResponse = await api('/admin/staff/invitations', {
      method: 'POST',
      cookie: session.cookie,
      csrf: session.csrf,
      body: { email: scannerEmail },
    });
    expect(invitationResponse.status).toBe(201);
    const invitation = (await invitationResponse.json()) as { id: string };
    const record = await pool.query<{
      expires_at: Date;
      token_hash: string;
    }>('SELECT expires_at, token_hash FROM staff_invitations WHERE id = $1', [
      invitation.id,
    ]);
    const invitationToken = app
      .get(AuthLinkService)
      .createToken('invitation', invitation.id, record.rows[0]!.expires_at);
    expect(record.rows[0]!.token_hash).not.toBe(invitationToken);
    const tamperedInvitationToken = `${invitationToken.slice(0, -1)}${invitationToken.endsWith('a') ? 'b' : 'a'}`;
    expect(
      (
        await api(`/auth/invitations/${tamperedInvitationToken}/accept`, {
          method: 'POST',
          body: { password: scannerPassword },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(`/auth/invitations/${invitationToken}/accept`, {
          method: 'POST',
          body: { password: scannerPassword },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(`/auth/invitations/${invitationToken}/accept`, {
          method: 'POST',
          body: { password: scannerPassword },
        })
      ).status,
    ).toBe(400);
    const scanner = await pool.query<{ id: string }>(
      'SELECT id FROM staff_users WHERE email_normalized = $1',
      [scannerEmail],
    );
    scannerId = scanner.rows[0]!.id;
  });

  it('enforces RBAC and assigned EventAccess with database uniqueness', async () => {
    const scanner = await login(scannerEmail, scannerPassword);
    const admin = await login();
    expect(
      (await api('/admin/events', { cookie: scanner.cookie })).status,
    ).toBe(403);
    expect(
      (
        await api('/admin/events', {
          method: 'POST',
          cookie: scanner.cookie,
          csrf: scanner.csrf,
          body: {},
        })
      ).status,
    ).toBe(403);
    const unassigned = await api('/scanner/events', { cookie: scanner.cookie });
    expect((await unassigned.json()) as { items: unknown[] }).toMatchObject({
      items: [],
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await api(`/admin/events/${eventId}/access`, {
            method: 'POST',
            cookie: admin.cookie,
            csrf: admin.csrf,
            body: { userId: scannerId },
          })
        ).status,
      ).toBe(200);
    }
    const accessCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM event_access WHERE event_id = $1 AND user_id = $2',
      [eventId, scannerId],
    );
    expect(accessCount.rows[0]?.count).toBe('1');
    const assigned = await api('/scanner/events', { cookie: scanner.cookie });
    const assignedBody = (await assigned.json()) as { items: { id: string }[] };
    expect(assignedBody.items.map((event) => event.id)).toContain(eventId);
  });

  it('validates form field types, updates fields, and soft-deactivates without deletion', async () => {
    const session = await login();
    const invalid = await api(`/admin/events/${eventId}/form-fields`, {
      method: 'POST',
      cookie: session.cookie,
      csrf: session.csrf,
      body: {
        type: 'BOOLEAN',
        label: 'Confirm',
        required: true,
        sortOrder: 0,
        options: ['yes', 'no'],
      },
    });
    expect(invalid.status).toBe(400);
    const created = await api(`/admin/events/${eventId}/form-fields`, {
      method: 'POST',
      cookie: session.cookie,
      csrf: session.csrf,
      body: {
        type: 'SINGLE_CHOICE',
        label: 'Track',
        required: true,
        sortOrder: 1,
        options: ['Backend', 'Frontend'],
      },
    });
    expect(created.status).toBe(201);
    const field = (await created.json()) as { id: string };
    const updated = await api(
      `/admin/events/${eventId}/form-fields/${field.id}`,
      {
        method: 'PATCH',
        cookie: session.cookie,
        csrf: session.csrf,
        body: { label: 'Preferred track' },
      },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      label: 'Preferred track',
      active: true,
    });
    const deactivated = await api(
      `/admin/events/${eventId}/form-fields/${field.id}`,
      {
        method: 'DELETE',
        cookie: session.cookie,
        csrf: session.csrf,
      },
    );
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({ active: false });
    const retained = await pool.query<{ active: boolean }>(
      'SELECT active FROM event_form_fields WHERE id = $1',
      [field.id],
    );
    expect(retained.rows[0]?.active).toBe(false);
  });

  it('archives Events without deleting history and prevents further edits', async () => {
    const session = await login();
    const archived = await api(`/admin/events/${eventId}/archive`, {
      method: 'POST',
      cookie: session.cookie,
      csrf: session.csrf,
    });
    expect(archived.status).toBe(201);
    expect(await archived.json()).toMatchObject({ status: 'ARCHIVED' });
    expect(
      (
        await api(`/admin/events/${eventId}`, {
          method: 'PATCH',
          cookie: session.cookie,
          csrf: session.csrf,
          body: { title: 'Must not change' },
        })
      ).status,
    ).toBe(409);
    const retained = await pool.query('SELECT id FROM events WHERE id = $1', [
      eventId,
    ]);
    expect(retained.rowCount).toBe(1);
  });

  it('deactivates staff, revokes sessions, and blocks subsequent login', async () => {
    const admin = await login();
    const scanner = await login(scannerEmail, scannerPassword);
    expect(
      (
        await api(`/admin/staff/${scannerId}/deactivate`, {
          method: 'POST',
          cookie: admin.cookie,
          csrf: admin.csrf,
        })
      ).status,
    ).toBe(200);
    expect(
      (await api('/auth/session', { cookie: scanner.cookie })).status,
    ).toBe(401);
    const loginResponse = await api('/auth/login', {
      method: 'POST',
      body: { email: scannerEmail, password: scannerPassword },
    });
    expect(loginResponse.status).toBe(401);
  });

  it('publishes an open Event with active form fields and current consent metadata', async () => {
    const admin = await login();
    const event = await createEvent(admin, 'registration-core', 2);
    registrationEventId = event.id;
    const fieldResponse = await api(
      `/admin/events/${registrationEventId}/form-fields`,
      {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
        body: {
          type: 'SINGLE_CHOICE',
          label: 'Направление',
          required: true,
          sortOrder: 1,
          options: ['Backend', 'Frontend'],
        },
      },
    );
    expect(fieldResponse.status).toBe(201);
    registrationFieldId = ((await fieldResponse.json()) as { id: string }).id;

    const response = await api(
      '/public/events/foundation-event-registration-core',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      availability: 'OPEN',
      consentUrl: 'https://example.test/consent',
      consentVersion: 'test-v1',
      formFields: [
        {
          id: registrationFieldId,
          label: 'Направление',
          required: true,
        },
      ],
    });
  });

  it('validates form and consent versions before persisting public registration', async () => {
    const path = '/public/events/foundation-event-registration-core/register';
    const staleConsent = await api(path, {
      method: 'POST',
      body: participant('1000001', {
        consentVersion: 'stale-v0',
        customAnswers: [{ fieldId: registrationFieldId, value: 'Backend' }],
      }),
    });
    expect(staleConsent.status).toBe(409);
    expect(await staleConsent.json()).toMatchObject({
      error: { code: 'FORM_VERSION_INVALID' },
    });
    const missingRequiredAnswer = await api(path, {
      method: 'POST',
      body: participant('1000001'),
    });
    expect(missingRequiredAnswer.status).toBe(409);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM registrations WHERE event_id = $1',
      [registrationEventId],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('creates Person, Registration snapshot, typed answers, consent, and durable email intent', async () => {
    const response = await api(
      '/public/events/foundation-event-registration-core/register',
      {
        method: 'POST',
        body: participant('1000001', {
          customAnswers: [{ fieldId: registrationFieldId, value: 'Backend' }],
        }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      registrationId: string;
      status: string;
      ticketUrl: string;
    };
    expect(body.status).toBe('REGISTERED');
    expect(body.ticketUrl).not.toContain('Иванов');
    expect(body.ticketUrl).not.toContain('example.test@');

    const persisted = await pool.query<{
      answer: unknown;
      consent_accepted: boolean;
      consent_url: string;
      consent_version: string;
      delivery_count: string;
      organization: string;
    }>(
      `SELECT r.consent_accepted, r.consent_url, r.consent_version,
              r.organization, ra.answer,
              (SELECT count(*)::text FROM email_deliveries ed
               WHERE ed.registration_id = r.id) AS delivery_count
       FROM registrations r
       JOIN registration_answers ra ON ra.registration_id = r.id
       WHERE r.id = $1`,
      [body.registrationId],
    );
    expect(persisted.rows[0]).toMatchObject({
      answer: 'Backend',
      consent_accepted: true,
      consent_url: 'https://example.test/consent',
      consent_version: 'test-v1',
      delivery_count: '1',
      organization: 'КАИТ №20',
    });
  });

  it('resolves a confident repeat without creating duplicate Person or Registration', async () => {
    const response = await api(
      '/public/events/foundation-event-registration-core/register',
      {
        method: 'POST',
        body: participant('1000001', {
          studyGroup: 'ИС-22',
          customAnswers: [{ fieldId: registrationFieldId, value: 'Frontend' }],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ALREADY_REGISTERED',
    });
    const counts = await pool.query<{
      deliveries: string;
      persons: string;
      registrations: string;
      study_group: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM persons WHERE email_normalized = $1) AS persons,
         (SELECT count(*)::text FROM registrations WHERE event_id = $2) AS registrations,
         (SELECT count(*)::text FROM email_deliveries ed JOIN registrations r
          ON r.id = ed.registration_id WHERE r.event_id = $2) AS deliveries,
         (SELECT study_group FROM registrations WHERE event_id = $2) AS study_group`,
      ['participant-1000001@example.test', registrationEventId],
    );
    expect(counts.rows[0]).toMatchObject({
      persons: '1',
      registrations: '1',
      deliveries: '2',
      study_group: 'ИС-22',
    });
  });

  it('reuses Person across Events without rewriting the earlier Registration snapshot', async () => {
    const admin = await login();
    await createEvent(admin, 'second-registration', 2);
    const response = await api(
      '/public/events/foundation-event-second-registration/register',
      {
        method: 'POST',
        body: participant('1000001', { studyGroup: 'ИС-23' }),
      },
    );
    expect(response.status).toBe(201);
    const history = await pool.query<{
      current_group: string;
      first_snapshot: string;
      person_count: string;
      registration_count: string;
      second_snapshot: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM persons WHERE email_normalized = $1) AS person_count,
         (SELECT count(*)::text FROM registrations r JOIN persons p ON p.id = r.person_id
          WHERE p.email_normalized = $1) AS registration_count,
         (SELECT study_group FROM persons WHERE email_normalized = $1) AS current_group,
         (SELECT r.study_group FROM registrations r JOIN events e ON e.id = r.event_id
          WHERE e.slug = 'foundation-event-registration-core') AS first_snapshot,
         (SELECT r.study_group FROM registrations r JOIN events e ON e.id = r.event_id
          WHERE e.slug = 'foundation-event-second-registration') AS second_snapshot`,
      ['participant-1000001@example.test'],
    );
    expect(history.rows[0]).toMatchObject({
      person_count: '1',
      registration_count: '2',
      current_group: 'ИС-23',
      first_snapshot: 'ИС-22',
      second_snapshot: 'ИС-23',
    });
  });

  it('preserves answer snapshots when the Event form field changes', async () => {
    const admin = await login();
    const update = await api(
      `/admin/events/${registrationEventId}/form-fields/${registrationFieldId}`,
      {
        method: 'PATCH',
        cookie: admin.cookie,
        csrf: admin.csrf,
        body: { label: 'Новое название поля' },
      },
    );
    expect(update.status).toBe(200);
    const snapshots = await pool.query<{
      current_label: string;
      snapshot_label: string;
    }>(
      `SELECT f.label AS current_label, a.field_label_snapshot AS snapshot_label
       FROM registration_answers a
       JOIN event_form_fields f ON f.id = a.field_id
       WHERE a.field_id = $1`,
      [registrationFieldId],
    );
    expect(snapshots.rows[0]).toMatchObject({
      current_label: 'Новое название поля',
      snapshot_label: 'Направление',
    });
  });

  it('creates a review-marked Person when strong identifiers point to different people', async () => {
    await pool.query(
      `INSERT INTO persons
        (id, last_name, first_name, birth_date, email, email_normalized,
         phone, phone_normalized, person_type, organization, study_group,
         dedup_review_required, created_at, updated_at)
       VALUES ($1, 'Иванов1000001', 'Иван', '2004-02-03', $2, $2, $3, $3,
               'KAIT_STUDENT', 'КАИТ №20', 'ИС-20', false, now(), now())`,
      [randomUUID(), 'conflict@example.test', '+79995550000'],
    );
    const admin = await login();
    await createEvent(admin, 'dedup-conflict', 2);
    const response = await api(
      '/public/events/foundation-event-dedup-conflict/register',
      {
        method: 'POST',
        body: participant('1000001', {
          birthDate: '2004-02-03',
          phone: '+79995550000',
        }),
      },
    );
    expect(response.status).toBe(201);
    const people = await pool.query<{
      count: string;
      review_count: string;
    }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE dedup_review_required)::text AS review_count
       FROM persons WHERE last_name = 'Иванов1000001'`,
    );
    expect(people.rows[0]).toMatchObject({
      count: '3',
      review_count: '1',
    });
  });

  it('rejects registration after the deadline without creating business rows', async () => {
    const admin = await login();
    const event = await createEvent(admin, 'closed-deadline', 2);
    await pool.query(
      `UPDATE events SET registration_deadline = now() - interval '1 minute'
       WHERE id = $1`,
      [event.id],
    );
    const response = await api(
      '/public/events/foundation-event-closed-deadline/register',
      { method: 'POST', body: participant('3000001') },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'REGISTRATION_CLOSED' },
    });
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM registrations WHERE event_id = $1',
      [event.id],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('serializes concurrent public registration so capacity cannot be exceeded', async () => {
    const admin = await login();
    await createEvent(admin, 'capacity-race', 1);
    const path = '/public/events/foundation-event-capacity-race/register';
    const responses = await Promise.all([
      api(path, { method: 'POST', body: participant('2000001') }),
      api(path, { method: 'POST', body: participant('2000002') }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const failure = responses.find((response) => response.status === 409)!;
    expect(await failure.json()).toMatchObject({
      error: { code: 'CAPACITY_FULL' },
    });
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM registrations r
       JOIN events e ON e.id = r.event_id
       WHERE e.slug = 'foundation-event-capacity-race' AND r.status = 'ACTIVE'`,
    );
    expect(count.rows[0]?.count).toBe('1');
  });
});
