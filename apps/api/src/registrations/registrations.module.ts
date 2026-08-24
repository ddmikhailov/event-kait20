import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RegistrationReferenceService } from './registration-reference.service.js';
import { RegistrationsController } from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationsController, TicketsController],
  providers: [
    RegistrationReferenceService,
    RegistrationsService,
    TicketsService,
  ],
})
export class RegistrationsModule {}
