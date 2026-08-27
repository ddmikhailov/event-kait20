import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DeploymentConfigError,
  parseEnvironment,
  renderDeployment,
  validateDeploymentConfig,
} from './deploy-config.mjs';

const valid = () => ({
  NODE_ENV: 'production',
  DATABASE_URL:
    'mysql://event_app:SafeDatabasePassword@127.0.0.1:3306/event_registration',
  CORS_ORIGINS: 'https://events.kait20.ru,https://scanner.kait20.ru',
  SESSION_SECRET: 'session-secret-that-is-longer-than-32-bytes',
  AUTH_LINK_SECRET: 'auth-link-secret-that-is-longer-than-32-bytes',
  AUTH_LINK_BASE_URL: 'https://events.kait20.ru/auth',
  QR_SIGNING_SECRET: 'qr-signing-secret-that-is-longer-than-32-bytes',
  PUBLIC_WEB_BASE_URL: 'https://events.kait20.ru',
  PUBLIC_API_BASE_URL: 'https://api.kait20.ru',
  CONSENT_URL: 'https://kait20.ru/privacy',
  CONSENT_VERSION: '2026-08-26',
  TLS_CERTIFICATE: '/etc/letsencrypt/live/events.kait20.ru/fullchain.pem',
  TLS_CERTIFICATE_KEY: '/etc/letsencrypt/live/events.kait20.ru/privkey.pem',
  SMTP_HOST: 'smtp.kait20.ru',
  SMTP_PORT: '587',
  SMTP_USERNAME: 'event-mailer',
  SMTP_PASSWORD: 'smtp-test-password-not-a-real-secret',
  SMTP_FROM_EMAIL: 'events@kait20.ru',
  SMTP_FROM_NAME: 'Регистрация на мероприятие',
  SMTP_STARTTLS: 'true',
});

test('parses quoted values and rejects duplicate keys', () => {
  assert.deepEqual(parseEnvironment("A='one two'\nB=three\n"), {
    A: 'one two',
    B: 'three',
  });
  assert.throws(
    () => parseEnvironment('A=one\nA=two\n'),
    DeploymentConfigError,
  );
});

test('accepts a secure native production configuration', () => {
  assert.deepEqual(validateDeploymentConfig(valid()), {
    webDomain: 'events.kait20.ru',
    scannerDomain: 'scanner.kait20.ru',
    apiDomain: 'api.kait20.ru',
    publicApiBaseUrl: 'https://api.kait20.ru',
    certificate: '/etc/letsencrypt/live/events.kait20.ru/fullchain.pem',
    certificateKey: '/etc/letsencrypt/live/events.kait20.ru/privkey.pem',
  });
});

test('requires distinct application and migration database accounts', () => {
  const migration = valid();
  migration.DATABASE_URL =
    'mysql://event_migrate:SafeDatabasePassword@127.0.0.1:3306/event_registration';
  assert.doesNotThrow(() =>
    validateDeploymentConfig(migration, { migration: true }),
  );
  assert.throws(() => validateDeploymentConfig(migration), /event_app/);
  assert.throws(
    () => validateDeploymentConfig(valid(), { migration: true }),
    /event_migrate/,
  );
});

test('rejects placeholders, HTTP, wildcard CORS and a root DB account', () => {
  for (const mutate of [
    (config) => (config.SMTP_PASSWORD = 'replace-me'),
    (config) => (config.PUBLIC_WEB_BASE_URL = 'http://events.kait20.ru'),
    (config) => (config.CORS_ORIGINS = 'https://events.kait20.ru,*'),
    (config) =>
      (config.DATABASE_URL =
        'mysql://root:SafeDatabasePassword@127.0.0.1:3306/event_registration'),
  ]) {
    const config = valid();
    mutate(config);
    assert.throws(
      () => validateDeploymentConfig(config),
      DeploymentConfigError,
    );
  }
});

test('rejects reused or short cryptographic secrets', () => {
  const reused = valid();
  reused.AUTH_LINK_SECRET = reused.SESSION_SECRET;
  assert.throws(() => validateDeploymentConfig(reused), /must be distinct/);
  const short = valid();
  short.QR_SIGNING_SECRET = 'too-short';
  assert.throws(() => validateDeploymentConfig(short), /32 bytes/);
});

test('renders complete Nginx templates without persisting application secrets', () => {
  const output = mkdtempSync(join(tmpdir(), 'event-deploy-render-'));
  const config = valid();
  renderDeployment({ values: config, outputDirectory: output });
  const nginx = readFileSync(
    join(output, 'nginx', 'event-registration.conf'),
    'utf8',
  );
  const webSecurity = readFileSync(
    join(output, 'nginx', 'event-registration-web-security.conf'),
    'utf8',
  );
  const manifest = readFileSync(
    join(output, 'deployment-manifest.json'),
    'utf8',
  );
  const monitorService = readFileSync(
    join(output, 'systemd', 'event-registration-monitor.service'),
    'utf8',
  );
  const monitorTimer = readFileSync(
    join(output, 'systemd', 'event-registration-monitor.timer'),
    'utf8',
  );
  assert.match(nginx, /server_name events\.kait20\.ru/);
  assert.match(nginx, /server_name scanner\.kait20\.ru/);
  assert.match(nginx, /server_name api\.kait20\.ru/);
  assert.match(webSecurity, /connect-src 'self' https:\/\/api\.kait20\.ru/);
  assert.match(monitorService, /check-operations\.sh/);
  assert.match(monitorTimer, /OnUnitActiveSec=5m/);
  assert.doesNotMatch(`${nginx}${webSecurity}${manifest}`, /__[A-Z0-9_]+__/);
  assert.doesNotMatch(manifest, new RegExp(config.SESSION_SECRET));
});

test('check-files requires the TLS files to exist', () => {
  const config = valid();
  const directory = mkdtempSync(join(tmpdir(), 'event-deploy-cert-'));
  config.TLS_CERTIFICATE = join(directory, 'fullchain.pem');
  config.TLS_CERTIFICATE_KEY = join(directory, 'privkey.pem');
  assert.throws(
    () => validateDeploymentConfig(config, { checkFiles: true }),
    /does not exist/,
  );
  writeFileSync(config.TLS_CERTIFICATE, 'test certificate');
  writeFileSync(config.TLS_CERTIFICATE_KEY, 'test key');
  assert.doesNotThrow(() =>
    validateDeploymentConfig(config, { checkFiles: true }),
  );
});
