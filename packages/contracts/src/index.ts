import { z } from 'zod';

export * from './auth.js';
export * from './common.js';
export * from './events.js';
export * from './registrations.js';
export * from './staff.js';

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
