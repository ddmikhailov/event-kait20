import type {
  AttendanceSyncResponse,
  OfflineBundleResponse,
  ResolveQrResponse,
} from '@event-registration/contracts';
import {
  attendanceSyncRequestSchema,
  resolveQrRequestSchema,
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
  UseGuards,
} from '@nestjs/common';

import { RequireRoles, RolesGuard, SessionGuard } from '../auth/auth.guards.js';
import type { StaffRequest } from '../auth/auth.types.js';
import { parseContract } from '../common/api-error.js';
import { AttendanceService } from './attendance.service.js';

@Controller('scanner/events/:eventId')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN', 'SCANNER')
export class AttendanceController {
  public constructor(
    @Inject(AttendanceService)
    private readonly attendance: AttendanceService,
  ) {}

  @Get('offline-bundle')
  public offlineBundle(
    @Param('eventId') eventId: string,
    @Req() request: StaffRequest,
  ): Promise<OfflineBundleResponse> {
    return this.attendance.offlineBundle(
      parseContract(uuidSchema, eventId),
      request.auth.user,
    );
  }

  @Post('resolve-qr')
  public resolveQr(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<ResolveQrResponse> {
    const values = parseContract(resolveQrRequestSchema, body);
    return this.attendance.resolveQr(
      parseContract(uuidSchema, eventId),
      values.qrPayload,
      request.auth.user,
    );
  }

  @Post('attendance/sync')
  public sync(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<AttendanceSyncResponse> {
    return this.attendance.sync(
      parseContract(uuidSchema, eventId),
      parseContract(attendanceSyncRequestSchema, body),
      request.auth.user,
    );
  }
}
