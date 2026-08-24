import {
  acceptedResponseSchema,
  excelImportCommitResponseSchema,
  excelImportPreviewResponseSchema,
  eventStatisticsResponseSchema,
  onsiteRegistrationResponseSchema,
  personDetailResponseSchema,
  personListResponseSchema,
  registrationDetailResponseSchema,
  registrationListResponseSchema,
  sendTicketsResponseSchema,
  staffInvitationResponseSchema,
  staffListResponseSchema,
  eventAccessListResponseSchema,
  eventListResponseSchema,
  eventResponseSchema,
  formFieldListResponseSchema,
  formFieldResponseSchema,
  sessionResponseSchema,
  type AcceptedResponse,
  type AdminOnsiteRegistrationRequest,
  type CreateEventRequest,
  type CreateFormFieldRequest,
  type EventListResponse,
  type EventResponse,
  type EventStatisticsResponse,
  type EventAccessListResponse,
  type EventAccessRequest,
  type FormFieldListResponse,
  type FormFieldResponse,
  type ExcelImportCommitRequest,
  type ExcelImportCommitResponse,
  type ExcelImportPreviewResponse,
  type LoginRequest,
  type OnsiteRegistrationResponse,
  type PersonDetailResponse,
  type PersonListResponse,
  type RegistrationDetailResponse,
  type RegistrationListResponse,
  type SendTicketsRequest,
  type SendTicketsResponse,
  type SessionResponse,
  type StaffInvitationRequest,
  type StaffInvitationResponse,
  type StaffListResponse,
  type UpdateEventRequest,
  type UpdateFormFieldRequest,
  type UpdatePersonRequest,
  type UpdateRegistrationRequest,
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

  public registrations(
    eventId: string,
    query = '',
    status?: 'ACTIVE' | 'ANNULLED',
    page = 1,
    pageSize = 25,
  ): Promise<RegistrationListResponse> {
    const parameters = new URLSearchParams({
      query,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (status) parameters.set('status', status);
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/registrations?${parameters.toString()}`,
      { method: 'GET' },
      registrationListResponseSchema,
    );
  }

  public registration(
    eventId: string,
    registrationId: string,
  ): Promise<RegistrationDetailResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}`,
      { method: 'GET' },
      registrationDetailResponseSchema,
    );
  }

  public updateRegistration(
    eventId: string,
    registrationId: string,
    values: UpdateRegistrationRequest,
  ): Promise<RegistrationDetailResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}`,
      { method: 'PATCH', body: JSON.stringify(values) },
      registrationDetailResponseSchema,
    );
  }

  public annulRegistration(
    eventId: string,
    registrationId: string,
  ): Promise<AcceptedResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/annul`,
      { method: 'POST' },
      acceptedResponseSchema,
    );
  }

  public resendTicket(
    eventId: string,
    registrationId: string,
  ): Promise<AcceptedResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/resend-ticket`,
      { method: 'POST' },
      acceptedResponseSchema,
    );
  }

  public onsiteRegistration(
    eventId: string,
    values: AdminOnsiteRegistrationRequest,
  ): Promise<OnsiteRegistrationResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/registrations/onsite`,
      { method: 'POST', body: JSON.stringify(values) },
      onsiteRegistrationResponseSchema,
    );
  }

  public people(
    query = '',
    page = 1,
    pageSize = 25,
  ): Promise<PersonListResponse> {
    const parameters = new URLSearchParams({
      query,
      page: String(page),
      pageSize: String(pageSize),
    });
    return this.request(
      `/admin/people?${parameters.toString()}`,
      { method: 'GET' },
      personListResponseSchema,
    );
  }

  public person(personId: string): Promise<PersonDetailResponse> {
    return this.request(
      `/admin/people/${encodeURIComponent(personId)}`,
      { method: 'GET' },
      personDetailResponseSchema,
    );
  }

  public updatePerson(
    personId: string,
    values: UpdatePersonRequest,
  ): Promise<PersonDetailResponse> {
    return this.request(
      `/admin/people/${encodeURIComponent(personId)}`,
      { method: 'PATCH', body: JSON.stringify(values) },
      personDetailResponseSchema,
    );
  }

  public staff(): Promise<StaffListResponse> {
    return this.request(
      '/admin/staff',
      { method: 'GET' },
      staffListResponseSchema,
    );
  }

  public inviteStaff(
    values: StaffInvitationRequest,
  ): Promise<StaffInvitationResponse> {
    return this.request(
      '/admin/staff/invitations',
      { method: 'POST', body: JSON.stringify(values) },
      staffInvitationResponseSchema,
    );
  }

  public deactivateStaff(userId: string): Promise<AcceptedResponse> {
    return this.request(
      `/admin/staff/${encodeURIComponent(userId)}/deactivate`,
      { method: 'POST' },
      acceptedResponseSchema,
    );
  }

  public eventAccess(eventId: string): Promise<EventAccessListResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/access`,
      { method: 'GET' },
      eventAccessListResponseSchema,
    );
  }

  public assignEventAccess(
    eventId: string,
    values: EventAccessRequest,
  ): Promise<AcceptedResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/access`,
      { method: 'POST', body: JSON.stringify(values) },
      acceptedResponseSchema,
    );
  }

  public removeEventAccess(
    eventId: string,
    userId: string,
  ): Promise<AcceptedResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/access/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
      acceptedResponseSchema,
    );
  }

  public previewExcel(
    eventId: string,
    file: File,
  ): Promise<ExcelImportPreviewResponse> {
    const form = new FormData();
    form.set('file', file);
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/import/preview`,
      { method: 'POST', body: form },
      excelImportPreviewResponseSchema,
    );
  }

  public commitExcel(
    eventId: string,
    importJobId: string,
    values: ExcelImportCommitRequest,
  ): Promise<ExcelImportCommitResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/import/${encodeURIComponent(importJobId)}/commit`,
      { method: 'POST', body: JSON.stringify(values) },
      excelImportCommitResponseSchema,
    );
  }

  public async exportExcel(
    eventId: string,
  ): Promise<{ blob: Blob; filename: string }> {
    let response: Response;
    try {
      response = await fetch(
        `${apiBaseUrl}/admin/events/${encodeURIComponent(eventId)}/export.xlsx`,
        { credentials: 'include' },
      );
    } catch {
      throw new AdminApiError('NETWORK_ERROR', 0, 'Сервер недоступен');
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        { error?: { code?: string; message?: string } } | undefined;
      throw new AdminApiError(
        body?.error?.code ?? 'REQUEST_FAILED',
        response.status,
        body?.error?.message ?? 'Экспорт не выполнен',
      );
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    return {
      blob: await response.blob(),
      filename: encoded ? decodeURIComponent(encoded) : 'participants.xlsx',
    };
  }

  public eventStatistics(eventId: string): Promise<EventStatisticsResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/statistics`,
      { method: 'GET' },
      eventStatisticsResponseSchema,
    );
  }

  public sendTickets(
    eventId: string,
    values: SendTicketsRequest,
  ): Promise<SendTicketsResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/send-tickets`,
      { method: 'POST', body: JSON.stringify(values) },
      sendTicketsResponseSchema,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema?: ZodType<T>,
    includeCsrf = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string')
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
