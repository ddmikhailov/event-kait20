import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './auth/auth.module.js';
import { OriginCsrfGuard } from './auth/auth.guards.js';
import { ApiConfigModule } from './common/config.module.js';
import { DatabaseModule } from './common/database.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health.controller.js';
import { RegistrationsModule } from './registrations/registrations.module.js';
import { StaffModule } from './staff/staff.module.js';

@Module({
  imports: [
    ApiConfigModule,
    DatabaseModule,
    AuthModule,
    StaffModule,
    EventsModule,
    RegistrationsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useExisting: OriginCsrfGuard }],
})
export class AppModule {}
