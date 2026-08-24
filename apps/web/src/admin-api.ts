import {
  eventListResponseSchema,
  eventResponseSchema,
  formFieldListResponseSchema,
  formFieldResponseSchema,
  sessionResponseSchema,
  type CreateEventRequest,
  type CreateFormFieldRequest,
  type EventListResponse,
  type EventResponse,
  type FormFieldListResponse,
  type FormFieldResponse,
  type LoginRequest,
  type SessionResponse,
  type UpdateEventRequest,
  type UpdateFormFieldRequest,
} from '@event-registration/contracts';
import type { ZodType } from 'zod';

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(
  /\/$/,
  '',
);

export class AdminApiError extends Error {
  public override readonly name = 'ADMIN_API_ERROR';

  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AdminApiClient {
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
      if (error instanceof AdminApiError && error.status === 401)
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
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.csrfToken = undefined;
    }
  }

  public events(page = 1, pageSize = 100): Promise<EventListResponse> {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    return this.request(
      `/admin/events?${query.toString()}`,
      { method: 'GET' },
      eventListResponseSchema,
    );
  }

  public event(eventId: string): Promise<EventResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}`,
      { method: 'GET' },
      eventResponseSchema,
    );
  }

  public createEvent(values: CreateEventRequest): Promise<EventResponse> {
    return this.request(
      '/admin/events',
      { method: 'POST', body: JSON.stringify(values) },
      eventResponseSchema,
    );
  }

  public updateEvent(
    eventId: string,
    values: UpdateEventRequest,
  ): Promise<EventResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(values) },
      eventResponseSchema,
    );
  }

  public archiveEvent(eventId: string): Promise<EventResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/archive`,
      { method: 'POST' },
      eventResponseSchema,
    );
  }

  public formFields(eventId: string): Promise<FormFieldListResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/form-fields`,
      { method: 'GET' },
      formFieldListResponseSchema,
    );
  }

  public createFormField(
    eventId: string,
    values: CreateFormFieldRequest,
  ): Promise<FormFieldResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/form-fields`,
      { method: 'POST', body: JSON.stringify(values) },
      formFieldResponseSchema,
    );
  }

  public updateFormField(
    eventId: string,
    fieldId: string,
    values: UpdateFormFieldRequest,
  ): Promise<FormFieldResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/form-fields/${encodeURIComponent(fieldId)}`,
      { method: 'PATCH', body: JSON.stringify(values) },
      formFieldResponseSchema,
    );
  }

  public deactivateFormField(
    eventId: string,
    fieldId: string,
  ): Promise<FormFieldResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/form-fields/${encodeURIComponent(fieldId)}`,
      { method: 'DELETE' },
      formFieldResponseSchema,
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
      throw new AdminApiError('NETWORK_ERROR', 0, 'Сервер недоступен');
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = body as
        { error?: { code?: string; message?: string } } | undefined;
      throw new AdminApiError(
        error?.error?.code ?? 'REQUEST_FAILED',
        response.status,
        error?.error?.message ?? 'Запрос не выполнен',
      );
    }
    return schema ? schema.parse(body) : (body as T);
  }
}

export const adminApi = new AdminApiClient();
