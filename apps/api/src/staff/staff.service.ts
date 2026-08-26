import { randomUUID } from 'node:crypto';

import type {
  EventAccessListResponse,
  StaffInvitationRequest,
  StaffInvitationResponse,
  StaffListResponse,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from '@event-registration/database';

import { AuthLinkService } from '../auth/auth-link.service.js';
import { ApiError } from '../common/api-error.js';
import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG, DATABASE_POOL } from '../common/tokens.js';

type InvitationRow = { expires_at: Date; id: string };

@Injectable()
export class StaffService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(AuthLinkService) private readonly authLinks: AuthLinkService,
  ) {}

  public async list(): Promise<StaffListResponse> {
    const result = await this.pool.query<{
      active: boolean;
      created_at: Date;
      email: string;
      id: string;
      system_role: 'SUPER_ADMIN' | 'SCANNER';
    }>(
      `SELECT id, email, system_role, active, created_at
       FROM staff_users ORDER BY created_at DESC`,
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.system_role,
        active: row.active,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  public async invite(
    request: StaffInvitationRequest,
    actorId: string,
  ): Promise<StaffInvitationResponse> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const existingUser = await client.query(
        'SELECT id FROM staff_users WHERE email_normalized = $1',
        [request.email],
      );
      if (existingUser.rowCount) {
        throw new ApiError(409, 'CONFLICT', 'Staff account already exists');
      }

      if (request.eventId)
        await this.assertAssignableEvent(client, request.eventId);

      const existingInvitation = await client.query<InvitationRow>(
        `SELECT id, expires_at FROM staff_invitations
         WHERE email_normalized = $1
           AND event_id <=> $2
           AND accepted_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [request.email, request.eventId ?? null],
      );
      const existing = existingInvitation.rows[0];
      if (existing) {
        await client.query('COMMIT');
        return {
          id: existing.id,
          expiresAt: existing.expires_at.toISOString(),
          status: 'queued',
        };
      }

      const id = randomUUID();
      const expiresAt = new Date(
        Date.now() + this.config.INVITATION_TTL_SECONDS * 1000,
      );
      const token = this.authLinks.createToken('invitation', id, expiresAt);

      await client.query(
        `INSERT INTO staff_invitations
          (id, email_normalized, token_hash, invited_by, event_id, role,
           expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'SCANNER', $6, now())`,
        [
          id,
          request.email,
          this.authLinks.hashToken(token),
          actorId,
          request.eventId ?? null,
          expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO email_deliveries
          (id, idempotency_key, type, recipient_email, event_id,
           staff_invitation_id, status, attempts, queued_at, created_at, updated_at)
         VALUES ($1, $2, 'STAFF_INVITATION', $3, $4, $5,
                 'QUEUED', 0, now(), now(), now())`,
        [
          randomUUID(),
          `staff-invitation:${id}`,
          request.email,
          request.eventId ?? null,
          id,
        ],
      );
      await this.audit(
        client,
        actorId,
        'STAFF_INVITATION_CREATED',
        'StaffInvitation',
        id,
        {
          eventAssigned: Boolean(request.eventId),
        },
      );
      await client.query('COMMIT');

      return { id, expiresAt: expiresAt.toISOString(), status: 'queued' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async deactivate(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ApiError(409, 'CONFLICT', 'Self-deactivation is not allowed');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        active: boolean;
        system_role: string;
      }>(
        'SELECT active, system_role FROM staff_users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const user = result.rows[0];
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'Staff user not found');
      if (!user.active) {
        await client.query('COMMIT');
        return;
      }
      if (user.system_role === 'SUPER_ADMIN') {
        const admins = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM staff_users
           WHERE system_role = 'SUPER_ADMIN' AND active = true`,
        );
        if (Number(admins.rows[0]?.count ?? 0) <= 1) {
          throw new ApiError(
            409,
            'CONFLICT',
            'The last active SUPER_ADMIN cannot be deactivated',
          );
        }
      }

      await client.query(
        'UPDATE staff_users SET active = false, updated_at = now() WHERE id = $1',
        [userId],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await this.audit(
        client,
        actorId,
        'STAFF_USER_DEACTIVATED',
        'StaffUser',
        userId,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async listEventAccess(
    eventId: string,
  ): Promise<EventAccessListResponse> {
    await this.assertEventExists(this.pool, eventId);
    const result = await this.pool.query<{
      created_at: Date;
      email: string;
      role: 'SCANNER';
      user_id: string;
    }>(
      `SELECT ea.user_id, u.email, ea.role, ea.created_at
       FROM event_access ea JOIN staff_users u ON u.id = ea.user_id
       WHERE ea.event_id = $1 ORDER BY ea.created_at`,
      [eventId],
    );

    return {
      items: result.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        role: 'SCANNER',
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  public async assignEventAccess(
    eventId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertAssignableEvent(client, eventId);
      const user = await client.query<{ active: boolean; system_role: string }>(
        'SELECT active, system_role FROM staff_users WHERE id = $1',
        [userId],
      );
      const row = user.rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Staff user not found');
      if (!row.active || row.system_role !== 'SCANNER') {
        throw new ApiError(
          409,
          'CONFLICT',
          'Event access requires an active SCANNER',
        );
      }

      await client.query(
        `INSERT IGNORE INTO event_access
          (id, event_id, user_id, role, created_by, created_at)
         VALUES ($1, $2, $3, 'SCANNER', $4, now())`,
        [randomUUID(), eventId, userId, actorId],
      );
      await this.audit(
        client,
        actorId,
        'EVENT_ACCESS_ASSIGNED',
        'Event',
        eventId,
        {
          userId,
        },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async removeEventAccess(
    eventId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertEventExists(client, eventId);
      await client.query(
        'DELETE FROM event_access WHERE event_id = $1 AND user_id = $2',
        [eventId, userId],
      );
      await this.audit(
        client,
        actorId,
        'EVENT_ACCESS_REMOVED',
        'Event',
        eventId,
        {
          userId,
        },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertAssignableEvent(
    client: PoolClient,
    eventId: string,
  ): Promise<void> {
    const result = await client.query<{ status: string }>(
      'SELECT status FROM events WHERE id = $1',
      [eventId],
    );
    if (!result.rows[0])
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    if (result.rows[0].status === 'ARCHIVED') {
      throw new ApiError(
        409,
        'INVALID_EVENT_STATE',
        'Archived Event cannot receive access assignments',
      );
    }
  }

  private async assertEventExists(
    client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    eventId: string,
  ): Promise<void> {
    const result = await client.query('SELECT id FROM events WHERE id = $1', [
      eventId,
    ]);
    if (!result.rows[0])
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
  }

  private async audit(
    client: PoolClient,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log
        (id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [randomUUID(), actorId, action, entityType, entityId, metadata ?? null],
    );
  }
}
