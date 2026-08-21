import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']);

export const apiEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  SESSION_SECRET: z.string().min(32),
  QR_SIGNING_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().min(1),
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
