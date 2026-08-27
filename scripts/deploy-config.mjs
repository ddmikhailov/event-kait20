import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const placeholderPattern =
  /(?:example\.(?:com|org|ru)|replace|change-?me|todo|<[^>]+>)/i;

export class DeploymentConfigError extends Error {}

const requiredKeys = [
  'NODE_ENV',
  'API_HOST',
  'API_PORT',
  'DATABASE_URL',
  'DATABASE_CONNECT_TIMEOUT_MS',
  'MIGRATIONS_DIR',
  'CORS_ORIGINS',
  'SESSION_SECRET',
  'SESSION_TTL_SECONDS',
  'AUTH_LINK_SECRET',
  'AUTH_LINK_BASE_URL',
  'INVITATION_TTL_SECONDS',
  'PASSWORD_RESET_TTL_SECONDS',
  'AUTH_RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_SECONDS',
  'QR_SIGNING_SECRET',
  'PUBLIC_WEB_BASE_URL',
  'CONSENT_URL',
  'CONSENT_VERSION',
  'EMAIL_MAX_ATTEMPTS',
  'EMAIL_POLL_INTERVAL_MS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
  'SMTP_FROM_NAME',
  'SMTP_STARTTLS',
];

const assert = (condition, message) => {
  if (!condition) throw new DeploymentConfigError(message);
};

export const parseEnvironment = (source) => {
  const values = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    assert(separator > 0, `Line ${index + 1} is not KEY=VALUE`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    assert(/^[A-Z][A-Z0-9_]*$/.test(key), `Invalid key on line ${index + 1}`);
    assert(!(key in values), `Duplicate key: ${key}`);
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    assert(!/[\r\n\0]/.test(value), `${key} contains a control character`);
    values[key] = value;
  }
  return values;
};

const secureUrl = (value, key, { originOnly = false } = {}) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DeploymentConfigError(`${key} must be a valid URL`);
  }
  assert(url.protocol === 'https:', `${key} must use HTTPS`);
  assert(!url.username && !url.password, `${key} must not contain credentials`);
  assert(!url.search && !url.hash, `${key} must not contain query or fragment`);
  if (originOnly) {
    assert(url.pathname === '/', `${key} must be an origin without a path`);
  }
  return url;
};

const positiveInteger = (values, key, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = Number(values[key]);
  assert(
    Number.isInteger(value) && value > 0 && value <= maximum,
    `${key} must be a positive integer`,
  );
};

const validateFileMode = (path) => {
  if (process.platform === 'win32') return;
  const mode = statSync(path).mode & 0o777;
  assert(
    (mode & 0o007) === 0,
    'Environment file must not be accessible to others',
  );
  assert((mode & 0o020) === 0, 'Environment file must not be group-writable');
};

