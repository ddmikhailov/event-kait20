import type {
  PublicEventResponse,
  PublicRegistrationResponse,
} from '@event-registration/contracts';
import { publicRegistrationRequestSchema } from '@event-registration/contracts';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { parseContract } from '../common/api-error.js';
import { RateLimiterService } from '../common/rate-limiter.service.js';
import { RegistrationsService } from './registrations.service.js';

@Controller('public/events')
export class RegistrationsController {
  public constructor(
    @Inject(RegistrationsService)
    private readonly registrations: RegistrationsService,
    @Inject(RateLimiterService)
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get(':slug')
  public getEvent(@Param('slug') slug: string): Promise<PublicEventResponse> {
    return this.registrations.publicEvent(slug);
  }

  @Post(':slug/register')
  public async register(
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicRegistrationResponse> {
    this.rateLimiter.consume(
      'public-registration',
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    const result = await this.registrations.register(
      slug,
      parseContract(publicRegistrationRequestSchema, body),
    );
    response.status(result.status === 'REGISTERED' ? 201 : 200);
    return result;
  }
}
