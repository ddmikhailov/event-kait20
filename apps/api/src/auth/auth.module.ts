import { Module } from '@nestjs/common';

import { RateLimiterService } from '../common/rate-limiter.service.js';
import { AuthController } from './auth.controller.js';
import { OriginCsrfGuard, RolesGuard, SessionGuard } from './auth.guards.js';
import { AuthLinkService } from './auth-link.service.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthLinkService,
    AuthService,
    OriginCsrfGuard,
    RateLimiterService,
    RolesGuard,
    SessionGuard,
  ],
  exports: [
    AuthLinkService,
    AuthService,
    OriginCsrfGuard,
    RolesGuard,
    SessionGuard,
  ],
})
export class AuthModule {}
