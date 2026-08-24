import { describe, expect, it } from 'vitest';

import { parseApiEnvironment, parseWorkerEnvironment } from './index';

describe('parseApiEnvironment', () => {
  it('parses non-secret placeholder values without exposing them', () => {
    const result = parseApiEnvironment({
      DATABASE_URL: 'postgresql://user:password@localhost:5432/app',
      SESSION_SECRET: 's'.repeat(32),
      AUTH_LINK_SECRET: 'a'.repeat(32),
      AUTH_LINK_BASE_URL: 'http://localhost:5173/auth',
      QR_SIGNING_SECRET: 'q'.repeat(32),
      PUBLIC_WEB_BASE_URL: 'http://localhost:5173',
      CONSENT_URL: 'https://example.test/consent',
      CONSENT_VERSION: 'test-v1',
      CORS_ORIGINS: 'http://localhost:5173',
    });

    expect(result.API_PORT).toBe(3000);
    expect(result.DATABASE_CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(result.NODE_ENV).toBe('development');
    expect(result.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('rejects trusted origins with paths', () => {
    expect(() =>
      parseApiEnvironment({
        DATABASE_URL: 'postgresql://user:password@localhost:5432/app',
        SESSION_SECRET: 's'.repeat(32),
        AUTH_LINK_SECRET: 'a'.repeat(32),
        AUTH_LINK_BASE_URL: 'http://localhost:5173/auth',
        QR_SIGNING_SECRET: 'q'.repeat(32),
        PUBLIC_WEB_BASE_URL: 'http://localhost:5173',
        CONSENT_URL: 'https://example.test/consent',
        CONSENT_VERSION: 'test-v1',
        CORS_ORIGINS: 'http://localhost:5173/path',
      }),
    ).toThrow();
  });
});

describe('parseWorkerEnvironment', () => {
  it('applies bounded delivery defaults', () => {
    const result = parseWorkerEnvironment({
      DATABASE_URL: 'postgresql://user:password@localhost:5432/app',
      EMAIL_QUEUE_URL: 'https://queue.example.test/deliveries',
      EMAIL_PROVIDER_API_KEY: 'provider-placeholder',
      AUTH_LINK_SECRET: 'a'.repeat(32),
      AUTH_LINK_BASE_URL: 'http://localhost:5173/auth',
      QR_SIGNING_SECRET: 'q'.repeat(32),
      PUBLIC_WEB_BASE_URL: 'http://localhost:5173',
    });

    expect(result.EMAIL_MAX_ATTEMPTS).toBe(5);
    expect(result.EMAIL_POLL_INTERVAL_MS).toBe(1_000);
  });
});
