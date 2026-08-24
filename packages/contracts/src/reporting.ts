import { z } from 'zod';

import { uuidSchema } from './common.js';

const uniqueRegistrationIds = z
  .array(uuidSchema)
  .min(1)
  .max(5_000)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Registration ids must be unique',
  });

export const sendTicketsRequestSchema = z.discriminatedUnion('selection', [
  z
    .object({
      requestId: uuidSchema,
      selection: z.literal('IMPORTED'),
    })
    .strict(),
  z
    .object({
      requestId: uuidSchema,
      selection: z.literal('REGISTRATION_IDS'),
      registrationIds: uniqueRegistrationIds,
    })
    .strict(),
]);
export type SendTicketsRequest = z.infer<typeof sendTicketsRequestSchema>;

export const sendTicketsResponseSchema = z.object({
  requestId: uuidSchema,
  queuedRows: z.number().int().nonnegative(),
  alreadyQueuedRows: z.number().int().nonnegative(),
  withoutEmailRows: z.number().int().nonnegative(),
  inactiveOrMissingRows: z.number().int().nonnegative(),
});
export type SendTicketsResponse = z.infer<typeof sendTicketsResponseSchema>;

export const eventStatisticsResponseSchema = z.object({
  eventId: uuidSchema,
  capacity: z.number().int().positive(),
  registered: z.number().int().nonnegative(),
  freePlaces: z.number().int().nonnegative(),
  attended: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  attendancePercentage: z.number().min(0).max(100),
  arrivalSeries: z.array(
    z.object({
      bucketStart: z.iso.datetime({ offset: true }),
      count: z.number().int().positive(),
      cumulative: z.number().int().positive(),
    }),
  ),
});
export type EventStatisticsResponse = z.infer<
  typeof eventStatisticsResponseSchema
>;
