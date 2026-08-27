import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requiredBaseUrl,
  runMvpSmoke,
  verifySecurityHeaders,
} from './mvp-smoke.mjs';

const productionHeaders = (extra = {}) => ({
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  ...extra,
});

test('requires HTTPS origin-only deployment URLs', () => {
  assert.equal(
    requiredBaseUrl('URL', { URL: 'https://events.kait20.ru' }).origin,
    'https://events.kait20.ru',
  );
  assert.equal(
    requiredBaseUrl('URL', { URL: 'http://localhost:3000' }).origin,
    'http://localhost:3000',
  );
  for (const value of [
    'http://events.kait20.ru',
    'https://events.kait20.ru/path',
    'https://user:password@events.kait20.ru',
    'https://events.kait20.ru?debug=true',
  ]) {
    assert.throws(() => requiredBaseUrl('URL', { URL: value }));
  }
});

test('accepts the required production API security headers', () => {
  const response = new Response(null, { headers: productionHeaders() });
  assert.doesNotThrow(() => verifySecurityHeaders(response));
});

test('validates Web and Scanner CSP and camera policy', () => {
  const csp =
    "default-src 'self'; connect-src 'self'; " +
    "object-src 'none'; frame-ancestors 'none'";
  const web = new Response(null, {
    headers: productionHeaders({ 'content-security-policy': csp }),
  });
  assert.doesNotThrow(() =>
    verifySecurityHeaders(web, { contentSecurityPolicy: true }),
  );
  const scanner = new Response(null, {
    headers: productionHeaders({
      'content-security-policy': csp,
      'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
    }),
  });
  assert.doesNotThrow(() =>
    verifySecurityHeaders(scanner, {
      contentSecurityPolicy: true,
      scanner: true,
    }),
  );
});

test('rejects missing headers and an incomplete CSP', () => {
  assert.throws(
    () => verifySecurityHeaders(new Response()),
    /strict-transport-security/,
  );
  const response = new Response(null, {
    headers: productionHeaders({
      'content-security-policy': "default-src 'self'",
    }),
  });
  assert.throws(
    () =>
      verifySecurityHeaders(response, {
        contentSecurityPolicy: true,
      }),
    /object-src/,
  );
});

test('runs the complete non-mutating production security smoke', async () => {
  const webOrigin = 'https://events.kait20.ru';
  const scannerOrigin = 'https://scanner.kait20.ru';
  const csp =
    "default-src 'self'; connect-src 'self'; " +
    "object-src 'none'; frame-ancestors 'none'";
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    const isApi = requestUrl.pathname.startsWith('/api/');
    if (isApi) {
      const headers = productionHeaders();
      const origin = options.headers.origin;
      if (origin === webOrigin) {
        headers['access-control-allow-origin'] = webOrigin;
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
    const scanner = requestUrl.origin === scannerOrigin;
    const headers = productionHeaders({
      'content-security-policy': csp,
      'permissions-policy': scanner
        ? 'camera=(self), microphone=(), geolocation=()'
        : 'camera=(), microphone=(), geolocation=()',
    });
    if (requestUrl.pathname === '/manifest.webmanifest') {
      return json({ name: 'КАИТ №20 — Scanner', display: 'standalone' });
    }
    const title = scanner
      ? 'Scanner — КАИТ №20'
      : 'Регистрация на мероприятия — КАИТ №20';
    return new Response(
      `<html lang="ru"><title>${title}</title><div id="root"></div></html>`,
      { status: 200, headers },
    );
  };

  const result = await runMvpSmoke({
    environment: {
      SMOKE_WEB_BASE_URL: webOrigin,
      SMOKE_SCANNER_BASE_URL: scannerOrigin,
    },
    fetchImpl,
  });
  assert.equal(result.checks, 13);
  assert.equal(result.api, `${webOrigin}/api`);
});
