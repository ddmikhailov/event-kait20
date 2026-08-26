const requiredBaseUrl = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);

  const url = new URL(value);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (url.protocol !== 'https:' && !localHosts.has(url.hostname)) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  return url;
};

const api = requiredBaseUrl('SMOKE_API_BASE_URL');
const web = requiredBaseUrl('SMOKE_WEB_BASE_URL');
const scanner = requiredBaseUrl('SMOKE_SCANNER_BASE_URL');

const fetchChecked = async (baseUrl, path, accept) => {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { accept },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response;
};

const readiness = await (
  await fetchChecked(api, '/health/ready', 'application/json')
).json();
if (readiness?.status !== 'ready') {
  throw new Error('API readiness returned an unexpected response');
}

const webShell = await (await fetchChecked(web, '/', 'text/html')).text();
if (
  !webShell.includes('<html lang="ru">') ||
  !webShell.includes('Регистрация на мероприятия — КАИТ №20') ||
  !webShell.includes('<div id="root"></div>')
) {
  throw new Error('Web application shell is incomplete');
}

const scannerShell = await (
  await fetchChecked(scanner, '/', 'text/html')
).text();
if (
  !scannerShell.includes('<html lang="ru">') ||
  !scannerShell.includes('Scanner — КАИТ №20') ||
  !scannerShell.includes('<div id="root"></div>')
) {
  throw new Error('Scanner application shell is incomplete');
}

const manifest = await (
  await fetchChecked(
    scanner,
    '/manifest.webmanifest',
    'application/manifest+json',
  )
).json();
if (
  manifest?.name !== 'КАИТ №20 — Scanner' ||
  manifest?.display !== 'standalone'
) {
  throw new Error('Scanner PWA manifest is incomplete');
}

process.stdout.write('MVP deployment smoke checks passed\n');
