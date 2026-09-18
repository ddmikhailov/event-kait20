import { z } from 'zod';

export const uuidSchema = z.uuid();
export const personTypeSchema = z.enum([
  'KAIT_STUDENT',
  'KAIT_TEACHER',
  'EXTERNAL_STUDENT',
  'EXTERNAL_TEACHER',
  'PARENT',
  'OTHER',
]);
export type PersonType = z.infer<typeof personTypeSchema>;
export const personTypeLabels: Record<
  z.infer<typeof personTypeSchema>,
  string
> = {
  KAIT_STUDENT: 'Студент КАИТ №20',
  KAIT_TEACHER: 'Сотрудник КАИТ №20',
  EXTERNAL_STUDENT: 'Студент другой организации',
  EXTERNAL_TEACHER: 'Сотрудник другой организации',
  PARENT: 'Родитель',
  OTHER: 'Другое',
};
export const allowedPersonTypesSchema = z
  .array(personTypeSchema)
  .min(1)
  .max(6)
  .refine((types) => new Set(types).size === types.length)
  .nullable();
export const emailSchema = z
  .string()
  .trim()
  .pipe(z.email().max(320))
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const errorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'AUTH_LINK_INVALID',
  'ORIGIN_NOT_TRUSTED',
  'CSRF_INVALID',
  'EVENT_NOT_FOUND',
  'INVALID_EVENT_STATE',
  'INVALID_TIME_RANGE',
  'CAPACITY_BELOW_ACTIVE_REGISTRATIONS',
  'REGISTRATION_CLOSED',
  'CAPACITY_FULL',
  'STREAM_REQUIRED',
  'STREAM_INVALID',
  'STREAM_ALREADY_SELECTED',
  'STREAM_HISTORY_CONFLICT',
  'PARTICIPANT_TYPE_NOT_ALLOWED',
  'ALREADY_REGISTERED',
  'REGISTRATION_ANNULLED',
  'REGISTRATION_NOT_FOUND',
  'FORM_VERSION_INVALID',
  'REQUEST_ALREADY_USED',
  'INVALID_QR',
  'SERVICE_UNAVAILABLE',
  'INVALID_REFERENCE',
  'REFERENCE_CONFLICT',
  'SEASON_CONFLICT',
  'SEASON_NOT_FOUND',
  'SCORING_RULE_NOT_FOUND',
  'SCORING_RULE_CONFLICT',
  'SCORING_RULE_AMBIGUOUS',
  'ORGANIZATION_NOT_FOUND',
  'DEPARTMENT_NOT_FOUND',
  'STUDY_GROUP_NOT_FOUND',
  'DIRECTION_NOT_FOUND',
  'DIRECTION_INACTIVE',
  'DIRECTION_AMBIGUOUS',
  'CROSS_TENANT_REFERENCE',
  'ORGANIZATION_SCOPE_MISMATCH',
  'PARTICIPATION_NOT_FOUND',
  'PARTICIPATION_NOT_CONFIRMED',
  'PARTICIPATION_ROLE_REQUIRED',
  'ATTENDANCE_REQUIRED',
  'PERSON_NOT_FOUND',
  'PERSON_MISMATCH',
  'PUBLICATION_CONSENT_REQUIRED',
  'PROFILE_NOT_FOUND',
  'PROFILE_SECTION_NOT_FOUND',
  'ACHIEVEMENT_NOT_FOUND',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const acceptedResponseSchema = z.object({
  status: z.literal('accepted'),
  role: z.enum(['SUPER_ADMIN', 'ORGANIZER', 'SCANNER']).optional(),
});
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
