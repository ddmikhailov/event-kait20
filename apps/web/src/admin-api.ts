import {
  activityOperationResponseSchema,
  activityReferenceListSchema,
  activityReferenceSchema,
  acceptedResponseSchema,
  streamResponseSchema,
  streamListResponseSchema,
  type StreamValues,
  type StreamResponse,
  type StreamListResponse,
  excelImportCommitResponseSchema,
  excelImportPreviewResponseSchema,
  eventStatisticsResponseSchema,
  onsiteRegistrationResponseSchema,
  personDetailResponseSchema,
  personListResponseSchema,
  participationListSchema,
  registrationDetailResponseSchema,
  registrationListResponseSchema,
  sendTicketsResponseSchema,
  scoringRuleListSchema,
  scoringRuleSchema,
  scoringPolicyListSchema,
  policyCreatedResponseSchema,
  policyVersionListSchema,
  policyVersionDetailSchema,
  policyVersionCreatedResponseSchema,
  statusTypeListSchema,
  personStatusAssignmentListSchema,
  personStatusAssignmentCreatedSchema,
  seasonListSchema,
  seasonSchema,
  staffInvitationResponseSchema,
  staffInvitationListResponseSchema,
  staffListResponseSchema,
  eventAccessListResponseSchema,
  eventListResponseSchema,
  eventResponseSchema,
  formFieldListResponseSchema,
  formFieldResponseSchema,
  sessionResponseSchema,
  type AcceptedResponse,
  type ActivityOperationResponse,
  type ActivityReference,
  type ActivityReferenceList,
  type ActivityReferenceValues,
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
  type ParticipationAssignRequest,
  type ParticipationCancelRequest,
  type ParticipationConfirmRequest,
  type ParticipationList,
  type PurgeEventRequest,
  type RegistrationDetailResponse,
  type RegistrationListResponse,
  type SendTicketsRequest,
  type SendTicketsResponse,
  type ScoringRule,
  type ScoringRuleList,
  type ScoringRuleValues,
  type ScoringPolicyList,
  type AssignScoringPolicy,
  type PolicyCreate,
  type PolicyCreatedResponse,
  type PolicyVersionList,
  type PolicyVersionDetail,
  type PolicyVersionValues,
  type PolicyVersionCreatedResponse,
  type PublishPolicyVersion,
  type StatusTypeList,
  type StatusAssignment,
  type PersonStatusAssignmentList,
  type PersonStatusAssignmentCreated,
  type Season,
  type SeasonList,
  type SeasonValues,
  type SessionResponse,
  type StaffInvitationRequest,
  type StaffInvitationResponse,
  type StaffInvitationListResponse,
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
  public activityRoles(): Promise<ActivityReferenceList> {
    return this.request(
      '/admin/activity/roles',
      { method: 'GET' },
      activityReferenceListSchema,
    );
  }

  public activityResults(): Promise<ActivityReferenceList> {
    return this.request(
      '/admin/activity/results',
      { method: 'GET' },
      activityReferenceListSchema,
    );
  }

  public activityCategories(): Promise<ActivityReferenceList> {
    return this.request(
      '/admin/activity/categories',
      { method: 'GET' },
      activityReferenceListSchema,
    );
  }

  public activityLevels(): Promise<ActivityReferenceList> {
    return this.request(
      '/admin/activity/levels',
      { method: 'GET' },
      activityReferenceListSchema,
    );
  }

  public createActivityRole(
    values: ActivityReferenceValues,
  ): Promise<ActivityReference> {
    return this.request(
      '/admin/activity/roles',
      { method: 'POST', body: JSON.stringify(values) },
      activityReferenceSchema,
    );
  }

  public seasons(): Promise<SeasonList> {
    return this.request(
      '/admin/activity/seasons',
      { method: 'GET' },
      seasonListSchema,
    );
  }

  public saveSeason(values: SeasonValues, id?: string): Promise<Season> {
    return this.request(
      `/admin/activity/seasons${id ? `/${encodeURIComponent(id)}` : ''}`,
      { method: id ? 'PATCH' : 'POST', body: JSON.stringify(values) },
      seasonSchema,
    );
  }

  public scoringRules(seasonId?: string): Promise<ScoringRuleList> {
    const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : '';
    return this.request(
      `/admin/activity/scoring-rules${query}`,
      { method: 'GET' },
      scoringRuleListSchema,
    );
  }

  public saveScoringRule(
    values: ScoringRuleValues,
    id?: string,
  ): Promise<ScoringRule> {
    return this.request(
      `/admin/activity/scoring-rules${id ? `/${encodeURIComponent(id)}` : ''}`,
      { method: id ? 'PATCH' : 'POST', body: JSON.stringify(values) },
      scoringRuleSchema,
    );
  }

  public scoringPolicies(): Promise<ScoringPolicyList> {
    return this.request(
      '/admin/activity/scoring-v2/policies',
      { method: 'GET' },
      scoringPolicyListSchema,
    );
  }

  public createScoringPolicy(
    values: PolicyCreate,
  ): Promise<PolicyCreatedResponse> {
    return this.request(
      '/admin/activity/scoring-v2/policies',
      { method: 'POST', body: JSON.stringify(values) },
      policyCreatedResponseSchema,
    );
  }

  public scoringPolicyVersions(policyId: string): Promise<PolicyVersionList> {
    return this.request(
      `/admin/activity/scoring-v2/policies/${encodeURIComponent(policyId)}/versions`,
      { method: 'GET' },
      policyVersionListSchema,
    );
  }

  public scoringPolicyVersion(versionId: string): Promise<PolicyVersionDetail> {
    return this.request(
      `/admin/activity/scoring-v2/versions/${encodeURIComponent(versionId)}`,
      { method: 'GET' },
      policyVersionDetailSchema,
    );
  }

  public createScoringPolicyVersion(
    policyId: string,
    values: PolicyVersionValues,
  ): Promise<PolicyVersionCreatedResponse> {
    return this.request(
      `/admin/activity/scoring-v2/policies/${encodeURIComponent(policyId)}/versions`,
      { method: 'POST', body: JSON.stringify(values) },
      policyVersionCreatedResponseSchema,
    );
  }

  public updateScoringPolicyVersion(
    versionId: string,
    values: PolicyVersionValues,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/activity/scoring-v2/versions/${encodeURIComponent(versionId)}`,
      { method: 'PATCH', body: JSON.stringify(values) },
      activityOperationResponseSchema,
    );
  }

  public publishScoringPolicyVersion(
    versionId: string,
    values: PublishPolicyVersion,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/activity/scoring-v2/versions/${encodeURIComponent(versionId)}/publish`,
      { method: 'POST', body: JSON.stringify(values) },
      activityOperationResponseSchema,
    );
  }

  public retireScoringPolicyVersion(
    versionId: string,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/activity/scoring-v2/versions/${encodeURIComponent(versionId)}/retire`,
      { method: 'POST' },
      activityOperationResponseSchema,
    );
  }

  public assignSeasonScoringPolicy(
    seasonId: string,
    values: AssignScoringPolicy,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/activity/scoring-v2/seasons/${encodeURIComponent(seasonId)}/policy`,
      { method: 'POST', body: JSON.stringify(values) },
      activityOperationResponseSchema,
    );
  }

  public scoringStatusTypes(): Promise<StatusTypeList> {
    return this.request(
      '/admin/activity/scoring-v2/status-types',
      { method: 'GET' },
      statusTypeListSchema,
    );
  }

  public personStatuses(personId: string): Promise<PersonStatusAssignmentList> {
    return this.request(
      `/admin/activity/scoring-v2/people/${encodeURIComponent(personId)}/statuses`,
      { method: 'GET' },
      personStatusAssignmentListSchema,
    );
  }

  public assignPersonStatus(
    personId: string,
    values: StatusAssignment,
  ): Promise<PersonStatusAssignmentCreated> {
    return this.request(
      `/admin/activity/scoring-v2/people/${encodeURIComponent(personId)}/statuses`,
      { method: 'POST', body: JSON.stringify(values) },
      personStatusAssignmentCreatedSchema,
    );
  }

  public retirePersonStatus(
    personId: string,
    assignmentId: string,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/activity/scoring-v2/people/${encodeURIComponent(personId)}/statuses/${encodeURIComponent(assignmentId)}`,
      { method: 'DELETE' },
      activityOperationResponseSchema,
    );
  }

  public participations(
    eventId: string,
    page = 1,
    pageSize = 200,
  ): Promise<ParticipationList> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/participations?page=${page}&pageSize=${pageSize}`,
      { method: 'GET' },
      participationListSchema,
    );
  }

  public assignParticipations(
    eventId: string,
    values: ParticipationAssignRequest,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/participations/assign`,
      { method: 'POST', body: JSON.stringify(values) },
      activityOperationResponseSchema,
    );
  }

  public confirmParticipations(
    eventId: string,
    values: ParticipationConfirmRequest,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/participations/confirm`,
      { method: 'POST', body: JSON.stringify(values) },
      activityOperationResponseSchema,
    );
  }

  public cancelParticipations(
    eventId: string,
    values: ParticipationCancelRequest,
  ): Promise<ActivityOperationResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/participations/cancel`,
      { method: 'POST', body: JSON.stringify(values) },
      activityOperationResponseSchema,
    );
  }

  public streams(eventId: string): Promise<StreamListResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/streams`,
      { method: 'GET' },
      streamListResponseSchema,
    );
  }

  public saveStream(
    eventId: string,
    values: StreamValues,
    id?: string,
  ): Promise<StreamResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/streams${id ? `/${encodeURIComponent(id)}` : ''}`,
      { method: id ? 'PATCH' : 'POST', body: JSON.stringify(values) },
      streamResponseSchema,
    );
  }
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
    await this.request('/auth/logout', { method: 'POST' });
    this.csrfToken = undefined;
  }

  public events(
    includeArchived = false,
    page = 1,
    pageSize = 100,
  ): Promise<EventListResponse> {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      includeArchived: String(includeArchived),
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

  public uploadEventCover(
    eventId: string,
    cover: File,
  ): Promise<EventResponse> {
    const body = new FormData();
    body.set('cover', cover);
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/cover`,
      { method: 'POST', body },
      eventResponseSchema,
    );
  }

  public deleteEventCover(eventId: string): Promise<EventResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/cover`,
      { method: 'DELETE' },
      eventResponseSchema,
    );
  }

  public purgeEvent(
    eventId: string,
    values: PurgeEventRequest,
  ): Promise<AcceptedResponse> {
    return this.request(
      `/admin/events/${encodeURIComponent(eventId)}/purge`,
      { method: 'POST', body: JSON.stringify(values) },
      acceptedResponseSchema,
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

  public invitations(): Promise<StaffInvitationListResponse> {
    return this.request(
      '/admin/staff/invitations',
      { method: 'GET' },
      staffInvitationListResponseSchema,
    );
  }

  public resendInvitation(
    id: string,
    requestId: string,
  ): Promise<StaffInvitationResponse> {
    return this.request(
      `/admin/staff/invitations/${id}/resend`,
      { method: 'POST', body: JSON.stringify({ requestId }) },
      staffInvitationResponseSchema,
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
