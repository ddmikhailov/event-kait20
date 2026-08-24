import type { TicketResponse } from '@event-registration/contracts';
import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RateLimiterService } from '../common/rate-limiter.service.js';
import { TicketsService } from './tickets.service.js';

@Controller('tickets')
export class TicketsController {
  public constructor(
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(RateLimiterService)
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Get(':publicId/:signature')
  public get(
    @Param('publicId') publicId: string,
    @Param('signature') signature: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TicketResponse> {
    this.rateLimiter.consume(
      'public-ticket',
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    return this.tickets.get(publicId, signature);
  }
}
