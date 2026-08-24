import {
  publicRegistrationRequestSchema,
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
      customAnswers.push({ fieldId: field.id, value: form.has(name) });
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

  const result = publicRegistrationRequestSchema.safeParse({
    lastName: String(form.get('lastName') ?? ''),
    firstName: String(form.get('firstName') ?? ''),
    middleName: optional('middleName'),
    birthDate: String(form.get('birthDate') ?? ''),
    email: String(form.get('email') ?? ''),
    phone: String(form.get('phone') ?? ''),
    studyGroup: optional('studyGroup'),
    personType: String(form.get('personType') ?? ''),
    organization: optional('organization'),
    consentAccepted: form.has('consentAccepted'),
    consentVersion: event.consentVersion,
    customAnswers,
  });
  if (!result.success) {
    throw new RegistrationFormError('Проверьте обязательные поля формы');
  }
  return result.data;
};
