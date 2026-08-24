import {
  adminOnsiteRegistrationRequestSchema,
  updatePersonRequestSchema,
  updateRegistrationRequestSchema,
  type AdminOnsiteRegistrationRequest,
  type FormFieldResponse,
  type PersonDetailResponse,
  type RegistrationDetailResponse,
  type UpdatePersonRequest,
  type UpdateRegistrationRequest,
} from '@event-registration/contracts';

export const registrationUpdateValues = (
  form: FormData,
): UpdateRegistrationRequest =>
  updateRegistrationRequestSchema.parse(personValues(form));

export const personUpdateValues = (form: FormData): UpdatePersonRequest =>
  updatePersonRequestSchema.parse(personValues(form));

export class ParticipantFormError extends Error {
  public override readonly name = 'PARTICIPANT_FORM_ERROR';
}

export const onsiteValues = (
  form: FormData,
  fields: FormFieldResponse[],
): AdminOnsiteRegistrationRequest => {
  const activeFields = fields.filter((field) => field.active);
  const customAnswers = activeFields
    .map((field) => answerValue(form, field))
    .filter((answer) => answer !== undefined);
  const answeredIds = new Set(customAnswers.map((answer) => answer.fieldId));
  const missing = activeFields.find(
    (field) => field.required && !answeredIds.has(field.id),
  );
  if (missing) {
    throw new ParticipantFormError(`Ответьте на вопрос «${missing.label}»`);
  }
  return adminOnsiteRegistrationRequestSchema.parse({
    ...personValues(form),
    birthDate: text(form, 'birthDate'),
    phone: text(form, 'phone'),
    email: optionalText(form, 'email'),
    capacityOverride: form.get('capacityOverride') === 'on',
    customAnswers,
  });
};

export const participantDefaults = (
  participant?: RegistrationDetailResponse | PersonDetailResponse,
) => ({
  lastName: participant?.lastName ?? '',
  firstName: participant?.firstName ?? '',
  middleName: participant?.middleName ?? '',
  birthDate: participant?.birthDate ?? '',
  email: participant?.email ?? '',
  phone: participant?.phone ?? '',
  studyGroup: participant?.studyGroup ?? '',
  personType: participant?.personType ?? 'KAIT_STUDENT',
  organization: participant?.organization ?? '',
});

const personValues = (form: FormData) => ({
  lastName: text(form, 'lastName'),
  firstName: text(form, 'firstName'),
  middleName: optionalText(form, 'middleName'),
  birthDate: optionalText(form, 'birthDate'),
  email: optionalText(form, 'email'),
  phone: optionalText(form, 'phone'),
  studyGroup: optionalText(form, 'studyGroup'),
  personType: text(form, 'personType'),
  organization: optionalText(form, 'organization'),
});

const answerValue = (form: FormData, field: FormFieldResponse) => {
  const name = `field-${field.id}`;
  if (field.type === 'BOOLEAN') {
    return { fieldId: field.id, value: form.get(name) === 'on' };
  }
  if (field.type === 'MULTI_CHOICE') {
    const values = form.getAll(name).map(String);
    return values.length > 0 ? { fieldId: field.id, value: values } : undefined;
  }
  const value = text(form, name);
  return value ? { fieldId: field.id, value } : undefined;
};

const text = (form: FormData, key: string): string =>
  String(form.get(key) ?? '').trim();

const optionalText = (form: FormData, key: string): string | null =>
  text(form, key) || null;
