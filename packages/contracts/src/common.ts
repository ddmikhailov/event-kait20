import { z } from 'zod';

export const uuidSchema = z.uuid();
export const emailSchema = z
  .string()
  .trim()
  .pipe(z.email().max(320))
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const errorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'AUTH_LINK_INVALID',
  'ORIGIN_NOT_TRUSTED',
  'CSRF_INVALID',
  'EVENT_NOT_FOUND',
  'INVALID_EVENT_STATE',
  'INVALID_TIME_RANGE',
  'CAPACITY_BELOW_ACTIVE_REGISTRATIONS',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const acceptedResponseSchema = z.object({
  status: z.literal('accepted'),
});
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
