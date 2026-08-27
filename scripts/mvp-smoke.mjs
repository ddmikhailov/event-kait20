import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export const requiredBaseUrl = (name, environment = process.env) => {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);

  const url = new URL(value);
  if (url.protocol !== 'https:' && !localHosts.has(url.hostname)) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query or fragment`);
  }
  if (url.pathname !== '/') {
    throw new Error(`${name} must be an origin without a path`);
  }
  return url;
};

const includesHeaderValue = (response, name, expected) => {
  const value = response.headers.get(name) ?? '';
  if (!value.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`${name} is missing ${expected}`);
  }
};

export const verifySecurityHeaders = (
  response,
  { contentSecurityPolicy = false, scanner = false } = {},
) => {
  includesHeaderValue(
    response,
    'strict-transport-security',
    'max-age=31536000',
  );
  includesHeaderValue(response, 'x-content-type-options', 'nosniff');
  includesHeaderValue(response, 'x-frame-options', 'deny');
  includesHeaderValue(response, 'referrer-policy', 'no-referrer');
  includesHeaderValue(
    response,
    'permissions-policy',
    scanner ? 'camera=(self)' : 'camera=()',
  );
  if (!contentSecurityPolicy) return;

  const policy = response.headers.get('content-security-policy') ?? '';
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "connect-src 'self'",
  ]) {
    if (!policy.includes(directive)) {
      throw new Error(`Content-Security-Policy is missing ${directive}`);
    }
  }
};

const fetchResponse = async (
  fetchImpl,
  baseUrl,
  path,
  { accept = 'application/json', ...options } = {},
) => {
  const { headers = {}, ...requestOptions } = options;
  const relativePath = path.startsWith('/') ? path.slice(1) : path;
  return fetchImpl(new URL(relativePath, baseUrl), {
    ...requestOptions,
    headers: { accept, ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
};

const expectStatus = (response, path, expected) => {
  if (response.status !== expected) {
    throw new Error(
      `${path} returned HTTP ${response.status}, expected ${expected}`,
    );
  }
};

export const runMvpSmoke = async ({
  environment = process.env,
  fetchImpl = fetch,
} = {}) => {
  const web = requiredBaseUrl('SMOKE_WEB_BASE_URL', environment);
  const scanner = requiredBaseUrl('SMOKE_SCANNER_BASE_URL', environment);
  if (web.origin === scanner.origin) {
    throw new Error('Web and Scanner must use distinct origins');
  }
  const webApi = new URL('/api/', web);
  const scannerApi = new URL('/api/', scanner);

  for (const [label, api] of [
    ['Web', webApi],
    ['Scanner', scannerApi],
  ]) {
    for (const [path, expectedBody] of [
      ['/health/live', 'ok'],
      ['/health/ready', 'ready'],
    ]) {
      const response = await fetchResponse(fetchImpl, api, path);
      expectStatus(response, `${label} /api${path}`, 200);
      verifySecurityHeaders(response);
      const body = await response.json();
      if (body?.status !== expectedBody) {
        throw new Error(`${label} /api${path} returned an unexpected response`);
      }
    }
  }

  for (const path of ['/docs', '/redoc', '/openapi.json']) {
    const response = await fetchResponse(fetchImpl, webApi, path);
    expectStatus(response, `/api${path}`, 404);
  }

  const trustedCors = await fetchResponse(fetchImpl, webApi, '/health/live', {
    headers: { origin: web.origin },
  });
  expectStatus(trustedCors, '/health/live with trusted Origin', 200);
  if (trustedCors.headers.get('access-control-allow-origin') !== web.origin) {
    throw new Error('Trusted Web Origin is missing from CORS response');
  }
  includesHeaderValue(trustedCors, 'access-control-allow-credentials', 'true');

  const untrustedCors = await fetchResponse(fetchImpl, webApi, '/health/live', {
    headers: { origin: 'https://untrusted.invalid' },
  });
  expectStatus(untrustedCors, '/health/live with untrusted Origin', 200);
  if (untrustedCors.headers.has('access-control-allow-origin')) {
    throw new Error('Untrusted Origin received a CORS allow header');
  }

  const rejectedMutation = await fetchResponse(
    fetchImpl,
    webApi,
    '/auth/login',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://untrusted.invalid',
      },
      body: '{}',
    },
  );
  expectStatus(rejectedMutation, '/auth/login with untrusted Origin', 403);
  const rejection = await rejectedMutation.json();
  if (rejection?.error?.code !== 'ORIGIN_REJECTED') {
    throw new Error('Untrusted mutation did not return ORIGIN_REJECTED');
  }
  if (rejectedMutation.headers.has('access-control-allow-origin')) {
    throw new Error('Rejected mutation exposed a CORS allow header');
  }

  const webResponse = await fetchResponse(fetchImpl, web, '/', {
    accept: 'text/html',
  });
  expectStatus(webResponse, 'Web /', 200);
  verifySecurityHeaders(webResponse, {
    contentSecurityPolicy: true,
  });
  const webShell = await webResponse.text();
  if (
    !webShell.includes('<html lang="ru">') ||
    !webShell.includes('Регистрация на мероприятия — КАИТ №20') ||
    !webShell.includes('<div id="root"></div>')
  ) {
    throw new Error('Web application shell is incomplete');
  }

  const scannerResponse = await fetchResponse(fetchImpl, scanner, '/', {
    accept: 'text/html',
  });
  expectStatus(scannerResponse, 'Scanner /', 200);
  verifySecurityHeaders(scannerResponse, {
    contentSecurityPolicy: true,
    scanner: true,
  });
  const scannerShell = await scannerResponse.text();
  if (
    !scannerShell.includes('<html lang="ru">') ||
    !scannerShell.includes('Scanner — КАИТ №20') ||
    !scannerShell.includes('<div id="root"></div>')
  ) {
    throw new Error('Scanner application shell is incomplete');
  }

  const manifestResponse = await fetchResponse(
    fetchImpl,
    scanner,
    '/manifest.webmanifest',
    { accept: 'application/manifest+json' },
  );
  expectStatus(manifestResponse, '/manifest.webmanifest', 200);
  const manifest = await manifestResponse.json();
  if (
    manifest?.name !== 'КАИТ №20 — Scanner' ||
    manifest?.display !== 'standalone'
  ) {
    throw new Error('Scanner PWA manifest is incomplete');
  }

  return {
    api: webApi.href.replace(/\/$/, ''),
    web: web.origin,
    scanner: scanner.origin,
    checks: 13,
  };
};

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await runMvpSmoke();
    process.stdout.write(
      `MVP deployment security smoke passed (${result.checks} checks)\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
