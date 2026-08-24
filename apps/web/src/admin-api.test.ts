import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminApiClient } from './admin-api.js';

const session = {
  authenticated: true as const,
  csrfToken: 'csrf-token-with-sufficient-length',
  expiresAt: '2026-09-01T12:00:00.000Z',
  user: {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'admin@example.test',
    role: 'SUPER_ADMIN' as const,
  },
};

describe('admin API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses credentialed cookies and keeps CSRF in memory for mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(
        jsonResponse({ items: [], page: 1, pageSize: 100, total: 0 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdminApiClient();

    await client.login({
      email: 'admin@example.test',
      password: 'password1234',
    });
    await client.events();

    const loginInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const eventInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(loginInit.credentials).toBe('include');
    expect(new Headers(loginInit.headers).has('x-csrf-token')).toBe(false);
    expect(eventInit.credentials).toBe('include');
  });

  it('adds CSRF to an authenticated write request without exposing it in storage', async () => {
    const archived = {
      id: '20000000-0000-4000-8000-000000000001',
      title: 'Событие',
      slug: 'event',
      description: null,
      coverObjectKey: null,
      startAt: '2026-09-01T10:00:00.000Z',
      endAt: '2026-09-01T12:00:00.000Z',
      timezone: 'Europe/Moscow',
      location: 'Колледж',
      registrationDeadline: '2026-09-01T09:00:00.000Z',
      capacity: 100,
      status: 'ARCHIVED',
      archivedAt: '2026-08-01T10:00:00.000Z',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse(archived));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdminApiClient();

    await client.restoreSession();
    await client.archiveEvent(archived.id);

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(
      session.csrfToken,
    );
    expect(init.credentials).toBe('include');
  });

  it('treats an unauthenticated session response as a signed-out state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(
      new AdminApiClient().restoreSession(),
    ).resolves.toBeUndefined();
  });

  it('encodes participant search filters and validates the list response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: [], page: 2, pageSize: 25, total: 30 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await new AdminApiClient().registrations(
      '10000000-0000-4000-8000-000000000001',
      'Иванов +7999',
      'ACTIVE',
      2,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'query=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2+%2B7999',
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('status=ACTIVE');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('page=2');
  });

  it('sends invitation intent with CSRF without ever receiving a raw token', async () => {
    const invitation = {
      id: '30000000-0000-4000-8000-000000000001',
      expiresAt: '2026-09-01T12:00:00.000Z',
      status: 'queued' as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse(invitation));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdminApiClient();
    await client.restoreSession();

    const result = await client.inviteStaff({
      email: 'scanner@example.test',
      eventId: '40000000-0000-4000-8000-000000000001',
    });

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(
      session.csrfToken,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'scanner@example.test',
      eventId: '40000000-0000-4000-8000-000000000001',
    });
    expect(result).toEqual(invitation);
    expect(result).not.toHaveProperty('token');
  });

  it('uses the event-scoped access route for assignments', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'accepted' }));
    vi.stubGlobal('fetch', fetchMock);

    await new AdminApiClient().assignEventAccess(
      '50000000-0000-4000-8000-000000000001',
      { userId: '60000000-0000-4000-8000-000000000001' },
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/admin/events/50000000-0000-4000-8000-000000000001/access',
    );
  });

  it('uploads Excel as multipart with CSRF and without a forced JSON content type', async () => {
    const preview = {
      importJobId: '70000000-0000-4000-8000-000000000001',
      expiresAt: '2026-08-25T12:00:00.000Z',
      headers: ['Фамилия', 'Имя', 'Дата рождения', 'Тип участника', 'Телефон'],
      mapping: {
        lastName: 'Фамилия',
        firstName: 'Имя',
        birthDate: 'Дата рождения',
        personType: 'Тип участника',
        phone: 'Телефон',
        customFields: {},
      },
      summary: {
        totalRows: 1,
        newRows: 1,
        alreadyRegisteredRows: 0,
        possibleMatchRows: 0,
        errorRows: 0,
        withoutEmailRows: 1,
        capacityImpact: 1,
        activeRegistrations: 0,
        capacity: 100,
        exceedsCapacity: false,
      },
      rows: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse(preview, 201));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdminApiClient();
    await client.restoreSession();

    await client.previewExcel(
      '10000000-0000-4000-8000-000000000001',
      new File(['xlsx'], 'participants.xlsx'),
    );

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(init.body).toBeInstanceOf(FormData);
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('x-csrf-token')).toBe(session.csrfToken);
  });

  it('queues an idempotent imported-ticket batch with in-memory CSRF', async () => {
    const requestId = '80000000-0000-4000-8000-000000000001';
    const result = {
      requestId,
      queuedRows: 2,
      alreadyQueuedRows: 0,
      withoutEmailRows: 1,
      inactiveOrMissingRows: 0,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse(result, 201));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AdminApiClient();
    await client.restoreSession();

    await client.sendTickets('10000000-0000-4000-8000-000000000001', {
      requestId,
      selection: 'IMPORTED',
    });

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      requestId,
      selection: 'IMPORTED',
    });
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(
      session.csrfToken,
    );
  });
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
