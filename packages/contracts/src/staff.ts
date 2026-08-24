import { z } from 'zod';

import { emailSchema, uuidSchema } from './common.js';

export const staffInvitationRequestSchema = z
  .object({ email: emailSchema, eventId: uuidSchema.optional() })
  .strict();
export type StaffInvitationRequest = z.infer<
  typeof staffInvitationRequestSchema
>;

export const staffInvitationResponseSchema = z.object({
  id: uuidSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.literal('queued'),
});
export type StaffInvitationResponse = z.infer<
  typeof staffInvitationResponseSchema
>;

export const staffSummarySchema = z.object({
  id: uuidSchema,
  email: z.email(),
  role: z.enum(['SUPER_ADMIN', 'SCANNER']),
  active: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export const staffListResponseSchema = z.object({
  items: z.array(staffSummarySchema),
});
export type StaffListResponse = z.infer<typeof staffListResponseSchema>;

export const eventAccessRequestSchema = z
  .object({ userId: uuidSchema })
  .strict();
export type EventAccessRequest = z.infer<typeof eventAccessRequestSchema>;

export const eventAccessSummarySchema = z.object({
  userId: uuidSchema,
  email: z.email(),
  role: z.literal('SCANNER'),
  createdAt: z.iso.datetime({ offset: true }),
});
export const eventAccessListResponseSchema = z.object({
  items: z.array(eventAccessSummarySchema),
});
export type EventAccessListResponse = z.infer<
  typeof eventAccessListResponseSchema
>;
