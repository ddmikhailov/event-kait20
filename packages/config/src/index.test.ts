import { describe, expect, it } from 'vitest';

import { parseApiEnvironment } from './index';

describe('parseApiEnvironment', () => {
  it('parses non-secret placeholder values without exposing them', () => {
    const result = parseApiEnvironment({
      DATABASE_URL: 'postgresql://user:password@localhost:5432/app',
      SESSION_SECRET: 's'.repeat(32),
      QR_SIGNING_SECRET: 'q'.repeat(32),
      CORS_ORIGINS: 'http://localhost:5173',
    });

    expect(result.API_PORT).toBe(3000);
    expect(result.NODE_ENV).toBe('development');
  });
});
