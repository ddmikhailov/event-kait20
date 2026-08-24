import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const trustedOriginSchema = z.url().refine((value) => {
  const url = new URL(value);

  return url.pathname === '/' && !url.search && !url.hash;
}, 'Trusted origins must contain only scheme, host and optional port');

const trustedOriginsSchema = z
  .string()
  .transform((value) => value.split(',').map((origin) => origin.trim()))
  .pipe(z.array(trustedOriginSchema).min(1))
  .refine((origins) => new Set(origins).size === origins.length, {
    message: 'Trusted origins must be unique',
  });

export const apiEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  SESSION_SECRET: z.string().min(32),
  AUTH_LINK_SECRET: z.string().min(32),
  AUTH_LINK_BASE_URL: z.url(),
  QR_SIGNING_SECRET: z.string().min(32),
  PUBLIC_WEB_BASE_URL: z.url(),
  CONSENT_URL: z.url(),
  CONSENT_VERSION: z.string().min(1).max(255),
  CORS_ORIGINS: trustedOriginsSchema,
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(28_800),
  PASSWORD_RESET_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(1_800),
  INVITATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(2_592_000)
    .default(604_800),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
});

export const workerEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default('development'),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  EMAIL_QUEUE_URL: z.url(),
  EMAIL_PROVIDER_API_KEY: z.string().min(1),
});

type Environment = Record<string, string | undefined>;

export const parseApiEnvironment = (environment: Environment) =>
  apiEnvironmentSchema.parse(environment);

export const parseWorkerEnvironment = (environment: Environment) =>
  workerEnvironmentSchema.parse(environment);
