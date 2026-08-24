import type {
  EventListResponse,
  EventResponse,
  FormFieldListResponse,
  FormFieldResponse,
  ScannerEventListResponse,
} from '@event-registration/contracts';
import {
  createEventRequestSchema,
  createFormFieldRequestSchema,
  pageQuerySchema,
  updateEventRequestSchema,
  updateFormFieldRequestSchema,
  uuidSchema,
} from '@event-registration/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RequireRoles, RolesGuard, SessionGuard } from '../auth/auth.guards.js';
import type { StaffRequest } from '../auth/auth.types.js';
import { parseContract } from '../common/api-error.js';
import { EventsService } from './events.service.js';

@Controller('admin/events')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN')
export class EventsController {
  public constructor(
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  @Get()
  public list(@Query() query: unknown): Promise<EventListResponse> {
    const values = parseContract(pageQuerySchema, query);
    return this.events.list(values.page, values.pageSize);
  }

  @Post()
  public create(
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<EventResponse> {
    return this.events.create(
      parseContract(createEventRequestSchema, body),
      request.auth.user.id,
    );
  }

  @Get(':eventId')
  public get(@Param('eventId') eventId: string): Promise<EventResponse> {
    return this.events.get(parseContract(uuidSchema, eventId));
  }

  @Patch(':eventId')
  public update(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<EventResponse> {
    return this.events.update(
      parseContract(uuidSchema, eventId),
      parseContract(updateEventRequestSchema, body),
      request.auth.user.id,
    );
  }

  @Post(':eventId/archive')
  public archive(
    @Param('eventId') eventId: string,
    @Req() request: StaffRequest,
  ): Promise<EventResponse> {
    return this.events.archive(
      parseContract(uuidSchema, eventId),
      request.auth.user.id,
    );
  }

  @Get(':eventId/form-fields')
  public listFormFields(
    @Param('eventId') eventId: string,
  ): Promise<FormFieldListResponse> {
    return this.events.listFormFields(parseContract(uuidSchema, eventId));
  }

  @Post(':eventId/form-fields')
  public createFormField(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<FormFieldResponse> {
    return this.events.createFormField(
      parseContract(uuidSchema, eventId),
      parseContract(createFormFieldRequestSchema, body),
      request.auth.user.id,
    );
  }

  @Patch(':eventId/form-fields/:fieldId')
  public updateFormField(
    @Param('eventId') eventId: string,
    @Param('fieldId') fieldId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<FormFieldResponse> {
    return this.events.updateFormField(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, fieldId),
      parseContract(updateFormFieldRequestSchema, body),
      request.auth.user.id,
    );
  }

  @Delete(':eventId/form-fields/:fieldId')
  public deactivateFormField(
    @Param('eventId') eventId: string,
    @Param('fieldId') fieldId: string,
    @Req() request: StaffRequest,
  ): Promise<FormFieldResponse> {
    return this.events.deactivateFormField(
      parseContract(uuidSchema, eventId),
      parseContract(uuidSchema, fieldId),
      request.auth.user.id,
    );
  }
}

@Controller('scanner/events')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('SUPER_ADMIN', 'SCANNER')
export class ScannerEventsController {
  public constructor(
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  @Get()
  public list(@Req() request: StaffRequest): Promise<ScannerEventListResponse> {
    if (request.auth.user.role === 'SUPER_ADMIN') {
      return this.events.list(1, 100).then((result) => ({
        items: result.items
          .filter((event) => event.status !== 'ARCHIVED')
          .map((event) => ({
            id: event.id,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            timezone: event.timezone,
            location: event.location,
            status: event.status,
          })),
      }));
    }
    return this.events.scannerEvents(request.auth.user.id);
  }
}
