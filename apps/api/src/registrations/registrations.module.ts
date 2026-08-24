import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RegistrationReferenceService } from './registration-reference.service.js';
import { RegistrationsController } from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationsController],
  providers: [RegistrationReferenceService, RegistrationsService],
})
export class RegistrationsModule {}
