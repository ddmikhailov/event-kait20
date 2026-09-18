import { z } from 'zod';

import { uuidSchema } from './common.js';

export const activityCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,49}$/);

export const activityReferenceSchema = z
  .object({
    id: uuidSchema,
    code: activityCodeSchema,
    name: z.string().min(1).max(150),
    description: z.string().max(500).nullable(),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    builtIn: z.boolean(),
  })
  .strict();
export const activityReferenceListSchema = z
  .object({ items: z.array(activityReferenceSchema) })
  .strict();
export type ActivityReference = z.infer<typeof activityReferenceSchema>;
export type ActivityReferenceList = z.infer<typeof activityReferenceListSchema>;

export const activityReferenceValuesSchema = z
  .object({
    code: activityCodeSchema,
    name: z.string().trim().min(1).max(150),
    description: z.string().max(500).nullable().default(null),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type ActivityReferenceValues = z.infer<
  typeof activityReferenceValuesSchema
>;

export const seasonSchema = z
  .object({
    id: uuidSchema,
    code: activityCodeSchema,
    name: z.string().min(1).max(150),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    active: z.boolean(),
    scoringPolicyId: uuidSchema.nullable(),
    scoringPolicyEffectiveFrom: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export const seasonListSchema = z
  .object({ items: z.array(seasonSchema) })
  .strict();
export const seasonValuesSchema = seasonSchema
  .omit({ id: true, scoringPolicyId: true, scoringPolicyEffectiveFrom: true })
  .refine((value) => value.endsAt > value.startsAt, {
    message: 'Season end must be after start',
  });
export type Season = z.infer<typeof seasonSchema>;
export type SeasonList = z.infer<typeof seasonListSchema>;
export type SeasonValues = z.infer<typeof seasonValuesSchema>;

export const scoringRuleSchema = z
  .object({
    id: uuidSchema,
    seasonId: uuidSchema,
    eventCategoryId: uuidSchema.nullable(),
    eventLevelId: uuidSchema.nullable(),
    participationRoleId: uuidSchema.nullable(),
    participationResultId: uuidSchema.nullable(),
    points: z.number().int().min(-1_000_000).max(1_000_000),
    priority: z.number().int().min(0).max(100_000),
    active: z.boolean(),
    validFrom: z.iso.datetime({ offset: true }).nullable(),
    validTo: z.iso.datetime({ offset: true }).nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const scoringRuleListSchema = z
  .object({ items: z.array(scoringRuleSchema) })
  .strict();
export const scoringRuleValuesSchema = scoringRuleSchema
  .omit({ id: true, version: true })
  .refine((value) => value.points !== 0, 'Rule points cannot be zero');
export type ScoringRule = z.infer<typeof scoringRuleSchema>;
export type ScoringRuleList = z.infer<typeof scoringRuleListSchema>;
export type ScoringRuleValues = z.infer<typeof scoringRuleValuesSchema>;

export const participationStatusSchema = z.enum([
  'DRAFT',
  'CONFIRMED',
  'CANCELLED',
]);
export const scoringStateSchema = z.enum([
  'NOT_SCORED',
  'AWARDED',
  'NO_RULE',
  'REVERSED',
]);

const participationReferenceSchema = z
  .object({ id: uuidSchema, code: activityCodeSchema, name: z.string() })
  .strict();

export const participationSchema = z
  .object({
    id: uuidSchema.nullable(),
    registrationId: uuidSchema,
    personId: uuidSchema,
    eventId: uuidSchema,
    streamId: uuidSchema.nullable(),
    status: participationStatusSchema,
    source: z.enum(['ADMIN', 'ATTENDANCE_BULK', 'IMPORT']).nullable(),
    role: participationReferenceSchema.nullable(),
    result: participationReferenceSchema.nullable(),
    scoringState: scoringStateSchema,
    scoringSequence: z.number().int().positive().nullable(),
    scoreAwarded: z.string().regex(/^-?\d+\.\d{4}$/),
    scoreReason: z.string().nullable(),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
    finalizedAt: z.iso.datetime({ offset: true }).nullable(),
    registration: z
      .object({
        lastName: z.string(),
        firstName: z.string(),
        middleName: z.string().nullable(),
        status: z.enum(['ACTIVE', 'ANNULLED']),
        firstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
        studyGroup: z.string().nullable(),
      })
      .strict(),
    streamTitle: z.string().nullable(),
  })
  .strict();

export const participationListSchema = z
  .object({
    items: z.array(participationSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type Participation = z.infer<typeof participationSchema>;
export type ParticipationList = z.infer<typeof participationListSchema>;

export const participationAssignRequestSchema = z
  .object({
    registrationIds: z.array(uuidSchema).min(1).max(500),
    roleId: uuidSchema,
    resultId: uuidSchema.nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type ParticipationAssignRequest = z.infer<
  typeof participationAssignRequestSchema
>;

export const participationConfirmRequestSchema = z
  .object({
    registrationIds: z.array(uuidSchema).min(1).max(500),
    roleId: uuidSchema.nullable().optional(),
    resultId: uuidSchema.nullable().optional(),
    source: z.enum(['ADMIN', 'ATTENDANCE_BULK']).default('ADMIN'),
    confirmWithoutAttendance: z.boolean().default(false),
    overrideReason: z.string().trim().min(3).max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => !value.confirmWithoutAttendance || value.overrideReason,
    'Override reason is required',
  );
export type ParticipationConfirmRequest = z.infer<
  typeof participationConfirmRequestSchema
>;

export const participationCancelRequestSchema = z
  .object({
    participationIds: z.array(uuidSchema).min(1).max(500),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type ParticipationCancelRequest = z.infer<
  typeof participationCancelRequestSchema
>;

export const activityOperationResponseSchema = z
  .object({
    accepted: z.literal(true),
    participationIds: z.array(uuidSchema).optional(),
  })
  .strict();
export type ActivityOperationResponse = z.infer<
  typeof activityOperationResponseSchema
>;

export const studentMembershipValuesSchema = z
  .object({
    studyGroupId: uuidSchema,
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable().default(null),
  })
  .strict()
  .refine(
    (value) => value.validTo === null || value.validTo >= value.validFrom,
    'Membership end cannot be before start',
  );
export const studentMembershipSchema = z
  .object({
    id: uuidSchema,
    personId: uuidSchema,
    organizationId: uuidSchema,
    organization: z.string(),
    departmentId: uuidSchema.nullable(),
    department: z.string().nullable(),
    studyGroupId: uuidSchema.nullable(),
    studyGroup: z.string(),
    course: z.number().int().min(1).max(4).nullable(),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable(),
  })
  .strict()
  .refine(
    (value) => value.validTo === null || value.validTo >= value.validFrom,
    'Membership end cannot be before start',
  );
export const studentMembershipListSchema = z
  .object({ items: z.array(studentMembershipSchema) })
  .strict();
export type StudentMembershipValues = z.infer<
  typeof studentMembershipValuesSchema
>;
export type StudentMembership = z.infer<typeof studentMembershipSchema>;

export const publicProfileSchema = z
  .object({
    publicSlug: z.string(),
    displayName: z.string().optional(),
    studyGroup: z.string().nullable().optional(),
    organization: z.string().nullable().optional(),
    totalPoints: z
      .string()
      .regex(/^-?\d+\.\d{4}$/)
      .optional(),
    confirmedParticipations: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const leaderboardResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          rank: z.number().int().positive(),
          publicSlug: z.string(),
          displayName: z.string(),
          points: z.string().regex(/^-?\d+\.\d{4}$/),
          confirmedParticipations: z.number().int().nonnegative().optional(),
          achievements: z.number().int().nonnegative().optional(),
        })
        .strict(),
    ),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
