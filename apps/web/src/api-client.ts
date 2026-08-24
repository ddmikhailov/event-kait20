import {
  publicEventResponseSchema,
  publicRegistrationResponseSchema,
  ticketResponseSchema,
  type PublicEventResponse,
  type PublicRegistrationRequest,
  type PublicRegistrationResponse,
  type TicketResponse,
} from '@event-registration/contracts';
import type { ZodType } from 'zod';

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

export const publicApi = new PublicApiClient();
