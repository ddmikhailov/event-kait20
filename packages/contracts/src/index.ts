import { z } from 'zod';

export * from './auth.js';
export * from './activity.js';
export * from './attendance.js';
export * from './common.js';
export * from './events.js';
export * from './forms.js';
export * from './excel.js';
export * from './participants.js';
export * from './registrations.js';
export * from './reporting.js';
export * from './scoring-v2.js';
export * from './staff.js';
export * from './structure.js';

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
