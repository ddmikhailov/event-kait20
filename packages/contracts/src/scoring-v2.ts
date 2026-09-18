import { z } from 'zod';

import { uuidSchema } from './common.js';

export const decimalScoreSchema = z.string().regex(/^-?\d{1,8}(\.\d{1,4})?$/);
export const policyCreateSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/),
    name: z.string().trim().min(1).max(150),
  })
  .strict();
export const scoringComponentSchema = z
  .object({ classifierId: uuidSchema, value: decimalScoreSchema })
  .strict();
export const newcomerTierSchema = z
  .object({
    sequenceFrom: z.number().int().positive(),
    sequenceTo: z.number().int().positive().nullable().optional(),
    value: decimalScoreSchema,
  })
  .strict();
export const policyVersionValuesSchema = z
  .object({
    roleBases: z.array(scoringComponentSchema),
    levelMultipliers: z.array(scoringComponentSchema),
    statusMultipliers: z.array(scoringComponentSchema).default([]),
    newcomerTiers: z.array(newcomerTierSchema),
    resultBonuses: z.array(scoringComponentSchema).default([]),
  })
  .strict();
export const publishPolicyVersionSchema = z
  .object({
    effectiveFrom: z.iso.datetime({ offset: true }),
    effectiveTo: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export const assignScoringPolicySchema = z
  .object({
    scoringPolicyId: uuidSchema.nullable(),
    effectiveFrom: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.scoringPolicyId === null) === (value.effectiveFrom === null),
    'Policy and activation boundary must be set together',
  );
export const scoringPreviewRequestSchema = z
  .object({
    participationId: uuidSchema,
    policyVersionId: uuidSchema.nullable().optional(),
  })
  .strict();
export const policyVersionStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'RETIRED',
  'CANCELLED',
]);
const snapshotComponentSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    value: z.string().regex(/^-?\d+\.\d{4}$/),
  })
  .strict();
export const calculationSnapshotSchema = z
  .object({
    snapshotSchemaVersion: z.literal(1),
    engineVersion: z.literal('V2'),
    scoringPolicyId: uuidSchema,
    policyVersionId: uuidSchema,
    policyVersion: z.number().int().positive(),
    policyVersionStatus: policyVersionStatusSchema,
    eventId: uuidSchema,
    eventStartAt: z.iso
      .datetime({ offset: true })
      .refine((value) => value.endsWith('Z'), 'eventStartAt must be UTC'),
    eventMoscowDate: z.iso.date(),
    seasonId: uuidSchema,
    participationId: uuidSchema,
    personId: uuidSchema,
    role: snapshotComponentSchema,
    level: snapshotComponentSchema,
    statuses: z.array(snapshotComponentSchema),
    newcomer: z.object({
      sequence: z.number().int().positive(),
      value: z.string().regex(/^\d+\.\d{4}$/),
    }),
    result: snapshotComponentSchema.nullable(),
    multiplicativeSubtotal: z.string().regex(/^-?\d+\.\d{4}$/),
    resultBonus: z.string().regex(/^-?\d+\.\d{4}$/),
    finalPoints: z.string().regex(/^-?\d+\.\d{4}$/),
    roundingMode: z.literal('ROUND_HALF_UP'),
    calculatedAt: z.iso.datetime({ offset: true }),
  })
  .passthrough();
export const scoringPreviewResponseSchema = z
  .object({
    points: z.string().regex(/^-?\d+\.\d{4}$/),
    policyVersionId: uuidSchema,
    policyVersionStatus: policyVersionStatusSchema,
    calculation: calculationSnapshotSchema,
  })
  .strict();
export const statusAssignmentSchema = z
  .object({
    statusTypeId: uuidSchema,
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable().optional(),
  })
  .strict();

export type PolicyCreate = z.infer<typeof policyCreateSchema>;
export type PolicyVersionValues = z.infer<typeof policyVersionValuesSchema>;
export type ScoringPreviewRequest = z.infer<typeof scoringPreviewRequestSchema>;
export type ScoringPreviewResponse = z.infer<
  typeof scoringPreviewResponseSchema
>;
