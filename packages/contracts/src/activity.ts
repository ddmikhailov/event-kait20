import { z } from 'zod';

import { uuidSchema } from './common.js';
import { decimalScoreSchema } from './scoring-v2.js';

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
    eventTitle: z.string(),
    eventStartAt: z.iso.datetime({ offset: true }),
    seasonId: uuidSchema.nullable(),
    seasonName: z.string().nullable(),
    directionId: uuidSchema.nullable(),
    directionName: z.string().nullable(),
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

export const eventReviewItemSchema = z.object({
  registrationId: uuidSchema,
  lastName: z.string(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  studyGroup: z.string().nullable(),
  personType: z.string(),
  scannerFirstAttendedAt: z.iso.datetime({ offset: true }).nullable(),
  attendanceDecision: z.enum(['PRESENT', 'ABSENT']),
  attendanceChangedSinceReview: z.boolean(),
  roleId: uuidSchema,
  roleName: z.string(),
  resultId: uuidSchema.nullable(),
  resultName: z.string().nullable(),
  matchState: z.enum([
    'NOT_APPLICABLE',
    'MATCHED',
    'UNMATCHED',
    'AMBIGUOUS',
    'REJECTED',
  ]),
  rosterPersonId: uuidSchema.nullable(),
  decisionReason: z.string().nullable(),
  reviewedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const eventReviewSchema = z.object({
  eventId: uuidSchema,
  title: z.string(),
  state: z.enum(['NOT_STARTED', 'PENDING', 'APPROVED']),
  items: z.array(eventReviewItemSchema),
});
export const eventReviewDecisionSchema = z.object({
  attendanceDecision: z.enum(['PRESENT', 'ABSENT']),
  roleId: uuidSchema,
  resultId: uuidSchema.nullable(),
  rosterPersonId: uuidSchema.nullable(),
  rejectMatch: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
export const eventReviewApprovalSchema = z.object({
  registered: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  awarded: z.number().int().nonnegative(),
});
export const pendingEventReviewsSchema = z.object({
  items: z.array(z.object({ id: uuidSchema, title: z.string() })),
});
export const rosterSearchSchema = z.object({
  items: z.array(
    z.object({
      id: uuidSchema,
      lastName: z.string(),
      firstName: z.string(),
      middleName: z.string().nullable(),
      studyGroup: z.string().nullable(),
    }),
  ),
});
export type EventReview = z.infer<typeof eventReviewSchema>;
export type EventReviewDecision = z.infer<typeof eventReviewDecisionSchema>;
export type EventReviewApproval = z.infer<typeof eventReviewApprovalSchema>;
export type PendingEventReviews = z.infer<typeof pendingEventReviewsSchema>;
export type RosterSearch = z.infer<typeof rosterSearchSchema>;

export const rosterPreviewSchema = z
  .object({
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    students: z.number().int().positive().max(5000),
  })
  .strict();
export type RosterPreview = z.infer<typeof rosterPreviewSchema>;
export const rosterImportSchema = z
  .object({
    created: z.number().int().positive().max(5000),
  })
  .strict();
export type RosterImport = z.infer<typeof rosterImportSchema>;

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
export type StudentMembershipList = z.infer<typeof studentMembershipListSchema>;

export const studentMembershipTransferRequestSchema = z
  .object({
    studyGroupId: uuidSchema,
    effectiveFrom: z.iso.date(),
  })
  .strict();
export const studentMembershipTransferResponseSchema = z
  .object({
    previous: studentMembershipSchema,
    current: studentMembershipSchema,
  })
  .strict();
export const studentMembershipCloseRequestSchema = z
  .object({ lastValidOn: z.iso.date() })
  .strict();
export type StudentMembershipTransferRequest = z.infer<
  typeof studentMembershipTransferRequestSchema
>;
export type StudentMembershipTransferResponse = z.infer<
  typeof studentMembershipTransferResponseSchema
>;
export type StudentMembershipCloseRequest = z.infer<
  typeof studentMembershipCloseRequestSchema
>;

export const publicProfileSchema = z
  .object({
    publicSlug: z.string(),
    displayName: z.string().optional(),
    studyGroup: z.string().nullable().optional(),
    totalPoints: z
      .string()
      .regex(/^-?\d+\.\d{4}$/)
      .optional(),
    confirmedParticipations: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const publicStudentSchema = publicProfileSchema.extend({
  displayName: z.string(),
  achievements: z.number().int().nonnegative().optional(),
});
export const publicStudentListSchema = z
  .object({
    items: z.array(publicStudentSchema),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export type PublicStudentList = z.infer<typeof publicStudentListSchema>;

export const publicParticipationListSchema = z
  .object({
    items: z.array(
      z
        .object({
          eventTitle: z.string(),
          eventStartAt: z.string(),
          role: z.string().nullable(),
          result: z.string().nullable(),
          points: z
            .string()
            .regex(/^-?\d+\.\d{4}$/)
            .nullable(),
        })
        .strict(),
    ),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type PublicParticipationList = z.infer<
  typeof publicParticipationListSchema
>;

export const publicAchievementListSchema = z
  .object({
    items: z.array(
      z
        .object({
          title: z.string(),
          type: z.string(),
          occurredAt: z.string(),
        })
        .strict(),
    ),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type PublicAchievementList = z.infer<typeof publicAchievementListSchema>;

export const leaderboardResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          rank: z.number().int().positive(),
          publicSlug: z.string(),
          displayName: z.string(),
          studyGroup: z.string().nullable().optional(),
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

export const publicLeaderboardSeasonsSchema = z
  .object({
    items: z.array(
      z
        .object({ id: uuidSchema, name: z.string(), active: z.boolean() })
        .strict(),
    ),
  })
  .strict();
export type PublicLeaderboardSeasons = z.infer<
  typeof publicLeaderboardSeasonsSchema
>;

export const publicScoreTransactionListSchema = z
  .object({
    items: z.array(
      z
        .object({
          seasonName: z.string(),
          type: z.enum([
            'AWARD',
            'REVERSAL',
            'MANUAL_ADJUSTMENT',
            'LEGACY_IMPORT',
          ]),
          points: z.string().regex(/^-?\d+\.\d{4}$/),
          createdAt: z.string(),
          eventTitle: z.string().nullable(),
        })
        .strict(),
    ),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type PublicScoreTransactionList = z.infer<
  typeof publicScoreTransactionListSchema
>;

export const profilePublicationFieldSchema = z.enum([
  'NAME',
  'STUDY_GROUP',
  'ORGANIZATION',
  'PARTICIPATIONS',
  'ACHIEVEMENTS',
  'SCORES',
]);
export const adminStudentProfileSchema = z
  .object({
    id: uuidSchema.nullable(),
    personId: uuidSchema,
    publicSlug: z.string().nullable(),
    visibility: z.enum(['PRIVATE', 'LINK_ONLY', 'PUBLIC']),
    consent: z
      .object({
        consentVersion: z.string(),
        allowedFields: z.array(profilePublicationFieldSchema),
        acceptedAt: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const profileConsentRequestSchema = z
  .object({
    consentVersion: z.string().trim().min(1).max(100),
    allowedFields: z.array(profilePublicationFieldSchema).min(1).max(6),
    source: z.literal('ADMIN'),
  })
  .strict();
export type AdminStudentProfile = z.infer<typeof adminStudentProfileSchema>;
export type ProfileConsentRequest = z.infer<typeof profileConsentRequestSchema>;

const personActivityRoleRefSchema = z
  .object({ code: z.string(), name: z.string() })
  .strict();
export const personActivityParticipationSchema = z
  .object({
    id: uuidSchema,
    eventId: uuidSchema,
    eventTitle: z.string(),
    eventStartAt: z.iso.datetime({ offset: true }),
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']),
    scoringState: z.enum(['NOT_SCORED', 'AWARDED', 'NO_RULE', 'REVERSED']),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
    role: personActivityRoleRefSchema.nullable(),
    result: personActivityRoleRefSchema.nullable(),
    points: decimalScoreSchema,
  })
  .strict();

export const achievementStatusSchema = z.enum([
  'DRAFT',
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'CANCELLED',
]);
export const achievementSourceSchema = z.enum([
  'EVENT_KAIT20',
  'MANUAL',
  'IMPORT',
  'EXTERNAL_SYSTEM',
]);
export const personAchievementSchema = z
  .object({
    id: uuidSchema,
    title: z.string(),
    description: z.string().nullable(),
    type: activityCodeSchema,
    status: achievementStatusSchema,
    source: achievementSourceSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    eventId: uuidSchema.nullable(),
    eventTitle: z.string().nullable(),
    eventStartAt: z.iso.datetime({ offset: true }).nullable(),
    participationId: uuidSchema.nullable(),
    participationRole: personActivityRoleRefSchema.nullable(),
    participationResult: personActivityRoleRefSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type PersonAchievement = z.infer<typeof personAchievementSchema>;

export const achievementCreateRequestSchema = z
  .object({
    personId: uuidSchema,
    eventId: uuidSchema.nullable().optional(),
    participationId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(1).max(255),
    description: z.string().max(20_000).nullable().optional(),
    achievementType: activityCodeSchema,
    source: achievementSourceSchema,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type AchievementCreateRequest = z.infer<
  typeof achievementCreateRequestSchema
>;
export const achievementMutationResponseSchema = z
  .object({ id: uuidSchema, status: achievementStatusSchema })
  .strict();
export type AchievementMutationResponse = z.infer<
  typeof achievementMutationResponseSchema
>;

export const achievementDecisionRequestSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED', 'CANCELLED']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type AchievementDecisionRequest = z.infer<
  typeof achievementDecisionRequestSchema
>;

// Stage 4.4: reads and displays the ledger, so this is now precisely typed
// (was `z.record()`) - matching only the fields the Manual Adjustment admin
// actually uses, not a full re-model of every score_transactions column.
export const scoreTransactionTypeSchema = z.enum([
  'AWARD',
  'REVERSAL',
  'MANUAL_ADJUSTMENT',
]);
export const personScoreTransactionSchema = z
  .object({
    id: uuidSchema,
    seasonId: uuidSchema,
    seasonName: z.string(),
    type: scoreTransactionTypeSchema,
    points: decimalScoreSchema,
    reason: z.string().nullable(),
    participationId: uuidSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type PersonScoreTransaction = z.infer<
  typeof personScoreTransactionSchema
>;
export const personScoreSummarySchema = z
  .object({
    seasonId: uuidSchema,
    seasonName: z.string(),
    points: decimalScoreSchema,
  })
  .strict();
export type PersonScoreSummary = z.infer<typeof personScoreSummarySchema>;

export const personActivityResponseSchema = z
  .object({
    participations: z.array(personActivityParticipationSchema),
    scoreTransactions: z.array(personScoreTransactionSchema),
    scoreSummary: z.array(personScoreSummarySchema),
    achievements: z.array(personAchievementSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type PersonActivityParticipation = z.infer<
  typeof personActivityParticipationSchema
>;
export type PersonActivityResponse = z.infer<
  typeof personActivityResponseSchema
>;

// A decimal string, never a JS number - the same convention as every other
// canonical score value in this file. Every check here (zero, decimal
// places, magnitude) is regex/string-comparison based, never
// `Number(value)`/`parseFloat`, so no floating-point conversion ever
// touches the value being validated.
//
// Mirrors the backend's actual Pydantic constraint exactly:
// `ManualAdjustmentRequest.points: Decimal = Field(ge=-1_000_000,
// le=1_000_000, decimal_places=4)`, plus a non-zero `model_validator`. The
// integer part is capped at 7 digits with no leading zero (so it can only
// ever be "0" or "1000000"-"9999999" as raw digit strings) specifically so
// magnitude can be compared as same-length digit strings - a magnitude
// this big is always exactly 7 digits once it reaches 1,000,000, so no
// numeric parsing is needed to decide "is this over the limit". The
// frontend is deliberately STRICTER than the backend on formatting
// (no "00.5", no "1.00000" with more than 4 fraction digits) - it never
// accepts anything the backend would reject, which is the only invariant
// that matters here.
const MANUAL_ADJUSTMENT_DECIMAL_PATTERN =
  /^(-)?(0|[1-9]\d{0,6})(?:\.(\d{1,4}))?$/;

const isAllZeroDigits = (digits: string): boolean => /^0*$/.test(digits);

const isManualAdjustmentZero = (
  integerDigits: string,
  fractionDigits: string,
): boolean => integerDigits === '0' && isAllZeroDigits(fractionDigits);

// integerDigits/fractionDigits here are the UNSIGNED magnitude's digit
// strings (the sign is stripped and irrelevant, since the backend's bound
// is symmetric: ge=-1_000_000, le=1_000_000). Any integer part under 7
// digits is always < 1,000,000, so it needs no further check; a 7-digit
// integer part can only be "1000000" through "9999999" per the pattern
// above (no leading zero), so only "1000000" itself can possibly be in
// range, and only when its fraction is entirely zero.
const isManualAdjustmentWithinMagnitude = (
  integerDigits: string,
  fractionDigits: string,
): boolean => {
  if (integerDigits.length < 7) return true;
  if (integerDigits !== '1000000') return false;
  return isAllZeroDigits(fractionDigits);
};

export const manualAdjustmentPointsSchema = z.string().refine((value) => {
  const match = MANUAL_ADJUSTMENT_DECIMAL_PATTERN.exec(value);
  if (!match) return false;
  const [, , integerDigits, fractionDigits = ''] = match;
  if (isManualAdjustmentZero(integerDigits!, fractionDigits)) return false;
  return isManualAdjustmentWithinMagnitude(integerDigits!, fractionDigits);
}, 'Adjustment must be a non-zero decimal between -1,000,000 and 1,000,000 with at most 4 decimal places');

export const manualAdjustmentRequestSchema = z
  .object({
    requestId: uuidSchema,
    personId: uuidSchema,
    seasonId: uuidSchema,
    points: manualAdjustmentPointsSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type ManualAdjustmentRequest = z.infer<
  typeof manualAdjustmentRequestSchema
>;
export const manualAdjustmentResponseSchema = z
  .object({ id: uuidSchema, accepted: z.literal(true) })
  .strict();
export type ManualAdjustmentResponse = z.infer<
  typeof manualAdjustmentResponseSchema
>;
