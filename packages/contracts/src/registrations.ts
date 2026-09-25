import { z } from 'zod';

import {
  allowedPersonTypesSchema,
  emailSchema,
  personTypeSchema,
  uuidSchema,
} from './common.js';
import {
  eventStatusSchema,
  formFieldTypeSchema,
  streamResponseSchema,
} from './events.js';
import { systemFieldsSchema } from './forms.js';

export { personTypeSchema } from './common.js';

export const participantNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value) => value.replace(/\s+/g, ' '));

export const russianPhoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(32)
  .transform((value) => {
    let digits = value.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('9')) digits = `7${digits}`;
    if (digits.length === 11 && digits.startsWith('8'))
      digits = `7${digits.slice(1)}`;
    return `+${digits}`;
  })
  .pipe(z.string().regex(/^\+7\d{10}$/));

const answerValueSchema = z.union([
  z.string().max(20_000),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
]);

export const registrationAnswerRequestSchema = z
  .object({ fieldId: uuidSchema, value: answerValueSchema })
  .strict();

export const publicRegistrationRequestSchema = z
  .object({
    streamId: uuidSchema.nullable().optional(),
    requestId: uuidSchema.optional(),
    lastName: participantNameSchema,
    firstName: participantNameSchema,
    middleName: participantNameSchema.nullable().optional(),
    birthDate: z.iso.date().nullable().optional(),
    email: emailSchema.nullable().optional(),
    phone: russianPhoneSchema.nullable().optional(),
    studyGroup: z.string().trim().min(1).max(100).nullable().optional(),
    personType: personTypeSchema.nullable().optional(),
    organization: z.string().trim().min(1).max(255).nullable().optional(),
    consentAccepted: z.literal(true),
    consentVersion: z.string().trim().min(1).max(255),
    customAnswers: z
      .array(registrationAnswerRequestSchema)
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.customAnswers.map((answer) => answer.fieldId)).size !==
      value.customAnswers.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['customAnswers'],
        message: 'Each form field may be answered only once',
      });
    }
  });

export type PublicRegistrationRequest = z.infer<
  typeof publicRegistrationRequestSchema
>;

const publicFormFieldSchema = z.object({
  id: uuidSchema,
  type: formFieldTypeSchema,
  label: z.string(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  options: z.array(z.string()).nullable(),
});

export const publicEventResponseSchema = z.object({
  levelName: z.string().nullable().optional(),
  boostMultiplier: z.enum(['1.0', '1.5', '2.0', '3.0']).optional(),
  effectiveStatus: eventStatusSchema.optional(),
  registrationDeadline: z.iso.datetime({ offset: true }).optional(),
  systemFields: systemFieldsSchema.optional(),
  streamsEnabled: z.boolean().optional(),
  streams: z.array(streamResponseSchema).optional(),
  allowedPersonTypes: allowedPersonTypesSchema.optional(),
  id: uuidSchema,
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  direction: z.string().nullable().optional(),
  coverObjectKey: z.string().nullable(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  timezone: z.string(),
  location: z.string(),
  availability: z.enum(['OPEN', 'CLOSED', 'FULL']),
  consentUrl: z.url(),
  privacyPolicyUrl: z.url(),
  consentVersion: z.string(),
  formFields: z.array(publicFormFieldSchema),
});
export type PublicEventResponse = z.infer<typeof publicEventResponseSchema>;

const registrationTicketResponseSchema = z
  .object({
    status: z.literal('REGISTERED'),
    registrationId: uuidSchema,
    ticketUrl: z.url(),
  })
  .strict();

export const publicRegistrationResponseSchema = z.discriminatedUnion('status', [
  registrationTicketResponseSchema,
  z
    .object({
      status: z.literal('ALREADY_REGISTERED'),
      recoveryQueued: z.boolean(),
    })
    .strict(),
]);
export type PublicRegistrationResponse = z.infer<
  typeof publicRegistrationResponseSchema
>;

export const ticketResponseSchema = z.object({
  event: z.object({
    streamTitle: z.string().nullable().optional(),
    title: z.string(),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    timezone: z.string(),
    location: z.string(),
  }),
  participantName: z.object({
    lastName: z.string(),
    firstName: z.string(),
    middleName: z.string().nullable(),
  }),
  qrPayload: z.string().min(40).max(500),
});
export type TicketResponse = z.infer<typeof ticketResponseSchema>;

const onsiteRegistrationValuesSchema = z.object({
  consentAccepted: z.literal(true),
  streamId: uuidSchema.nullable().optional(),
  requestId: uuidSchema.optional(),
  lastName: participantNameSchema,
  firstName: participantNameSchema,
  middleName: participantNameSchema.nullable().optional(),
  birthDate: z.iso.date().nullable().optional(),
  email: emailSchema.nullable().optional(),
  phone: russianPhoneSchema.nullable().optional(),
  studyGroup: z.string().trim().min(1).max(100).nullable().optional(),
  personType: personTypeSchema.nullable().optional(),
  organization: z.string().trim().min(1).max(255).nullable().optional(),
  customAnswers: z.array(registrationAnswerRequestSchema).max(100).default([]),
});

const refineOnsiteRegistration = (
  value: z.infer<typeof onsiteRegistrationValuesSchema>,
  context: z.RefinementCtx,
) => {
  if (
    new Set(value.customAnswers.map((answer) => answer.fieldId)).size !==
    value.customAnswers.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['customAnswers'],
      message: 'Each form field may be answered only once',
    });
  }
};

export const scannerOnsiteRegistrationRequestSchema =
  onsiteRegistrationValuesSchema
    .extend({ capacityOverride: z.boolean().optional() })
    .strict()
    .superRefine(refineOnsiteRegistration);
export type ScannerOnsiteRegistrationRequest = z.infer<
  typeof scannerOnsiteRegistrationRequestSchema
>;

export const adminOnsiteRegistrationRequestSchema =
  onsiteRegistrationValuesSchema
    .extend({ capacityOverride: z.boolean().default(false) })
    .strict()
    .superRefine(refineOnsiteRegistration);
export type AdminOnsiteRegistrationRequest = z.infer<
  typeof adminOnsiteRegistrationRequestSchema
>;

export const onsiteRegistrationResponseSchema = z
  .object({
    status: z.enum(['REGISTERED', 'ALREADY_REGISTERED']),
    registrationId: uuidSchema,
    ticketUrl: z.url(),
  })
  .strict();
export type OnsiteRegistrationResponse = z.infer<
  typeof onsiteRegistrationResponseSchema
>;
