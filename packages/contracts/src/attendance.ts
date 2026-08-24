import { z } from 'zod';

import { uuidSchema } from './common.js';
import { personTypeSchema } from './registrations.js';

export const scannerParticipantSchema = z.object({
  registrationId: uuidSchema,
  lastName: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  phone: z.string().nullable(),
  studyGroup: z.string().nullable(),
  personType: personTypeSchema,
  organization: z.string().nullable(),
  firstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const resolveQrRequestSchema = z
  .object({ qrPayload: z.string().min(40).max(500) })
  .strict();
export type ResolveQrRequest = z.infer<typeof resolveQrRequestSchema>;

export const resolveQrResponseSchema = scannerParticipantSchema;
export type ResolveQrResponse = z.infer<typeof resolveQrResponseSchema>;

export const attendanceModeSchema = z.enum([
  'MANUAL_CONFIRM',
  'FAST_SCAN',
  'MANUAL_SEARCH',
  'ONSITE_REGISTRATION',
]);
export const attendanceSourceSchema = z.enum(['ONLINE', 'OFFLINE_SYNC']);

export const attendanceSyncItemSchema = z
  .object({
    clientEventId: uuidSchema,
    registrationId: uuidSchema,
    mode: attendanceModeSchema,
    source: attendanceSourceSchema,
    deviceScannedAt: z.iso.datetime({ offset: true }),
    estimatedScannedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const attendanceSyncRequestSchema = z
  .object({
    deviceId: uuidSchema,
    events: z.array(attendanceSyncItemSchema).min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.events.map((event) => event.clientEventId)).size !==
      value.events.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'clientEventId must be unique within a batch',
      });
    }
  });
export type AttendanceSyncRequest = z.infer<typeof attendanceSyncRequestSchema>;

export const attendanceSyncItemStatusSchema = z.enum([
  'ACCEPTED',
  'ALREADY_PROCESSED',
  'REGISTRATION_ALREADY_ATTENDED',
  'INVALID_REGISTRATION',
  'REGISTRATION_ANNULLED',
  'INVALID_TIMESTAMP',
]);

export const attendanceSyncResponseSchema = z.object({
  results: z.array(
    z.object({
      clientEventId: uuidSchema,
      status: attendanceSyncItemStatusSchema,
      firstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
  offlineDataVersion: z.string().regex(/^\d+$/),
});
export type AttendanceSyncResponse = z.infer<
  typeof attendanceSyncResponseSchema
>;

export const offlineBundleResponseSchema = z.object({
  eventId: uuidSchema,
  version: z.string().regex(/^\d+$/),
  generatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  serverTime: z.iso.datetime({ offset: true }),
  registrationCount: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  registrations: z.array(
    scannerParticipantSchema.extend({
      qrPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export type OfflineBundleResponse = z.infer<typeof offlineBundleResponseSchema>;
