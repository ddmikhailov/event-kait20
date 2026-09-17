import { z } from 'zod';

import { emailSchema, uuidSchema } from './common.js';

export const staffInvitationRequestSchema = z
  .object({
    email: emailSchema,
    role: z.enum(['ORGANIZER', 'SCANNER']).default('SCANNER'),
    eventId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === 'ORGANIZER' && value.eventId) {
      context.addIssue({
        code: 'custom',
        path: ['eventId'],
        message: 'Organizer invitations cannot be event-scoped',
      });
    }
  });
export type StaffInvitationRequest = z.infer<
  typeof staffInvitationRequestSchema
>;

export const staffInvitationResponseSchema = z.object({
  id: uuidSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.enum(['queued', 'sending', 'sent', 'failed', 'missing']),
});
export type StaffInvitationResponse = z.infer<
  typeof staffInvitationResponseSchema
>;

export const invitationResendRequestSchema = z
  .object({ requestId: uuidSchema })
  .strict();
export const staffInvitationListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: uuidSchema,
      email: z.email(),
      role: z.enum(['SUPER_ADMIN', 'ORGANIZER', 'SCANNER']),
      expiresAt: z.iso.datetime({ offset: true }),
      acceptedAt: z.iso.datetime({ offset: true }).nullable(),
      deliveryStatus: z.enum([
        'QUEUED',
        'SENDING',
        'SENT',
        'FAILED',
        'MISSING',
      ]),
      attempts: z.number().int().nonnegative(),
      lastErrorCode: z.string().nullable(),
      nextAttemptAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
});
export type StaffInvitationListResponse = z.infer<
  typeof staffInvitationListResponseSchema
>;

export const staffSummarySchema = z.object({
  id: uuidSchema,
  email: z.email(),
  role: z.enum(['SUPER_ADMIN', 'ORGANIZER', 'SCANNER']),
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
