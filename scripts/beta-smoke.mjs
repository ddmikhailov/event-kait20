import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requiredBaseUrl, verifySecurityHeaders } from './mvp-smoke.mjs';

const fetchResponse = async (
  fetchImpl,
  baseUrl,
  path,
  { accept = 'application/json', ...options } = {},
) => {
  const { headers = {}, ...requestOptions } = options;
  return fetchImpl(new URL(path, baseUrl), {
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

export const runBetaSmoke = async ({
  environment = process.env,
  fetchImpl = fetch,
} = {}) => {
  const baseUrl = requiredBaseUrl('SMOKE_BETA_BASE_URL', environment);

  for (const [path, expectedBody] of [
    ['/api/health/live', 'ok'],
    ['/api/health/ready', 'ready'],
  ]) {
    const response = await fetchResponse(fetchImpl, baseUrl, path);
    expectStatus(response, path, 200);
    verifySecurityHeaders(response);
    const body = await response.json();
    if (body?.status !== expectedBody) {
      throw new Error(`${path} returned an unexpected response`);
    }
  }

  for (const path of ['/api/docs', '/api/redoc', '/api/openapi.json']) {
    const response = await fetchResponse(fetchImpl, baseUrl, path);
    expectStatus(response, path, 404);
  }

  const trustedCors = await fetchResponse(
    fetchImpl,
    baseUrl,
    '/api/health/live',
    { headers: { origin: baseUrl.origin } },
  );
  expectStatus(trustedCors, '/api/health/live with trusted Origin', 200);
  if (
    trustedCors.headers.get('access-control-allow-origin') !== baseUrl.origin
  ) {
    throw new Error('Trusted beta Origin is missing from CORS response');
  }
  if (
    !trustedCors.headers
      .get('access-control-allow-credentials')
      ?.toLowerCase()
      .includes('true')
  ) {
    throw new Error('Trusted beta Origin does not allow credentials');
  }

  const untrustedCors = await fetchResponse(
    fetchImpl,
    baseUrl,
    '/api/health/live',
    { headers: { origin: 'https://untrusted.invalid' } },
  );
  expectStatus(untrustedCors, '/api/health/live with untrusted Origin', 200);
  if (untrustedCors.headers.has('access-control-allow-origin')) {
    throw new Error('Untrusted Origin received a CORS allow header');
  }

  const rejectedMutation = await fetchResponse(
    fetchImpl,
    baseUrl,
    '/api/auth/login',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://untrusted.invalid',
      },
      body: '{}',
    },
  );
  expectStatus(rejectedMutation, '/api/auth/login with untrusted Origin', 403);
  if ((await rejectedMutation.json())?.error?.code !== 'ORIGIN_REJECTED') {
    throw new Error('Untrusted mutation did not return ORIGIN_REJECTED');
  }

  const webResponse = await fetchResponse(fetchImpl, baseUrl, '/', {
    accept: 'text/html',
  });
  expectStatus(webResponse, '/', 200);
  verifySecurityHeaders(webResponse, { contentSecurityPolicy: true });
  const webShell = await webResponse.text();
  if (
    !webShell.includes('<html lang="ru">') ||
    !webShell.includes('Регистрация на мероприятия — КАИТ №20') ||
    !webShell.includes('<div id="root"></div>')
  ) {
    throw new Error('Web application shell is incomplete');
  }

  const scannerResponse = await fetchResponse(fetchImpl, baseUrl, '/scanner/', {
    accept: 'text/html',
  });
  expectStatus(scannerResponse, '/scanner/', 200);
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
    baseUrl,
    '/scanner/manifest.webmanifest',
    { accept: 'application/manifest+json' },
  );
  expectStatus(manifestResponse, '/scanner/manifest.webmanifest', 200);
  const manifest = await manifestResponse.json();
  if (
    manifest?.name !== 'КАИТ №20 — Scanner' ||
    manifest?.display !== 'standalone'
  ) {
    throw new Error('Scanner PWA manifest is incomplete');
  }

  return { baseUrl: baseUrl.origin, checks: 12 };
};

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await runBetaSmoke();
    process.stdout.write(
      `Beta deployment security smoke passed (${result.checks} checks)\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
