import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG } from '../common/tokens.js';

@Injectable()
export class RegistrationReferenceService {
  public constructor(@Inject(APP_CONFIG) private readonly config: ApiConfig) {}

  public qrPayload(publicId: string): string {
    return `${publicId}.${this.signature(publicId)}`;
  }

  public ticketUrl(publicId: string): string {
    const signature = this.signature(publicId);
    return new URL(
      `/tickets/${encodeURIComponent(publicId)}/${encodeURIComponent(signature)}`,
      this.config.PUBLIC_WEB_BASE_URL,
    ).toString();
  }

  private signature(publicId: string): string {
    return createHmac('sha256', this.config.QR_SIGNING_SECRET)
      .update(`registration:${publicId}`)
      .digest('base64url');
  }
}
