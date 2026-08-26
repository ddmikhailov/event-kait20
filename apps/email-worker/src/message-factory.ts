import {
  authLinkToken,
  registrationQrPayload,
  registrationTicketUrl,
} from '@event-registration/utils';
import type { Pool } from '@event-registration/database';
import QRCode from 'qrcode';

import type {
  ClaimedDelivery,
  EmailMessage,
  EmailMessageFactory,
} from './email-delivery.js';

type MessageFactoryConfig = {
  AUTH_LINK_BASE_URL: string;
  AUTH_LINK_SECRET: string;
  PUBLIC_WEB_BASE_URL: string;
  QR_SIGNING_SECRET: string;
};

type RegistrationContext = {
  end_at: Date;
  first_name: string;
  last_name: string;
  location: string;
  middle_name: string | null;
  public_id: string;
  recipient_email: string;
  start_at: Date;
  timezone: string;
  title: string;
};

type AuthLinkContext = {
  expires_at: Date;
  record_id: string;
  recipient_email: string;
};

export class DeliveryContextError extends Error {
  public override readonly name = 'DELIVERY_CONTEXT_INVALID';
}

export class DatabaseEmailMessageFactory implements EmailMessageFactory {
  public constructor(
    private readonly pool: Pool,
    private readonly config: MessageFactoryConfig,
  ) {}

  public async create(delivery: ClaimedDelivery): Promise<EmailMessage> {
    switch (delivery.type) {
      case 'REGISTRATION_TICKET':
        return this.registrationTicket(delivery.id);
      case 'STAFF_INVITATION':
        return this.authLink(delivery.id, 'invitation');
      case 'PASSWORD_RESET':
        return this.authLink(delivery.id, 'password-reset');
    }
  }

  private async registrationTicket(deliveryId: string): Promise<EmailMessage> {
    const result = await this.pool.query<RegistrationContext>(
      `SELECT ed.recipient_email, r.public_id, r.last_name, r.first_name,
              r.middle_name, e.title, e.start_at, e.end_at, e.timezone, e.location
       FROM email_deliveries ed
       JOIN registrations r ON r.id = ed.registration_id
       JOIN events e ON e.id = r.event_id
       WHERE ed.id = $1 AND ed.type = 'REGISTRATION_TICKET'
         AND r.status = 'ACTIVE'`,
      [deliveryId],
    );
    const row = result.rows[0];
    if (!row) throw new DeliveryContextError('Registration is not active');

    const qrPayload = registrationQrPayload(
      row.public_id,
      this.config.QR_SIGNING_SECRET,
    );
    const ticketUrl = registrationTicketUrl(
      row.public_id,
      this.config.QR_SIGNING_SECRET,
      this.config.PUBLIC_WEB_BASE_URL,
    );
    const qr = await QRCode.toBuffer(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      type: 'png',
      width: 320,
    });
    const participantName = [row.last_name, row.first_name, row.middle_name]
      .filter(Boolean)
      .join(' ');

    return {
      to: row.recipient_email,
      subject: safeSubject(`Билет: ${row.title}`),
      html: `<!doctype html><html lang="ru"><body>
<h1>${escapeHtml(row.title)}</h1>
<p>${escapeHtml(participantName)}</p>
<p>${escapeHtml(formatPeriod(row.start_at, row.end_at, row.timezone))}</p>
<p>${escapeHtml(row.location)}</p>
<p><img src="cid:registration-ticket-qr" alt="QR-код билета" width="320" height="320"></p>
<p><a href="${escapeHtml(ticketUrl)}">Открыть билет</a></p>
</body></html>`,
      attachments: [
        {
          content: qr,
          contentId: 'registration-ticket-qr',
          contentType: 'image/png',
          filename: 'ticket-qr.png',
        },
      ],
    };
  }

  private async authLink(
    deliveryId: string,
    purpose: 'invitation' | 'password-reset',
  ): Promise<EmailMessage> {
    const invitation = purpose === 'invitation';
    const result = await this.pool.query<AuthLinkContext>(
      invitation
        ? `SELECT ed.recipient_email, i.id AS record_id, i.expires_at
           FROM email_deliveries ed
           JOIN staff_invitations i ON i.id = ed.staff_invitation_id
           WHERE ed.id = $1 AND ed.type = 'STAFF_INVITATION'
             AND i.accepted_at IS NULL AND i.expires_at > now()`
        : `SELECT ed.recipient_email, p.id AS record_id, p.expires_at
           FROM email_deliveries ed
           JOIN password_reset_tokens p ON p.id = ed.password_reset_token_id
           WHERE ed.id = $1 AND ed.type = 'PASSWORD_RESET'
             AND p.used_at IS NULL AND p.expires_at > now()`,
      [deliveryId],
    );
    const row = result.rows[0];
    if (!row) throw new DeliveryContextError('Authentication link is invalid');

    const token = authLinkToken(
      purpose,
      row.record_id,
      row.expires_at,
      this.config.AUTH_LINK_SECRET,
    );
    const path = invitation
      ? `invitations/${encodeURIComponent(token)}/accept`
      : `password/reset?token=${encodeURIComponent(token)}`;
    const url = new URL(
      path,
      withTrailingSlash(this.config.AUTH_LINK_BASE_URL),
    );
    const action = invitation ? 'Принять приглашение' : 'Сбросить пароль';

    return {
      to: row.recipient_email,
      subject: invitation
        ? 'Приглашение в систему регистрации мероприятий'
        : 'Сброс пароля',
      html: `<!doctype html><html lang="ru"><body>
<p>${invitation ? 'Вас пригласили в систему регистрации мероприятий.' : 'Получен запрос на сброс пароля.'}</p>
<p><a href="${escapeHtml(url.toString())}">${action}</a></p>
<p>Ссылка действует до ${escapeHtml(row.expires_at.toISOString())}.</p>
</body></html>`,
      attachments: [],
    };
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const safeSubject = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').slice(0, 255);

const withTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value : `${value}/`;

const formatPeriod = (start: Date, end: Date, timezone: string): string => {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  });
  return `${formatter.format(start)} — ${formatter.format(end)} (${timezone})`;
};
