import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployRoot = resolve(repositoryRoot, 'deploy');
const placeholderPattern =
  /(?:example\.(?:com|org|ru)|replace|change-?me|todo|<[^>]+>)/i;

export class DeploymentConfigError extends Error {}

const requiredKeys = [
  'NODE_ENV',
  'DATABASE_URL',
  'CORS_ORIGINS',
  'SESSION_SECRET',
  'AUTH_LINK_SECRET',
  'AUTH_LINK_BASE_URL',
  'QR_SIGNING_SECRET',
  'PUBLIC_WEB_BASE_URL',
  'PUBLIC_API_BASE_URL',
  'CONSENT_URL',
  'CONSENT_VERSION',
  'TLS_CERTIFICATE',
  'TLS_CERTIFICATE_KEY',
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

const exactOrigin = (url) => url.origin;

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
  for (const key of requiredKeys) {
    assert(values[key], `${key} is required`);
  }
  assert(values.NODE_ENV === 'production', 'NODE_ENV must be production');
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
  assert(
    ['127.0.0.1', 'localhost'].includes(database.hostname),
    'Native single-server MySQL must use loopback',
  );
  assert(!database.port || database.port === '3306', 'MySQL port must be 3306');
  assert(
    database.pathname === '/event_registration',
    'DATABASE_URL must select event_registration',
  );

  const web = secureUrl(values.PUBLIC_WEB_BASE_URL, 'PUBLIC_WEB_BASE_URL', {
    originOnly: true,
  });
  const api = secureUrl(values.PUBLIC_API_BASE_URL, 'PUBLIC_API_BASE_URL', {
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
    new Set(parsedOrigins.map(exactOrigin)).size === 2,
    'Web and Scanner origins must be distinct',
  );
  assert(
    parsedOrigins.some((origin) => origin.origin === web.origin),
    'CORS_ORIGINS must include PUBLIC_WEB_BASE_URL',
  );
  const scanner = parsedOrigins.find((origin) => origin.origin !== web.origin);
  assert(scanner, 'Scanner origin is missing');
  assert(
    new Set([web.hostname, scanner.hostname, api.hostname]).size === 3,
    'Web, Scanner and API must use distinct domains',
  );

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

  const smtpPort = Number(values.SMTP_PORT);
  assert(
    Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535,
    'SMTP_PORT is invalid',
  );
  assert(values.SMTP_STARTTLS === 'true', 'SMTP_STARTTLS must be true');
  assert(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.SMTP_FROM_EMAIL),
    'SMTP_FROM_EMAIL is invalid',
  );

  for (const key of ['TLS_CERTIFICATE', 'TLS_CERTIFICATE_KEY']) {
    assert(isAbsolute(values[key]), `${key} must be an absolute path`);
    if (checkFiles) assert(existsSync(values[key]), `${key} does not exist`);
  }
  if (envPath && existsSync(envPath)) validateFileMode(envPath);

  return {
    webDomain: web.hostname,
    scannerDomain: scanner.hostname,
    apiDomain: api.hostname,
    publicApiBaseUrl: api.origin,
    certificate: values.TLS_CERTIFICATE,
    certificateKey: values.TLS_CERTIFICATE_KEY,
  };
};

const writeProtected = (path, source, mode = 0o644) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, { encoding: 'utf8', mode });
  if (process.platform !== 'win32') chmodSync(path, mode);
};

const replaceAll = (source, replacements, label) => {
  let result = source;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value);
  }
  assert(
    !/__[A-Z0-9_]+__/.test(result),
    `${label} has unresolved placeholders`,
  );
  return result;
};

export const renderDeployment = ({
  values,
  outputDirectory,
  checkFiles = false,
  envPath,
}) => {
  const summary = validateDeploymentConfig(values, { checkFiles, envPath });
  const nginxOutput = resolve(outputDirectory, 'nginx');
  const replacements = {
    __WEB_DOMAIN__: summary.webDomain,
    __SCANNER_DOMAIN__: summary.scannerDomain,
    __API_DOMAIN__: summary.apiDomain,
    __WEB_CERTIFICATE__: summary.certificate,
    __WEB_CERTIFICATE_KEY__: summary.certificateKey,
    __SCANNER_CERTIFICATE__: summary.certificate,
    __SCANNER_CERTIFICATE_KEY__: summary.certificateKey,
    __API_CERTIFICATE__: summary.certificate,
    __API_CERTIFICATE_KEY__: summary.certificateKey,
  };
  const templates = [
    ['nginx/event-registration.conf.template', 'nginx/event-registration.conf'],
    [
      'nginx/event-registration-web-security.conf',
      'nginx/event-registration-web-security.conf',
    ],
    [
      'nginx/event-registration-scanner-security.conf',
      'nginx/event-registration-scanner-security.conf',
    ],
  ];
  for (const [input, output] of templates) {
    const source = readFileSync(resolve(deployRoot, input), 'utf8');
    writeProtected(
      resolve(outputDirectory, output),
      replaceAll(source, replacements, basename(input)),
    );
  }
  for (const directory of ['systemd', 'mysql']) {
    const files =
      directory === 'systemd'
        ? [
            'event-registration-api.service',
            'event-registration-email-worker.service',
            'event-registration-mysql.service',
            'event-registration-backup.service',
            'event-registration-backup.timer',
            'event-registration-monitor.service',
            'event-registration-monitor.timer',
          ]
        : ['event-registration.cnf'];
    for (const file of files) {
      const input = resolve(deployRoot, directory, file);
      if (!existsSync(input)) continue;
      writeProtected(
        resolve(outputDirectory, directory, file),
        readFileSync(input, 'utf8'),
      );
    }
  }
  writeProtected(
    resolve(outputDirectory, 'deployment-manifest.json'),
    `${JSON.stringify({ ...summary, nginxOutput }, null, 2)}\n`,
  );
  return summary;
};

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const main = () => {
  const action = process.argv[2];
  assert(['check', 'render'].includes(action), 'Use check or render');
  const envPath = resolve(argument('--env', 'deploy/native.env'));
  assert(existsSync(envPath), `Environment file not found: ${envPath}`);
  const values = parseEnvironment(readFileSync(envPath, 'utf8'));
  const checkFiles = process.argv.includes('--check-files');
  const migration = process.argv.includes('--migration');
  if (action === 'check') {
    const summary = validateDeploymentConfig(values, {
      checkFiles,
      envPath,
      migration,
    });
    if (process.argv.includes('--json')) console.log(JSON.stringify(summary));
    else console.log('Production deployment configuration is valid.');
    return;
  }
  const outputDirectory = resolve(
    argument('--output', '.runtime/deploy-rendered'),
  );
  const summary = renderDeployment({
    values,
    outputDirectory,
    checkFiles,
    envPath,
  });
  console.log(
    `Rendered deployment for ${summary.webDomain} in ${outputDirectory}`,
  );
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
