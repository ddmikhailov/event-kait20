import type {
  AcceptedResponse,
  SessionResponse,
} from '@event-registration/contracts';
import {
  acceptedResponseSchema,
  invitationAcceptRequestSchema,
  loginRequestSchema,
  passwordForgotRequestSchema,
  passwordResetRequestSchema,
} from '@event-registration/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { parseContract } from '../common/api-error.js';
import type { ApiConfig } from '../common/config.module.js';
import { RateLimiterService } from '../common/rate-limiter.service.js';
import { APP_CONFIG, STAFF_SESSION_COOKIE } from '../common/tokens.js';
import { SessionGuard, readCookie } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import type { StaffRequest } from './auth.types.js';

@Controller('auth')
export class AuthController {
  public constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimiterService)
    private readonly rateLimiter: RateLimiterService,
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  public async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    this.limit('login', request);
    const result = await this.auth.login(
      parseContract(loginRequestSchema, body),
      readCookie(request, STAFF_SESSION_COOKIE),
    );
    response.cookie(
      STAFF_SESSION_COOKIE,
      result.rawToken,
      this.cookieOptions(result.response.expiresAt),
    );
    return result.response;
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  public async logout(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AcceptedResponse> {
    await this.auth.logout(request.auth.rawSessionToken);
    response.clearCookie(
      STAFF_SESSION_COOKIE,
      this.cookieOptions(new Date(0).toISOString()),
    );
    return acceptedResponseSchema.parse({ status: 'accepted' });
  }

  @Get('session')
  @UseGuards(SessionGuard)
  public session(@Req() request: StaffRequest): SessionResponse {
    return {
      authenticated: true,
      csrfToken: request.auth.csrfToken,
      expiresAt: request.auth.expiresAt.toISOString(),
      user: request.auth.user,
    };
  }

  @Post('password/forgot')
  @HttpCode(202)
  public async forgot(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AcceptedResponse> {
    this.limit('password-forgot', request);
    await this.auth.forgotPassword(
      parseContract(passwordForgotRequestSchema, body),
    );
    return { status: 'accepted' };
  }

  @Post('password/reset')
  @HttpCode(200)
  public async reset(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AcceptedResponse> {
    this.limit('password-reset', request);
    await this.auth.resetPassword(
      parseContract(passwordResetRequestSchema, body),
    );
    return { status: 'accepted' };
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  public async acceptInvitation(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AcceptedResponse> {
    this.limit('invitation-accept', request);
    const values = parseContract(invitationAcceptRequestSchema, body);
    await this.auth.acceptInvitation(token, values.password);
    return { status: 'accepted' };
  }

  private limit(scope: string, request: Request): void {
    this.rateLimiter.consume(
      scope,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
  }

  private cookieOptions(expiresAt: string) {
    return {
      expires: new Date(expiresAt),
      httpOnly: true,
      path: '/',
      sameSite: 'lax' as const,
      secure: this.config.NODE_ENV === 'production',
    };
  }
}
