import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const apache = await readFile(
  new URL(
    '../release/sysadmin-source/apache/event-registration-internal-http.conf.example',
    import.meta.url,
  ),
  'utf8',
);
const environment = await readFile(
  new URL('../release/sysadmin-source/backend.env.example', import.meta.url),
  'utf8',
);
const readme = await readFile(
  new URL('../release/sysadmin-source/README.txt', import.meta.url),
  'utf8',
);
const compiledApache = await readFile(
  new URL(
    '../release/sysadmin/apache/event-registration-internal-http.conf.example',
    import.meta.url,
  ),
  'utf8',
);
const compiledReadme = await readFile(
  new URL('../release/sysadmin/README.txt', import.meta.url),
  'utf8',
);

test('source-backend Apache is internal HTTP behind external HTTPS', () => {
  assert.equal((apache.match(/<VirtualHost \*:80>/g) ?? []).length, 2);
  assert.doesNotMatch(apache, /<VirtualHost [^>]*:443>/);
  assert.match(apache, /ProxyPreserveHost On/);
  assert.equal(
    (apache.match(/RequestHeader set X-Forwarded-Proto "https"/g) ?? []).length,
    2,
  );
  assert.match(apache, /MUST deny direct client access/);
  assert.equal(
    (apache.match(/Referrer-Policy "no-referrer"/g) ?? []).length,
    2,
  );
});

test('source-backend production configuration keeps public HTTPS boundaries', () => {
  assert.match(environment, /^NODE_ENV=production$/m);
  assert.match(environment, /^API_HOST=127\.0\.0\.1$/m);
  assert.match(environment, /^CORS_ORIGINS=https:\/\//m);
  assert.match(environment, /^AUTH_LINK_BASE_URL=https:\/\//m);
  assert.match(environment, /^PUBLIC_WEB_BASE_URL=https:\/\//m);
  assert.doesNotMatch(environment, /strict-ssl=false/i);
});

test('source-backend handoff documents direct launch and proxy trust boundary', () => {
  assert.match(readme, /pip install --no-deps \.\/backend/);
  assert.match(readme, /EVENT_REGISTRATION_ENV_FILE=/);
  assert.match(
    readme,
    /Нельзя запускать `python backend\/src\/event_api\/main\.py`/,
  );
  assert.match(readme, /Firewall\/ACL/);
  assert.match(readme, /сохранять исходные Host и Origin/);
  assert.match(readme, /нет MySQL binaries, Docker/);
});

test('compiled handoff uses the same current proxy topology', () => {
  assert.equal((compiledApache.match(/<VirtualHost \*:80>/g) ?? []).length, 2);
  assert.doesNotMatch(compiledApache, /<VirtualHost [^>]*:443>/);
  assert.match(compiledApache, /MUST deny direct client access/);
  assert.equal(
    (compiledApache.match(/Referrer-Policy "no-referrer"/g) ?? []).length,
    2,
  );
  assert.match(compiledReadme, /backend\/\*\.whl/);
  assert.match(compiledReadme, /EVENT_REGISTRATION_ENV_FILE=/);
  assert.match(compiledReadme, /same-origin `\/api`/);
  assert.match(compiledReadme, /внешний reverse proxy HTTPS :443/);
});
