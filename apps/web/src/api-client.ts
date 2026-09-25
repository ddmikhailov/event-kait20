import {
  acceptedResponseSchema,
  publicEventResponseSchema,
  publicEventListResponseSchema,
  publicRegistrationResponseSchema,
  publicAchievementListSchema,
  publicParticipationListSchema,
  publicProfileSchema,
  publicStudentListSchema,
  publicLeaderboardSeasonsSchema,
  leaderboardResponseSchema,
  publicScoreTransactionListSchema,
  ticketResponseSchema,
  type PublicEventResponse,
  type PublicEventListResponse,
  type PublicRegistrationRequest,
  type PublicRegistrationResponse,
  type PublicAchievementList,
  type PublicParticipationList,
  type PublicProfile,
  type PublicStudentList,
  type PublicLeaderboardSeasons,
  type LeaderboardResponse,
  type PublicScoreTransactionList,
  type TicketResponse,
  type AcceptedResponse,
} from '@event-registration/contracts';
import type { ZodType } from 'zod';
import { z } from 'zod';

const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(
  /\/$/,
  '',
);

export class PublicApiError extends Error {
  public override readonly name = 'PUBLIC_API_ERROR';

  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PublicApiClient {
  public leaderboardSeasons(): Promise<PublicLeaderboardSeasons> {
    return this.request(
      '/public/leaderboard/seasons',
      { method: 'GET', cache: 'no-store' },
      publicLeaderboardSeasonsSchema,
    );
  }

  public leaderboard(
    seasonId: string,
    offset = 0,
  ): Promise<LeaderboardResponse> {
    const params = new URLSearchParams({
      seasonId,
      limit: '20',
      offset: String(offset),
    });
    return this.request(
      `/public/leaderboard?${params.toString()}`,
      { method: 'GET', cache: 'no-store' },
      leaderboardResponseSchema,
    );
  }

  public studentScoreTransactions(
    slug: string,
    page = 1,
  ): Promise<PublicScoreTransactionList> {
    return this.request(
      `/public/profiles/${encodeURIComponent(slug)}/score-transactions?page=${page}&pageSize=25`,
      { method: 'GET', cache: 'no-store' },
      publicScoreTransactionListSchema,
    );
  }

  public students(query = '', offset = 0): Promise<PublicStudentList> {
    const params = new URLSearchParams({ limit: '24', offset: String(offset) });
    if (query.trim().length >= 2) params.set('q', query.trim());
    return this.request(
      `/public/students?${params.toString()}`,
      { method: 'GET', cache: 'no-store' },
      publicStudentListSchema,
    );
  }

  public student(slug: string): Promise<PublicProfile> {
    return this.request(
      `/public/profiles/${encodeURIComponent(slug)}`,
      { method: 'GET', cache: 'no-store' },
      publicProfileSchema,
    );
  }

  public studentParticipations(
    slug: string,
    page = 1,
  ): Promise<PublicParticipationList> {
    return this.request(
      `/public/profiles/${encodeURIComponent(slug)}/participations?page=${page}&pageSize=25`,
      { method: 'GET', cache: 'no-store' },
      publicParticipationListSchema,
    );
  }

  public studentAchievements(
    slug: string,
    page = 1,
  ): Promise<PublicAchievementList> {
    return this.request(
      `/public/profiles/${encodeURIComponent(slug)}/achievements?page=${page}&pageSize=25`,
      { method: 'GET', cache: 'no-store' },
      publicAchievementListSchema,
    );
  }

  public events(): Promise<PublicEventListResponse> {
    return this.request(
      '/public/events',
      { method: 'GET' },
      publicEventListResponseSchema,
    );
  }

  public event(slug: string): Promise<PublicEventResponse> {
    return this.request(
      `/public/events/${encodeURIComponent(slug)}`,
      { method: 'GET' },
      publicEventResponseSchema,
    );
  }

  public register(
    slug: string,
    body: PublicRegistrationRequest,
  ): Promise<PublicRegistrationResponse> {
    return this.request(
      `/public/events/${encodeURIComponent(slug)}/register`,
      { method: 'POST', body: JSON.stringify(body) },
      publicRegistrationResponseSchema,
    );
  }

  public ticket(publicId: string, signature: string): Promise<TicketResponse> {
    return this.request(
      `/tickets/${encodeURIComponent(publicId)}/${encodeURIComponent(signature)}`,
      { method: 'GET', cache: 'no-store' },
      ticketResponseSchema,
    );
  }

  public forgotPassword(email: string): Promise<{ status: 'accepted' }> {
    return this.request(
      '/auth/password/forgot',
      { method: 'POST', body: JSON.stringify({ email }) },
      z.object({ status: z.literal('accepted') }),
    );
  }

  public resetPassword(
    token: string,
    password: string,
  ): Promise<{ status: 'accepted' }> {
    return this.request(
      '/auth/password/reset',
      { method: 'POST', body: JSON.stringify({ token, password }) },
      z.object({ status: z.literal('accepted') }),
    );
  }

  public acceptInvitation(
    token: string,
    password: string,
  ): Promise<AcceptedResponse> {
    return this.request(
      `/auth/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST', body: JSON.stringify({ password }) },
      acceptedResponseSchema,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema: ZodType<T>,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined)
      headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers,
        credentials: 'omit',
      });
    } catch {
      throw new PublicApiError('NETWORK_ERROR', 0, 'Сервер недоступен');
    }
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = body as
        { error?: { code?: string; message?: string } } | undefined;
      throw new PublicApiError(
        error?.error?.code ?? 'REQUEST_FAILED',
        response.status,
        error?.error?.message ?? 'Запрос не выполнен',
      );
    }
    return schema.parse(body);
  }
}

export const publicMediaUrl = (key: string): string =>
  `${apiBaseUrl}/media/event-covers/${encodeURIComponent(key)}`;

export const publicApi = new PublicApiClient();
