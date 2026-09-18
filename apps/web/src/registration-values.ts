import {
  publicRegistrationRequestSchema,
  defaultSystemFields,
  missingSystemField,
  systemFieldLabels,
  personTypeLabels,
  type PublicEventResponse,
  type PublicRegistrationRequest,
} from '@event-registration/contracts';

export class RegistrationFormError extends Error {
  public override readonly name = 'REGISTRATION_FORM_ERROR';
}

export const registrationValues = (
  form: FormData,
  event: PublicEventResponse,
): PublicRegistrationRequest => {
  const optional = (name: string) =>
    String(form.get(name) ?? '').trim() || null;
  const customAnswers: PublicRegistrationRequest['customAnswers'] = [];
  for (const field of event.formFields) {
    const name = `field-${field.id}`;
    if (field.type === 'BOOLEAN') {
      const answer = optional(name);
      if (field.required && !answer)
        throw new RegistrationFormError(`Ответьте на вопрос «${field.label}»`);
      if (answer)
        customAnswers.push({
          fieldId: field.id,
          value: answer === 'true' || answer === 'on',
        });
      continue;
    }
    if (field.type === 'MULTI_CHOICE') {
      const value = form.getAll(name).map(String).filter(Boolean);
      if (field.required && value.length === 0) {
        throw new RegistrationFormError(`Ответьте на вопрос «${field.label}»`);
      }
      if (value.length > 0) customAnswers.push({ fieldId: field.id, value });
      continue;
    }
    const value = optional(name);
    if (field.required && !value) {
      throw new RegistrationFormError(`Ответьте на вопрос «${field.label}»`);
    }
    if (value) customAnswers.push({ fieldId: field.id, value });
  }

  const personType = String(form.get('personType') ?? '');
  const result = publicRegistrationRequestSchema.safeParse({
    streamId: optional('streamId'),
    requestId: optional('requestId') ?? undefined,
    lastName: String(form.get('lastName') ?? ''),
    firstName: String(form.get('firstName') ?? ''),
    middleName: optional('middleName'),
    birthDate: optional('birthDate'),
    email: optional('email'),
    phone: optional('phone'),
    studyGroup: personType === 'KAIT_STUDENT' ? optional('studyGroup') : null,
    personType: personType || null,
    organization: personType.startsWith('EXTERNAL_')
      ? optional('organization')
      : null,
    consentAccepted: form.has('consentAccepted'),
    consentVersion: event.consentVersion,
    customAnswers,
  });
  if (!result.success) {
    throw new RegistrationFormError('Проверьте обязательные поля формы');
  }
  const restricted =
    !!event.allowedPersonTypes && event.allowedPersonTypes.length < 6;
  const missing = missingSystemField(
    result.data,
    event.systemFields ?? defaultSystemFields('public', true),
    restricted,
  );
  if (missing)
    throw new RegistrationFormError(
      `Заполните поле «${systemFieldLabels[missing]}»`,
    );
  if (
    restricted &&
    !event.allowedPersonTypes?.includes(result.data.personType ?? 'OTHER')
  ) {
    throw new RegistrationFormError(
      `Мероприятие предназначено только для участников: ${event.allowedPersonTypes?.map((type) => personTypeLabels[type]).join(', ')}.`,
    );
  }
  return result.data;
};
