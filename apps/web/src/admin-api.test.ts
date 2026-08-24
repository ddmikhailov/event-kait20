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
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
