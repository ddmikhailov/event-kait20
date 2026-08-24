import { z } from 'zod';

import { uuidSchema } from './common.js';
import { personTypeSchema } from './registrations.js';

export const excelImportMappingSchema = z
  .object({
    lastName: z.string().min(1),
    firstName: z.string().min(1),
    middleName: z.string().min(1).optional(),
    birthDate: z.string().min(1),
    personType: z.string().min(1),
    studyGroup: z.string().min(1).optional(),
    organization: z.string().min(1).optional(),
    phone: z.string().min(1),
    email: z.string().min(1).optional(),
    customFields: z.record(uuidSchema, z.string().min(1)).default({}),
  })
  .strict();
export type ExcelImportMapping = z.infer<typeof excelImportMappingSchema>;

export const excelImportCategorySchema = z.enum([
  'NEW',
  'ALREADY_REGISTERED',
  'POSSIBLE_MATCH',
  'ERROR',
]);

const excelCandidateSchema = z.object({
  personId: uuidSchema,
  displayName: z.string(),
  matchReason: z.enum(['STRONG_IDENTIFIER', 'PROFILE_SIMILARITY']),
});

const excelParticipantPreviewSchema = z.object({
  lastName: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  birthDate: z.iso.date().nullable(),
  personType: personTypeSchema.nullable(),
  studyGroup: z.string().nullable(),
  organization: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});

export const excelImportSummarySchema = z.object({
  totalRows: z.number().int().nonnegative(),
  newRows: z.number().int().nonnegative(),
  alreadyRegisteredRows: z.number().int().nonnegative(),
  possibleMatchRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  withoutEmailRows: z.number().int().nonnegative(),
  capacityImpact: z.number().int().nonnegative(),
  activeRegistrations: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  exceedsCapacity: z.boolean(),
});

export const excelImportPreviewResponseSchema = z.object({
  importJobId: uuidSchema,
  expiresAt: z.iso.datetime({ offset: true }),
  headers: z.array(z.string()),
  mapping: excelImportMappingSchema,
  summary: excelImportSummarySchema,
  rows: z.array(
    z.object({
      rowNumber: z.number().int().positive(),
      category: excelImportCategorySchema,
      errors: z.array(z.string()),
      participant: excelParticipantPreviewSchema,
      candidates: z.array(excelCandidateSchema),
    }),
  ),
});
export type ExcelImportPreviewResponse = z.infer<
  typeof excelImportPreviewResponseSchema
>;

export const excelImportDecisionSchema = z
  .object({
    rowNumber: z.number().int().min(2),
    action: z.enum(['SKIP', 'CREATE_NEW', 'USE_PERSON']),
    personId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'USE_PERSON' && !value.personId) {
      context.addIssue({
        code: 'custom',
        path: ['personId'],
        message: 'personId is required for USE_PERSON',
      });
    }
    if (value.action !== 'USE_PERSON' && value.personId) {
      context.addIssue({
        code: 'custom',
        path: ['personId'],
        message: 'personId is only allowed for USE_PERSON',
      });
    }
  });
export type ExcelImportDecision = z.infer<typeof excelImportDecisionSchema>;

export const excelImportCommitRequestSchema = z
  .object({
    mapping: excelImportMappingSchema,
    decisions: z.array(excelImportDecisionSchema).max(5_000).default([]),
    capacityOverride: z.boolean().default(false),
  })
  .strict();
export type ExcelImportCommitRequest = z.infer<
  typeof excelImportCommitRequestSchema
>;

export const excelImportCommitResponseSchema = z.object({
  importJobId: uuidSchema,
  importedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  withoutEmailRows: z.number().int().nonnegative(),
});
export type ExcelImportCommitResponse = z.infer<
  typeof excelImportCommitResponseSchema
>;
