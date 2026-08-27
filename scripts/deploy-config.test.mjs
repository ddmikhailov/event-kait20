import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DeploymentConfigError,
  parseEnvironment,
  validateDeploymentConfig,
} from './deploy-config.mjs';

const valid = () => ({
  NODE_ENV: 'production',
  API_HOST: '127.0.0.1',
  API_PORT: '3000',
  DATABASE_URL:
    'mysql://event_app:SafeDatabasePassword@mysql.internal:3306/event_registration',
  DATABASE_CONNECT_TIMEOUT_MS: '5000',
  MIGRATIONS_DIR: '/opt/event-registration/database/migrations',
  CORS_ORIGINS: 'https://events.kait20.ru,https://scanner.kait20.ru',
  SESSION_SECRET: 'session-secret-that-is-longer-than-32-bytes',
  SESSION_TTL_SECONDS: '28800',
  AUTH_LINK_SECRET: 'auth-link-secret-that-is-longer-than-32-bytes',
  AUTH_LINK_BASE_URL: 'https://events.kait20.ru/auth',
  INVITATION_TTL_SECONDS: '86400',
  PASSWORD_RESET_TTL_SECONDS: '3600',
  AUTH_RATE_LIMIT_MAX: '10',
  AUTH_RATE_LIMIT_WINDOW_SECONDS: '60',
  QR_SIGNING_SECRET: 'qr-signing-secret-that-is-longer-than-32-bytes',
  PUBLIC_WEB_BASE_URL: 'https://events.kait20.ru',
  CONSENT_URL: 'https://kait20.ru/privacy',
  CONSENT_VERSION: '2026-08-26',
  EMAIL_MAX_ATTEMPTS: '5',
  EMAIL_POLL_INTERVAL_MS: '1000',
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

test('accepts the organisation-managed production topology', () => {
  assert.deepEqual(validateDeploymentConfig(valid()), {
    webDomain: 'events.kait20.ru',
    scannerDomain: 'scanner.kait20.ru',
    apiPath: '/api',
    databaseHost: 'mysql.internal',
    migrationDirectory: '/opt/event-registration/database/migrations',
  });
});

test('requires distinct application and migration database accounts', () => {
  const migration = valid();
  migration.DATABASE_URL =
    'mysql://event_migrate:SafeDatabasePassword@mysql.internal:3306/event_registration';
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
        'mysql://root:SafeDatabasePassword@mysql.internal:3306/event_registration'),
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

test('check-files requires the migration directory to exist', () => {
  const config = valid();
  const directory = mkdtempSync(join(tmpdir(), 'event-deploy-config-'));
  config.MIGRATIONS_DIR = join(directory, 'migrations');
  assert.throws(
    () => validateDeploymentConfig(config, { checkFiles: true }),
    /does not exist/,
  );
  mkdirSync(config.MIGRATIONS_DIR);
  assert.doesNotThrow(() =>
    validateDeploymentConfig(config, { checkFiles: true }),
  );
});
