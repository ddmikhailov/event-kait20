import type { HealthResponse } from '@event-registration/contracts';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  public getHealth(): HealthResponse {
    return { service: 'api', status: 'ok' };
  }
}
