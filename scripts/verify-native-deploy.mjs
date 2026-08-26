import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderDeployment } from './deploy-config.mjs';

const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return resolve(process.argv[index + 1]);
};

const outputDirectory = argument('--output');
const certificate = argument('--certificate');
const certificateKey = argument('--certificate-key');
mkdirSync(outputDirectory, { recursive: true });

const values = {
  NODE_ENV: 'production',
  DATABASE_URL:
    'mysql://event_app:ci-only-database-password@127.0.0.1:3306/event_registration',
  CORS_ORIGINS: 'https://web.ci.invalid,https://scanner.ci.invalid',
  SESSION_SECRET: 'ci-only-session-secret-with-at-least-32-bytes',
  AUTH_LINK_SECRET: 'ci-only-auth-link-secret-with-at-least-32-bytes',
  AUTH_LINK_BASE_URL: 'https://web.ci.invalid/auth',
  QR_SIGNING_SECRET: 'ci-only-qr-signing-secret-with-at-least-32-bytes',
  PUBLIC_WEB_BASE_URL: 'https://web.ci.invalid',
  PUBLIC_API_BASE_URL: 'https://api.ci.invalid',
  CONSENT_URL: 'https://legal.ci.invalid/privacy',
  CONSENT_VERSION: 'ci-test-version',
  TLS_CERTIFICATE: certificate,
  TLS_CERTIFICATE_KEY: certificateKey,
  SMTP_HOST: 'smtp.ci.invalid',
  SMTP_PORT: '587',
  SMTP_USERNAME: 'ci-mailer',
  SMTP_PASSWORD: 'ci-only-smtp-password',
  SMTP_FROM_EMAIL: 'events@ci.invalid',
  SMTP_FROM_NAME: 'CI Test',
  SMTP_STARTTLS: 'true',
};

renderDeployment({ values, outputDirectory, checkFiles: true });
writeFileSync(
  resolve(outputDirectory, 'migration.env'),
  `DATABASE_URL=mysql://event_migrate:ci-only-database-password@127.0.0.1:3306/event_registration\n`,
  { mode: 0o600 },
);
console.log(`Native deployment templates rendered in ${outputDirectory}`);
