import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import {
  AdminPeopleController,
  AdminRegistrationsController,
  ScannerRegistrationsController,
} from './participants.controller.js';
import { ParticipantsService } from './participants.service.js';

@Module({
  imports: [AuthModule, RegistrationsModule],
  controllers: [
    AdminPeopleController,
    AdminRegistrationsController,
    ScannerRegistrationsController,
  ],
  providers: [ParticipantsService],
})
export class ParticipantsModule {}
