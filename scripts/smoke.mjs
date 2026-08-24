const baseUrl = process.env.SMOKE_BASE_URL;

if (!baseUrl) {
  throw new Error('SMOKE_BASE_URL is required');
}

const parsedBaseUrl = new URL(baseUrl);
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (
  parsedBaseUrl.protocol !== 'https:' &&
  !localHosts.has(parsedBaseUrl.hostname)
) {
  throw new Error('SMOKE_BASE_URL must use HTTPS outside localhost');
}

for (const path of ['/health/live', '/health/ready']) {
  const response = await fetch(new URL(path, parsedBaseUrl), {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.service !== 'api' || body?.status !== 'ok') {
    throw new Error(`${path} returned an unexpected response`);
  }
}

process.stdout.write('API smoke checks passed\n');
