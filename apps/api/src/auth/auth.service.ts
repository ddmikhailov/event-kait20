import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import type {
  LoginRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
  SessionResponse,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { ApiError } from '../common/api-error.js';
import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG, DATABASE_POOL } from '../common/tokens.js';
import { AuthLinkService } from './auth-link.service.js';
import type { AuthenticatedStaff } from './auth.types.js';
import { hashPassword, verifyPassword } from './password.service.js';

type StaffRow = {
  active: boolean;
  email: string;
  id: string;
  password_hash: string;
  system_role: 'SUPER_ADMIN' | 'SCANNER';
};

type SessionRow = StaffRow & {
  expires_at: Date;
  session_id: string;
};

type AuthLinkRow = {
  accepted_at?: Date | null;
  email_normalized?: string;
  event_id?: string | null;
  expires_at: Date;
  id: string;
  role?: 'SUPER_ADMIN' | 'SCANNER';
  token_hash: string;
  used_at?: Date | null;
  user_id?: string;
};

export type IssuedSession = {
  rawToken: string;
  response: SessionResponse;
};

@Injectable()
export class AuthService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(AuthLinkService) private readonly authLinks: AuthLinkService,
  ) {}

  public sessionTokenHash(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  public csrfToken(token: string): string {
    return createHmac('sha256', this.config.SESSION_SECRET)
      .update(`csrf:${token}`)
      .digest('base64url');
  }

  public verifyCsrf(token: string, supplied: string): boolean {
    const expected = Buffer.from(this.csrfToken(token));
    const actual = Buffer.from(supplied);

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  public async login(
    request: LoginRequest,
    previousSessionToken?: string,
  ): Promise<IssuedSession> {
    const result = await this.pool.query<StaffRow>(
      `SELECT id, email, password_hash, system_role, active
       FROM staff_users WHERE email_normalized = $1`,
      [request.email],
    );
    const user = result.rows[0];

    if (!user) {
      await hashPassword(request.password);
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }

    const validPassword = await verifyPassword(
      user.password_hash,
      request.password,
    );

    if (!validPassword || !user.active) {
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      if (previousSessionToken) {
        await client.query(
          `UPDATE sessions SET revoked_at = now()
           WHERE token_hash = $1 AND revoked_at IS NULL`,
          [this.sessionTokenHash(previousSessionToken)],
        );
      }
      const issued = await this.issueSession(client, user);
      await client.query(
        'UPDATE staff_users SET last_login_at = now() WHERE id = $1',
        [user.id],
      );
      await client.query('COMMIT');
      return issued;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async authenticate(rawToken: string): Promise<StaffRequestAuth> {
    const result = await this.pool.query<SessionRow>(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email,
              u.password_hash, u.system_role, u.active
       FROM sessions s
       JOIN staff_users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL
         AND s.expires_at > now() AND u.active = true`,
      [this.sessionTokenHash(rawToken)],
    );
    const row = result.rows[0];

    if (!row) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    }

    await this.pool.query(
      'UPDATE sessions SET last_used_at = now() WHERE id = $1',
      [row.session_id],
    );

    return {
      csrfToken: this.csrfToken(rawToken),
      expiresAt: row.expires_at,
      rawSessionToken: rawToken,
      sessionId: row.session_id,
      user: { id: row.id, email: row.email, role: row.system_role },
    };
  }

  public async logout(rawToken: string): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [this.sessionTokenHash(rawToken)],
    );
  }

  public async forgotPassword(request: PasswordForgotRequest): Promise<void> {
    const userResult = await this.pool.query<StaffRow>(
      `SELECT id, email, password_hash, system_role, active
       FROM staff_users WHERE email_normalized = $1 AND active = true`,
      [request.email],
    );
    const user = userResult.rows[0];

    if (!user) return;

    const id = randomUUID();
    const deliveryId = randomUUID();
    const expiresAt = new Date(
      Date.now() + this.config.PASSWORD_RESET_TTL_SECONDS * 1000,
    );
    const token = this.authLinks.createToken('password-reset', id, expiresAt);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE password_reset_tokens SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id],
      );
      await client.query(
        `INSERT INTO password_reset_tokens
          (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [id, user.id, this.authLinks.hashToken(token), expiresAt],
      );
      await client.query(
        `INSERT INTO email_deliveries
          (id, idempotency_key, type, recipient_email, staff_user_id,
           password_reset_token_id, status, attempts, queued_at, created_at, updated_at)
         VALUES ($1, $2, 'PASSWORD_RESET', $3, $4, $5, 'QUEUED', 0, now(), now(), now())`,
        [deliveryId, `password-reset:${id}`, user.email, user.id, id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async resetPassword(request: PasswordResetRequest): Promise<void> {
    const recordId = this.authLinks.recordId(request.token);

    if (!recordId) throw this.invalidAuthLink();

    const passwordHash = await hashPassword(request.password);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<AuthLinkRow>(
        `SELECT id, user_id, token_hash, expires_at, used_at
         FROM password_reset_tokens WHERE id = $1 FOR UPDATE`,
        [recordId],
      );
      const record = result.rows[0];

      if (
        !record ||
        record.used_at ||
        record.expires_at <= new Date() ||
        !record.user_id ||
        !this.authLinks.verifyToken(
          request.token,
          'password-reset',
          record.id,
          record.expires_at,
          record.token_hash,
        )
      ) {
        throw this.invalidAuthLink();
      }

      await client.query(
        `UPDATE staff_users
         SET password_hash = $1, password_changed_at = now(), updated_at = now()
         WHERE id = $2 AND active = true`,
        [passwordHash, record.user_id],
      );
      await client.query(
        'UPDATE password_reset_tokens SET used_at = now() WHERE id = $1',
        [record.id],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [record.user_id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async acceptInvitation(
    token: string,
    password: string,
  ): Promise<void> {
    const recordId = this.authLinks.recordId(token);

    if (!recordId) throw this.invalidAuthLink();

    const passwordHash = await hashPassword(password);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<AuthLinkRow>(
        `SELECT id, email_normalized, event_id, role, token_hash, expires_at, accepted_at
         FROM staff_invitations WHERE id = $1 FOR UPDATE`,
        [recordId],
      );
      const record = result.rows[0];

      if (
        !record ||
        record.accepted_at ||
        record.expires_at <= new Date() ||
        !record.email_normalized ||
        record.role !== 'SCANNER' ||
        !this.authLinks.verifyToken(
          token,
          'invitation',
          record.id,
          record.expires_at,
          record.token_hash,
        )
      ) {
        throw this.invalidAuthLink();
      }

      const existing = await client.query(
        'SELECT id FROM staff_users WHERE email_normalized = $1',
        [record.email_normalized],
      );
      if (existing.rowCount)
        throw new ApiError(409, 'CONFLICT', 'Account already exists');

      const userId = randomUUID();
      await client.query(
        `INSERT INTO staff_users
          (id, email, email_normalized, password_hash, system_role, active,
           password_changed_at, created_at, updated_at)
         VALUES ($1, $2, $2, $3, 'SCANNER', true, now(), now(), now())`,
        [userId, record.email_normalized, passwordHash],
      );
      if (record.event_id) {
        await client.query(
          `INSERT INTO event_access
            (id, event_id, user_id, role, created_by, created_at)
           SELECT $1, i.event_id, $2, 'SCANNER', i.invited_by, now()
           FROM staff_invitations i WHERE i.id = $3`,
          [randomUUID(), userId, record.id],
        );
      }
      await client.query(
        'UPDATE staff_invitations SET accepted_at = now() WHERE id = $1',
        [record.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async issueSession(
    client: PoolClient,
    user: StaffRow,
  ): Promise<IssuedSession> {
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.SESSION_TTL_SECONDS * 1000,
    );

    await client.query(
      `INSERT INTO sessions
        (id, user_id, token_hash, expires_at, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [randomUUID(), user.id, this.sessionTokenHash(rawToken), expiresAt],
    );

    return {
      rawToken,
      response: {
        authenticated: true,
        csrfToken: this.csrfToken(rawToken),
        expiresAt: expiresAt.toISOString(),
        user: { id: user.id, email: user.email, role: user.system_role },
      },
    };
  }

  private invalidAuthLink(): ApiError {
    return new ApiError(
      400,
      'AUTH_LINK_INVALID',
      'Authentication link is invalid or expired',
    );
  }
}

export type StaffRequestAuth = {
  csrfToken: string;
  expiresAt: Date;
  rawSessionToken: string;
  sessionId: string;
  user: AuthenticatedStaff;
};
