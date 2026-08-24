import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
