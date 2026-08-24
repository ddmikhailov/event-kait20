import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ExcelController } from './excel.controller.js';
import { ExcelService } from './excel.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ExcelController],
  providers: [ExcelService],
})
export class ExcelModule {}
