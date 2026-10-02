import assert from 'node:assert/strict';
import test from 'node:test';

import { runBetaSmoke } from './beta-smoke.mjs';

const securityHeaders = (scanner = false, extra = {}) => ({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': scanner
    ? 'camera=(self), microphone=(), geolocation=()'
    : 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
  ...extra,
});

test('runs the non-mutating single-origin beta security smoke', async () => {
  const origin = 'https://eventki20.example';
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname.startsWith('/api/')) {
      const headers = securityHeaders();
      if (options.headers.origin === origin) {
        headers['access-control-allow-origin'] = origin;
        headers['access-control-allow-credentials'] = 'true';
      }
      if (options.method === 'POST') {
        return json({ error: { code: 'ORIGIN_REJECTED' } }, 403, headers);
      }
      if (requestUrl.pathname === '/api/health/live') {
        return json({ status: 'ok' }, 200, headers);
      }
      if (requestUrl.pathname === '/api/health/ready') {
        return json({ status: 'ready' }, 200, headers);
      }
      return json({ error: { code: 'NOT_FOUND' } }, 404, headers);
    }
    if (requestUrl.pathname === '/scanner/manifest.webmanifest') {
      return json({ name: 'КАИТ №20 — Scanner', display: 'standalone' });
    }
    const scanner = requestUrl.pathname === '/scanner/';
    const title = scanner
      ? 'Scanner — КАИТ №20'
      : 'Регистрация на мероприятия — КАИТ №20';
    return new Response(
      `<html lang="ru"><title>${title}</title><div id="root"></div></html>`,
      { status: 200, headers: securityHeaders(scanner) },
    );
  };

  const result = await runBetaSmoke({
    environment: { SMOKE_BETA_BASE_URL: origin },
    fetchImpl,
  });
  assert.deepEqual(result, { baseUrl: origin, checks: 12 });
});

test('keeps the beta target HTTPS and origin-only', async () => {
  await assert.rejects(
    runBetaSmoke({
      environment: { SMOKE_BETA_BASE_URL: 'https://eventki20.example/scanner' },
    }),
    /origin without a path/,
  );
});
