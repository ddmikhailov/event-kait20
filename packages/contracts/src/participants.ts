import { z } from 'zod';

import { emailSchema, pageQuerySchema, uuidSchema } from './common.js';
import {
  participantNameSchema,
  personTypeSchema,
  russianPhoneSchema,
} from './registrations.js';

export const registrationStatusSchema = z.enum(['ACTIVE', 'ANNULLED']);
export const ticketResendRequestSchema = z.object({ requestId: uuidSchema });
export const ticketResendResponseSchema = z.object({
  status: z.enum(['QUEUED', 'ALREADY_QUEUED']),
});
export type TicketResendResponse = z.infer<typeof ticketResendResponseSchema>;
export const ticketDeliveryListSchema = z.object({
  items: z.array(
    z.object({
      status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED']),
      queuedAt: z.iso.datetime({ offset: true }),
      sentAt: z.iso.datetime({ offset: true }).nullable(),
      attempts: z.number().int().nonnegative(),
      lastErrorCode: z.string().nullable(),
    }),
  ),
});
export type TicketDeliveryList = z.infer<typeof ticketDeliveryListSchema>;
export const registrationSourceSchema = z.enum([
  'PUBLIC_FORM',
  'EXCEL_IMPORT',
  'ONSITE',
  'ADMIN_MANUAL',
]);

const personValuesSchema = z.object({
  lastName: participantNameSchema,
  firstName: participantNameSchema,
  middleName: participantNameSchema.nullable(),
  birthDate: z.iso.date().nullable(),
  email: emailSchema.nullable(),
  phone: russianPhoneSchema.nullable(),
  studyGroup: z.string().trim().min(1).max(100).nullable(),
  personType: personTypeSchema,
  organization: z.string().trim().min(1).max(255).nullable(),
});

export const participantListQuerySchema = pageQuerySchema.extend({
  query: z.string().trim().max(200).default(''),
});
export type ParticipantListQuery = z.infer<typeof participantListQuerySchema>;

export const personListQuerySchema = participantListQuerySchema.extend({
  dedupReviewRequired: z.boolean().optional(),
});

export const registrationListQuerySchema = participantListQuerySchema.extend({
  status: registrationStatusSchema.optional(),
});
export type RegistrationListQuery = z.infer<typeof registrationListQuerySchema>;

export const personSummarySchema = personValuesSchema.extend({
  id: uuidSchema,
  dedupReviewRequired: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

const registrationHistoryItemSchema = z.object({
  id: uuidSchema,
  eventId: uuidSchema,
  eventTitle: z.string(),
  source: registrationSourceSchema,
  status: registrationStatusSchema,
  registeredAt: z.iso.datetime({ offset: true }),
  firstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const rosterMetadataSchema = z.object({
  educationStatus: z.string().trim().min(1).max(120).nullable(),
  campusAddress: z.string().trim().min(1).max(120).nullable(),
  course: z.string().trim().min(1).max(120).nullable(),
  programName: z.string().trim().min(1).max(120).nullable(),
  programCode: z.string().trim().min(1).max(120).nullable(),
});
export const updateRosterMetadataRequestSchema = rosterMetadataSchema
  .extend({
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type UpdateRosterMetadataRequest = z.infer<
  typeof updateRosterMetadataRequestSchema
>;

export const personDetailResponseSchema = personSummarySchema.extend({
  roster: rosterMetadataSchema.nullable(),
  rosterVersion: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  registrations: z.array(registrationHistoryItemSchema),
});
export type PersonDetailResponse = z.infer<typeof personDetailResponseSchema>;

export const personMergeConflictSchema = z.object({
  code: z.enum([
    'ACTIVE_REGISTRATION',
    'CONFIRMED_PARTICIPATION',
    'SCORING_SEQUENCE',
    'MEMBERSHIP_OVERLAP',
    'STATUS_OVERLAP',
  ]),
  eventId: uuidSchema.nullable(),
  sequence: z.number().int().positive().nullable(),
});
export const personMergePreviewSchema = z.object({
  target: personSummarySchema,
  source: personSummarySchema,
  targetCounts: z.record(z.string(), z.number().int().nonnegative()),
  sourceCounts: z.record(z.string(), z.number().int().nonnegative()),
  conflicts: z.array(personMergeConflictSchema),
  canMerge: z.boolean(),
});
export const personMergeRequestSchema = z.object({
  sourcePersonId: uuidSchema,
  reason: z.string().trim().min(3).max(500),
});
export type PersonMergePreview = z.infer<typeof personMergePreviewSchema>;
export type PersonMergeRequest = z.infer<typeof personMergeRequestSchema>;

export const personListResponseSchema = z.object({
  items: z.array(personSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PersonListResponse = z.infer<typeof personListResponseSchema>;

export const updatePersonRequestSchema = personValuesSchema
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required',
  );
export type UpdatePersonRequest = z.infer<typeof updatePersonRequestSchema>;

const registrationSnapshotSchema = personValuesSchema.extend({
  id: uuidSchema,
  eventId: uuidSchema,
  personId: uuidSchema,
  source: registrationSourceSchema,
  status: registrationStatusSchema,
  registeredAt: z.iso.datetime({ offset: true }),
  firstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
  annulledAt: z.iso.datetime({ offset: true }).nullable(),
});

export const registrationListResponseSchema = z.object({
  items: z.array(registrationSnapshotSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type RegistrationListResponse = z.infer<
  typeof registrationListResponseSchema
>;

const registrationAnswerResponseSchema = z.object({
  fieldId: uuidSchema,
  fieldLabel: z.string(),
  fieldType: z.string(),
  value: z.unknown(),
});

export const registrationDetailResponseSchema =
  registrationSnapshotSchema.extend({
    answers: z.array(registrationAnswerResponseSchema),
    ticketUrl: z.url(),
  });
export type RegistrationDetailResponse = z.infer<
  typeof registrationDetailResponseSchema
>;

export const scannerRegistrationListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: uuidSchema,
      lastName: z.string(),
      firstName: z.string(),
      middleName: z.string().nullable(),
      phone: z.string().nullable(),
      studyGroup: z.string().nullable(),
      personType: personTypeSchema,
      organization: z.string().nullable(),
      firstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type ScannerRegistrationListResponse = z.infer<
  typeof scannerRegistrationListResponseSchema
>;

export const updateRegistrationRequestSchema = personValuesSchema
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required',
  );
export type UpdateRegistrationRequest = z.infer<
  typeof updateRegistrationRequestSchema
>;
