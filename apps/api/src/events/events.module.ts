import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import {
  EventsController,
  ScannerEventsController,
} from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EventsController, ScannerEventsController],
  providers: [EventsService],
})
export class EventsModule {}