export const validateDeploymentConfig = (
  values,
  { checkFiles = false, envPath, migration = false } = {},
) => {
  for (const key of requiredKeys) assert(values[key], `${key} is required`);
  assert(values.NODE_ENV === 'production', 'NODE_ENV must be production');
  assert(values.API_HOST === '127.0.0.1', 'API_HOST must be 127.0.0.1');
  assert(values.API_PORT === '3000', 'API_PORT must be 3000');
  for (const [key, value] of Object.entries(values)) {
    if (key === 'SMTP_FROM_NAME') continue;
    assert(
      !placeholderPattern.test(value),
      `${key} still contains a placeholder`,
    );
  }

  let database;
  try {
    database = new URL(values.DATABASE_URL);
  } catch {
    throw new DeploymentConfigError('DATABASE_URL must be a valid MySQL URL');
  }
  assert(
    database.protocol === 'mysql:',
    'DATABASE_URL must use the mysql protocol',
  );
  const expectedDatabaseUser = migration ? 'event_migrate' : 'event_app';
  assert(
    database.username === expectedDatabaseUser,
    `DB user must be ${expectedDatabaseUser}`,
  );
  assert(
    database.password,
    'DATABASE_URL must contain the application password',
  );
  assert(database.hostname, 'DATABASE_URL must contain the MySQL host');
  assert(!database.port || database.port === '3306', 'MySQL port must be 3306');
  assert(
    database.pathname === '/event_registration',
    'DATABASE_URL must select event_registration',
  );

  const migrations = values.MIGRATIONS_DIR;
  assert(
    isAbsolute(migrations) || /^\/[A-Za-z0-9._/-]+$/.test(migrations),
    'MIGRATIONS_DIR must be an absolute path',
  );
  if (checkFiles) {
    assert(existsSync(migrations), 'MIGRATIONS_DIR does not exist');
    assert(
      statSync(migrations).isDirectory(),
      'MIGRATIONS_DIR is not a directory',
    );
  }

  const web = secureUrl(values.PUBLIC_WEB_BASE_URL, 'PUBLIC_WEB_BASE_URL', {
    originOnly: true,
  });
  const origins = values.CORS_ORIGINS.split(',').map((item) => item.trim());
  assert(
    origins.length === 2,
    'CORS_ORIGINS must contain Web and Scanner only',
  );
  assert(!origins.includes('*'), 'Wildcard CORS is forbidden');
  const parsedOrigins = origins.map((origin, index) =>
    secureUrl(origin, `CORS_ORIGINS[${index}]`, { originOnly: true }),
  );
  assert(
    new Set(parsedOrigins.map((origin) => origin.origin)).size === 2,
    'Web and Scanner origins must be distinct',
  );
  assert(
    parsedOrigins.some((origin) => origin.origin === web.origin),
    'CORS_ORIGINS must include PUBLIC_WEB_BASE_URL',
  );
  const scanner = parsedOrigins.find((origin) => origin.origin !== web.origin);
  assert(scanner, 'Scanner origin is missing');

  const auth = secureUrl(values.AUTH_LINK_BASE_URL, 'AUTH_LINK_BASE_URL');
  assert(
    auth.origin === web.origin,
    'AUTH_LINK_BASE_URL must use the Web origin',
  );
  assert(
    auth.pathname.replace(/\/$/, '') === '/auth',
    'AUTH_LINK_BASE_URL path must be /auth',
  );
  secureUrl(values.CONSENT_URL, 'CONSENT_URL');

  const secrets = [
    values.SESSION_SECRET,
    values.AUTH_LINK_SECRET,
    values.QR_SIGNING_SECRET,
  ];
  for (const secret of secrets) {
    assert(
      Buffer.byteLength(secret, 'utf8') >= 32,
      'Cryptographic secrets need 32 bytes',
    );
  }
  assert(
    new Set(secrets).size === secrets.length,
    'Cryptographic secrets must be distinct',
  );

  for (const key of [
    'DATABASE_CONNECT_TIMEOUT_MS',
    'SESSION_TTL_SECONDS',
    'INVITATION_TTL_SECONDS',
    'PASSWORD_RESET_TTL_SECONDS',
    'AUTH_RATE_LIMIT_MAX',
    'AUTH_RATE_LIMIT_WINDOW_SECONDS',
    'EMAIL_MAX_ATTEMPTS',
    'EMAIL_POLL_INTERVAL_MS',
  ]) {
    positiveInteger(values, key);
  }
  positiveInteger(values, 'SMTP_PORT', 65_535);
  assert(values.SMTP_STARTTLS === 'true', 'SMTP_STARTTLS must be true');
  assert(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.SMTP_FROM_EMAIL),
    'SMTP_FROM_EMAIL is invalid',
  );
  if (envPath && existsSync(envPath)) validateFileMode(envPath);

  return {
    webDomain: web.hostname,
    scannerDomain: scanner.hostname,
    apiPath: '/api',
    databaseHost: database.hostname,
    migrationDirectory: migrations,
  };
};

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const main = () => {
  const action = process.argv[2];
  assert(action === 'check', 'Use check');
  const envPath = resolve(
    argument('--env', 'release/sysadmin/backend.env.example'),
  );
  assert(existsSync(envPath), `Environment file not found: ${envPath}`);
  const values = parseEnvironment(readFileSync(envPath, 'utf8'));
  const summary = validateDeploymentConfig(values, {
    checkFiles: process.argv.includes('--check-files'),
    envPath,
    migration: process.argv.includes('--migration'),
  });
  if (process.argv.includes('--json')) console.log(JSON.stringify(summary));
  else console.log('Production backend configuration is valid.');
};

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
