import {
  attendanceSyncResponseSchema,
  offlineBundleResponseSchema,
  resolveQrResponseSchema,
  scannerEventListResponseSchema,
  scannerRegistrationListResponseSchema,
  sessionResponseSchema,
  type AttendanceSyncRequest,
  type AttendanceSyncResponse,
  type LoginRequest,
  type OfflineBundleResponse,
  type ResolveQrResponse,
  type ScannerEventListResponse,
  type ScannerRegistrationListResponse,
  type SessionResponse,
} from '@event-registration/contracts';
import type { ZodType } from 'zod';

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(
  /\/$/,
  '',
);

export class ApiClientError extends Error {
  public override readonly name = 'API_CLIENT_ERROR';

  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ScannerApiClient {
  private csrfToken: string | undefined;

  public async restoreSession(): Promise<SessionResponse | undefined> {
    try {
      const session = await this.request(
        '/auth/session',
        { method: 'GET' },
        sessionResponseSchema,
      );
      this.csrfToken = session.csrfToken;
      return session;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401)
        return undefined;
      throw error;
    }
  }

  public async login(values: LoginRequest): Promise<SessionResponse> {
    const session = await this.request(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(values) },
      sessionResponseSchema,
      false,
    );
    this.csrfToken = session.csrfToken;
    return session;
  }

  public async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' });
    this.csrfToken = undefined;
  }

  public events(): Promise<ScannerEventListResponse> {
    return this.request(
      '/scanner/events',
      { method: 'GET' },
      scannerEventListResponseSchema,
    );
  }

  public bundle(eventId: string): Promise<OfflineBundleResponse> {
    return this.request(
      `/scanner/events/${encodeURIComponent(eventId)}/offline-bundle`,
      { method: 'GET' },
      offlineBundleResponseSchema,
    );
  }

  public resolveQr(
    eventId: string,
    qrPayload: string,
  ): Promise<ResolveQrResponse> {
    return this.request(
      `/scanner/events/${encodeURIComponent(eventId)}/resolve-qr`,
      { method: 'POST', body: JSON.stringify({ qrPayload }) },
      resolveQrResponseSchema,
    );
  }

  public sync(
    eventId: string,
    body: AttendanceSyncRequest,
  ): Promise<AttendanceSyncResponse> {
    return this.request(
      `/scanner/events/${encodeURIComponent(eventId)}/attendance/sync`,
      { method: 'POST', body: JSON.stringify(body) },
      attendanceSyncResponseSchema,
    );
  }

  public search(
    eventId: string,
    query: string,
  ): Promise<ScannerRegistrationListResponse> {
    const parameters = new URLSearchParams({
      query,
      page: '1',
      pageSize: '50',
    });
    return this.request(
      `/scanner/events/${encodeURIComponent(eventId)}/registrations/search?${parameters.toString()}`,
      { method: 'GET' },
      scannerRegistrationListResponseSchema,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema?: ZodType<T>,
    includeCsrf = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined)
      headers.set('content-type', 'application/json');
    if (
      includeCsrf &&
      this.csrfToken &&
      init.method &&
      !['GET', 'HEAD'].includes(init.method)
    ) {
      headers.set('x-csrf-token', this.csrfToken);
    }
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
    } catch {
      throw new ApiClientError('NETWORK_ERROR', 0, 'Сервер недоступен');
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = body as
        { error?: { code?: string; message?: string } } | undefined;
      throw new ApiClientError(
        error?.error?.code ?? 'REQUEST_FAILED',
        response.status,
        error?.error?.message ?? 'Запрос не выполнен',
      );
    }
    return schema ? schema.parse(body) : (body as T);
  }
}

export const scannerApi = new ScannerApiClient();
