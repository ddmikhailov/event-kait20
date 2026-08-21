import { healthResponseSchema } from '@event-registration/contracts';
import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns the shared health contract', () => {
    expect(
      healthResponseSchema.parse(new HealthController().getHealth()),
    ).toEqual({ service: 'api', status: 'ok' });
  });
});
