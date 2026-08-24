import { z } from 'zod';

import { uuidSchema } from './common.js';

export const eventStatusSchema = z.enum([
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
]);

const eventValuesSchema = z.object({
  title: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(20_000).nullable().optional(),
  coverObjectKey: z.string().max(1024).nullable().optional(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(64).default('Europe/Moscow'),
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
  id: uuidSchema,
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
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

export const scannerEventListResponseSchema = z.object({
  items: z.array(
    eventResponseSchema.pick({
      id: true,
      title: true,
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
  items: z.array(formFieldResponseSchema),
});
export type FormFieldListResponse = z.infer<typeof formFieldListResponseSchema>;
