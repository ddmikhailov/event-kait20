import type { HealthResponse } from '@event-registration/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';

import { ApiError } from './common/api-error.js';
import { DATABASE_POOL } from './common/tokens.js';

@Controller('health')
export class HealthController {
  public constructor(@Inject(DATABASE_POOL) private readonly database: Pool) {}

  @Get()
  public getHealth(): HealthResponse {
    return { service: 'api', status: 'ok' };
  }

  @Get('live')
  public getLiveness(): HealthResponse {
    return this.getHealth();
  }

  @Get('ready')
  public async getReadiness(): Promise<HealthResponse> {
    try {
      await this.database.query('SELECT 1');
      return this.getHealth();
    } catch {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service is not ready');
    }
  }
}
