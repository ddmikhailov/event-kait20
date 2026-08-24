import type {
  EventStatisticsResponse,
  SendTicketsResponse,
} from '@event-registration/contracts';
import {
  sendTicketsRequestSchema,
  uuidSchema,
} from '@event-registration/contracts';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireRoles, RolesGuard, SessionGuard } from '../auth/auth.guards.js';
import type { StaffRequest } from '../auth/auth.types.js';
import { parseContract } from '../common/api-error.js';
import { ReportingService } from './reporting.service.js';

@Controller('admin/events/:eventId')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN')
export class ReportingController {
  public constructor(
    @Inject(ReportingService) private readonly reporting: ReportingService,
  ) {}

  @Get('statistics')
  public async statistics(
    @Param('eventId') eventId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<EventStatisticsResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.reporting.statistics(parseContract(uuidSchema, eventId));
  }

  @Post('send-tickets')
  public sendTickets(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<SendTicketsResponse> {
    return this.reporting.sendTickets(
      parseContract(uuidSchema, eventId),
      request.auth.user.id,
      parseContract(sendTicketsRequestSchema, body),
    );
  }
}
