import { Inject, Injectable } from '@nestjs/common';
import {
  registrationQrPayload,
  registrationTicketUrl,
  verifyRegistrationSignature,
} from '@event-registration/utils';

import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG } from '../common/tokens.js';

@Injectable()
export class RegistrationReferenceService {
  public constructor(@Inject(APP_CONFIG) private readonly config: ApiConfig) {}

  public qrPayload(publicId: string): string {
    return registrationQrPayload(publicId, this.config.QR_SIGNING_SECRET);
  }

  public ticketUrl(publicId: string): string {
    return registrationTicketUrl(
      publicId,
      this.config.QR_SIGNING_SECRET,
      this.config.PUBLIC_WEB_BASE_URL,
    );
  }

  public verify(publicId: string, signature: string): boolean {
    return verifyRegistrationSignature(
      publicId,
      signature,
      this.config.QR_SIGNING_SECRET,
    );
  }
}
