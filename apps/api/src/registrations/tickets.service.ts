import type { TicketResponse } from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { ApiError } from '../common/api-error.js';
import { DATABASE_POOL } from '../common/tokens.js';
import { RegistrationReferenceService } from './registration-reference.service.js';

type TicketRow = {
  end_at: Date;
  first_name: string;
  last_name: string;
  location: string;
  middle_name: string | null;
  start_at: Date;
  timezone: string;
  title: string;
};

@Injectable()
export class TicketsService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(RegistrationReferenceService)
    private readonly references: RegistrationReferenceService,
  ) {}

  public async get(
    publicId: string,
    signature: string,
  ): Promise<TicketResponse> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        publicId,
      ) ||
      !this.references.verify(publicId, signature)
    ) {
      throw this.invalidTicket();
    }
    const result = await this.pool.query<TicketRow>(
      `SELECT e.title, e.start_at, e.end_at, e.timezone, e.location,
              r.last_name, r.first_name, r.middle_name
       FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE r.public_id = $1 AND r.status = 'ACTIVE'`,
      [publicId],
    );
    const row = result.rows[0];
    if (!row) throw this.invalidTicket();

    return {
      event: {
        title: row.title,
        startAt: row.start_at.toISOString(),
        endAt: row.end_at.toISOString(),
        timezone: row.timezone,
        location: row.location,
      },
      participantName: {
        lastName: row.last_name,
        firstName: row.first_name,
        middleName: row.middle_name,
      },
      qrPayload: this.references.qrPayload(publicId),
    };
  }

  private invalidTicket(): ApiError {
    return new ApiError(404, 'INVALID_QR', 'Ticket is not valid');
  }
}
