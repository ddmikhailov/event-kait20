import { healthResponseSchema } from '@event-registration/contracts';
import type { Pool } from '@event-registration/database';
import { describe, expect, it } from 'vitest';

import { ApiError } from './common/api-error.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns the shared health contract', () => {
    const database = { query: async () => ({}) } as unknown as Pool;

    expect(
      healthResponseSchema.parse(new HealthController(database).getHealth()),
    ).toEqual({ service: 'api', status: 'ok' });
  });

  it('uses a database-independent liveness check', () => {
    const database = {
      query: async () => {
        throw new Error('must not run');
      },
    } as unknown as Pool;

    expect(new HealthController(database).getLiveness()).toEqual({
      service: 'api',
      status: 'ok',
    });
  });

  it('reports readiness only when MySQL responds', async () => {
    const database = { query: async () => ({}) } as unknown as Pool;

    await expect(
      new HealthController(database).getReadiness(),
    ).resolves.toEqual({ service: 'api', status: 'ok' });
  });

  it('returns a stable unavailable error when MySQL is down', async () => {
    const database = {
      query: async () => {
        throw new Error('database unavailable');
      },
    } as unknown as Pool;

    await expect(new HealthController(database).getReadiness()).rejects.toEqual(
      new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service is not ready'),
    );
  });
});
