import { z } from 'zod';

import { allowedPersonTypesSchema, uuidSchema } from './common.js';
import { registrationFormConfigSchema, systemFieldsSchema } from './forms.js';

export const eventStatusSchema = z.enum([
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
]);

const eventValuesSchema = z.object({
  seasonId: uuidSchema.nullable().optional(),
  categoryId: uuidSchema.nullable().optional(),
  levelId: uuidSchema.nullable().optional(),
  boostMultiplier: z.enum(['1.0', '1.5', '2.0', '3.0']).default('1.0'),
  formConfig: registrationFormConfigSchema.optional(),
  isListed: z.boolean().optional(),
  allowedPersonTypes: allowedPersonTypesSchema.optional(),
  title: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(20_000).nullable().optional(),
  direction: z.string().trim().max(80).nullable().optional(),
  directionId: uuidSchema.nullable().optional(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  timezone: z.literal('Europe/Moscow').default('Europe/Moscow'),
  location: z.string().trim().min(1).max(500),
  registrationDeadline: z.iso.datetime({ offset: true }),
  capacity: z.number().int().positive(),
  status: eventStatusSchema.default('DRAFT'),
});

export const createEventRequestSchema = eventValuesSchema.strict();
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const updateEventRequestSchema = eventValuesSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required',
  );
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

export const eventResponseSchema = z.object({
  completionSummary: z
    .object({
      registered: z.number().int().nonnegative(),
      present: z.number().int().nonnegative(),
      absent: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
  effectiveStatus: eventStatusSchema.optional(),
  formConfig: registrationFormConfigSchema.optional(),
  streamsEnabled: z.boolean().optional(),
  isListed: z.boolean().optional(),
  allowedPersonTypes: allowedPersonTypesSchema.optional(),
  seasonId: uuidSchema.nullable().optional(),
  categoryId: uuidSchema.nullable().optional(),
  levelId: uuidSchema.nullable().optional(),
  boostMultiplier: z.enum(['1.0', '1.5', '2.0', '3.0']).optional(),
  levelName: z.string().nullable().optional(),
  activityReviewState: z
    .enum(['NOT_STARTED', 'PENDING', 'APPROVED'])
    .optional(),
  id: uuidSchema,
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  direction: z.string().nullable().optional(),
  directionId: uuidSchema.nullable().optional(),
  organizationId: uuidSchema,
  coverObjectKey: z.string().nullable(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  timezone: z.string(),
  location: z.string(),
  registrationDeadline: z.iso.datetime({ offset: true }),
  capacity: z.number().int(),
  status: eventStatusSchema,
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type EventResponse = z.infer<typeof eventResponseSchema>;

export const eventListResponseSchema = z.object({
  items: z.array(eventResponseSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type EventListResponse = z.infer<typeof eventListResponseSchema>;

export const publicEventSummarySchema = eventResponseSchema.pick({
  effectiveStatus: true,
  id: true,
  title: true,
  slug: true,
  description: true,
  levelName: true,
  boostMultiplier: true,
  direction: true,
  directionId: true,
  coverObjectKey: true,
  startAt: true,
  endAt: true,
  timezone: true,
  location: true,
  registrationDeadline: true,
});
export type PublicEventSummary = z.infer<typeof publicEventSummarySchema>;

export const publicEventListResponseSchema = z.object({
  items: z.array(publicEventSummarySchema),
});
export type PublicEventListResponse = z.infer<
  typeof publicEventListResponseSchema
>;

export const purgeEventRequestSchema = z
  .object({ confirmationSlug: eventValuesSchema.shape.slug })
  .strict();
export type PurgeEventRequest = z.infer<typeof purgeEventRequestSchema>;

export const scannerEventListResponseSchema = z.object({
  items: z.array(
    eventResponseSchema.pick({
      id: true,
      title: true,
      allowedPersonTypes: true,
      streamsEnabled: true,
      startAt: true,
      endAt: true,
      timezone: true,
      location: true,
      status: true,
    }),
  ),
});
export type ScannerEventListResponse = z.infer<
  typeof scannerEventListResponseSchema
>;

export const formFieldTypeSchema = z.enum([
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'BOOLEAN',
]);

const formFieldValuesSchema = z.object({
  onsiteRequired: z.boolean().default(false),
  type: formFieldTypeSchema,
  label: z.string().trim().min(1).max(255),
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0),
  options: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .nullable()
    .optional(),
});

export const createFormFieldRequestSchema = formFieldValuesSchema.strict();
export type CreateFormFieldRequest = z.infer<
  typeof createFormFieldRequestSchema
>;

export const updateFormFieldRequestSchema = formFieldValuesSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required',
  );
export type UpdateFormFieldRequest = z.infer<
  typeof updateFormFieldRequestSchema
>;

export const formFieldResponseSchema = z.object({
  onsiteRequired: z.boolean().optional(),
  id: uuidSchema,
  eventId: uuidSchema,
  type: formFieldTypeSchema,
  label: z.string(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  options: z.array(z.string()).nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FormFieldResponse = z.infer<typeof formFieldResponseSchema>;

export const formFieldListResponseSchema = z.object({
  systemFields: systemFieldsSchema.optional(),
  allowedPersonTypes: allowedPersonTypesSchema.optional(),
  items: z.array(formFieldResponseSchema),
});
export type FormFieldListResponse = z.infer<typeof formFieldListResponseSchema>;

export const streamValuesSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    capacity: z.number().int().min(1).max(1_000_000),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type StreamValues = z.infer<typeof streamValuesSchema>;
export const streamResponseSchema = streamValuesSchema.extend({
  id: uuidSchema,
  eventId: uuidSchema,
  registered: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  ended: z.boolean(),
});
export type StreamResponse = z.infer<typeof streamResponseSchema>;
export const streamListResponseSchema = z.object({
  items: z.array(streamResponseSchema),
  streamsEnabled: z.boolean().optional(),
});
export type StreamListResponse = z.infer<typeof streamListResponseSchema>;
