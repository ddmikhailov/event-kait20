import type {
  AcceptedResponse,
  PersonDetailResponse,
  PersonListResponse,
  OnsiteRegistrationResponse,
  RegistrationDetailResponse,
  RegistrationListResponse,
  ScannerRegistrationListResponse,
} from '@event-registration/contracts';
import {
  participantListQuerySchema,
  adminOnsiteRegistrationRequestSchema,
  registrationListQuerySchema,
  scannerOnsiteRegistrationRequestSchema,
  updatePersonRequestSchema,
  updateRegistrationRequestSchema,
  uuidSchema,
} from '@event-registration/contracts';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequireRoles, RolesGuard, SessionGuard } from '../auth/auth.guards.js';
import type { StaffRequest } from '../auth/auth.types.js';
import { parseContract } from '../common/api-error.js';
import { ParticipantsService } from './participants.service.js';
import { RegistrationsService } from '../registrations/registrations.service.js';

@Controller('admin/people')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN')
export class AdminPeopleController {
  public constructor(
    @Inject(ParticipantsService)
    private readonly participants: ParticipantsService,
  ) {}

  @Get()
  public list(@Query() query: unknown): Promise<PersonListResponse> {
    const values = parseContract(participantListQuerySchema, query);
    return this.participants.listPeople(
      values.query,
      values.page,
      values.pageSize,
    );
  }

  @Get(':personId')
  public get(
    @Param('personId') personId: string,
  ): Promise<PersonDetailResponse> {
    return this.participants.getPerson(parseContract(uuidSchema, personId));
  }

  @Patch(':personId')
  public update(
    @Param('personId') personId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<PersonDetailResponse> {
    return this.participants.updatePerson(
      parseContract(uuidSchema, personId),
      parseContract(updatePersonRequestSchema, body),
      request.auth.user.id,
    );
  }
}

@Controller('admin/events/:eventId/registrations')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN')
export class AdminRegistrationsController {
  public constructor(
    @Inject(ParticipantsService)
    private readonly participants: ParticipantsService,
    @Inject(RegistrationsService)
    private readonly registrations: RegistrationsService,
  ) {}

  @Post('onsite')
  public async onsite(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnsiteRegistrationResponse> {
    const result = await this.registrations.registerOnsite(
      parseContract(uuidSchema, eventId),
      parseContract(adminOnsiteRegistrationRequestSchema, body),
      { id: request.auth.user.id, role: request.auth.user.role },
    );
    response.status(result.status === 'REGISTERED' ? 201 : 200);
    return result;
  }

  @Get()
  public list(
    @Param('eventId') eventId: string,
    @Query() query: unknown,
  ): Promise<RegistrationListResponse> {
    const values = parseContract(registrationListQuerySchema, query);
    return this.participants.listRegistrations(
      parseContract(uuidSchema, eventId),
      values.query,
      values.status,
      values.page,
      values.pageSize,
    );
  }

  @Get(':registrationId')
  public get(
    @Param('eventId') eventId: string,
    @Param('registrationId') registrationId: string,
  ): Promise<RegistrationDetailResponse> {
    return this.participants.getRegistration(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, registrationId),
    );
  }

  @Patch(':registrationId')
  public update(
    @Param('eventId') eventId: string,
    @Param('registrationId') registrationId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<RegistrationDetailResponse> {
    return this.participants.updateRegistration(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, registrationId),
      parseContract(updateRegistrationRequestSchema, body),
      request.auth.user.id,
    );
  }

  @Post(':registrationId/annul')
  public async annul(
    @Param('eventId') eventId: string,
    @Param('registrationId') registrationId: string,
    @Req() request: StaffRequest,
  ): Promise<AcceptedResponse> {
    await this.participants.annul(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, registrationId),
      request.auth.user.id,
    );
    return { status: 'accepted' };
  }

  @Post(':registrationId/resend-ticket')
  public async resendTicket(
    @Param('eventId') eventId: string,
    @Param('registrationId') registrationId: string,
    @Req() request: StaffRequest,
  ): Promise<AcceptedResponse> {
    await this.participants.resendTicket(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, registrationId),
      request.auth.user.id,
    );
    return { status: 'accepted' };
  }
}

@Controller('scanner/events/:eventId/registrations')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN', 'SCANNER')
export class ScannerRegistrationsController {
  public constructor(
    @Inject(RegistrationsService)
    private readonly registrations: RegistrationsService,
    @Inject(ParticipantsService)
    private readonly participants: ParticipantsService,
  ) {}

  @Get('search')
  public search(
    @Param('eventId') eventId: string,
    @Query() query: unknown,
    @Req() request: StaffRequest,
  ): Promise<ScannerRegistrationListResponse> {
    const values = parseContract(participantListQuerySchema, query);
    return this.participants.scannerSearch(
      parseContract(uuidSchema, eventId),
      values.query,
      values.page,
      values.pageSize,
      { id: request.auth.user.id, role: request.auth.user.role },
    );
  }

  @Post('onsite')
  public async onsite(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OnsiteRegistrationResponse> {
    const result = await this.registrations.registerOnsite(
      parseContract(uuidSchema, eventId),
      parseContract(scannerOnsiteRegistrationRequestSchema, body),
      { id: request.auth.user.id, role: request.auth.user.role },
    );
    response.status(result.status === 'REGISTERED' ? 201 : 200);
    return result;
  }
}
