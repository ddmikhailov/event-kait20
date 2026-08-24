import type {
  AcceptedResponse,
  EventAccessListResponse,
  StaffInvitationResponse,
  StaffListResponse,
} from '@event-registration/contracts';
import {
  eventAccessRequestSchema,
  staffInvitationRequestSchema,
  uuidSchema,
} from '@event-registration/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RequireRoles, RolesGuard, SessionGuard } from '../auth/auth.guards.js';
import type { StaffRequest } from '../auth/auth.types.js';
import { parseContract } from '../common/api-error.js';
import { StaffService } from './staff.service.js';

@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN')
export class StaffController {
  public constructor(
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  @Get('staff')
  public list(): Promise<StaffListResponse> {
    return this.staff.list();
  }

  @Post('staff/invitations')
  public invite(
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<StaffInvitationResponse> {
    return this.staff.invite(
      parseContract(staffInvitationRequestSchema, body),
      request.auth.user.id,
    );
  }

  @Post('staff/:userId/deactivate')
  @HttpCode(200)
  public async deactivate(
    @Param('userId') userId: string,
    @Req() request: StaffRequest,
  ): Promise<AcceptedResponse> {
    await this.staff.deactivate(
      parseContract(uuidSchema, userId),
      request.auth.user.id,
    );
    return { status: 'accepted' };
  }

  @Get('events/:eventId/access')
  public listAccess(
    @Param('eventId') eventId: string,
  ): Promise<EventAccessListResponse> {
    return this.staff.listEventAccess(parseContract(uuidSchema, eventId));
  }

  @Post('events/:eventId/access')
  @HttpCode(200)
  public async assignAccess(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<AcceptedResponse> {
    const values = parseContract(eventAccessRequestSchema, body);
    await this.staff.assignEventAccess(
      parseContract(uuidSchema, eventId),
      values.userId,
      request.auth.user.id,
    );
    return { status: 'accepted' };
  }

  @Delete('events/:eventId/access/:userId')
  @HttpCode(200)
  public async removeAccess(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: StaffRequest,
  ): Promise<AcceptedResponse> {
    await this.staff.removeEventAccess(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, userId),
      request.auth.user.id,
    );
    return { status: 'accepted' };
  }
}
