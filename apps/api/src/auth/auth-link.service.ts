import { createHash, timingSafeEqual } from 'node:crypto';

import { authLinkToken } from '@event-registration/utils';
import { Inject, Injectable } from '@nestjs/common';

import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG } from '../common/tokens.js';

export type AuthLinkPurpose = 'invitation' | 'password-reset';

@Injectable()
export class AuthLinkService {
  public constructor(@Inject(APP_CONFIG) private readonly config: ApiConfig) {}

  public createToken(
    purpose: AuthLinkPurpose,
    recordId: string,
    expiresAt: Date,
  ): string {
    return authLinkToken(
      purpose,
      recordId,
      expiresAt,
      this.config.AUTH_LINK_SECRET,
    );
  }

  public hashToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  public verifyToken(
    token: string,
    purpose: AuthLinkPurpose,
    recordId: string,
    expiresAt: Date,
    storedHash: string,
  ): boolean {
    const expectedToken = this.createToken(purpose, recordId, expiresAt);
    const suppliedHash = Buffer.from(this.hashToken(token));
    const expectedHash = Buffer.from(storedHash);

    return (
      token.length === expectedToken.length &&
      suppliedHash.length === expectedHash.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken)) &&
      timingSafeEqual(suppliedHash, expectedHash)
    );
  }

  public recordId(token: string): string | undefined {
    const [recordId, signature, extra] = token.split('.');

    return recordId && signature && !extra ? recordId : undefined;
  }
}
