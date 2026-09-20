import { z } from 'zod';

export const systemFieldKeySchema = z.enum([
  'middleName',
  'birthDate',
  'email',
  'phone',
  'personType',
  'studyGroup',
  'organization',
]);
export const systemFieldModeSchema = z.enum(['HIDDEN', 'OPTIONAL', 'REQUIRED']);
export const systemFieldSchema = z
  .object({ key: systemFieldKeySchema, mode: systemFieldModeSchema })
  .strict();
export const systemFieldsSchema = z
  .array(systemFieldSchema)
  .length(7)
  .refine((fields) => new Set(fields.map((field) => field.key)).size === 7);
export const registrationFormConfigSchema = z
  .object({ public: systemFieldsSchema, onsite: systemFieldsSchema })
  .strict();
export type SystemFields = z.infer<typeof systemFieldsSchema>;
export type RegistrationFormConfig = z.infer<
  typeof registrationFormConfigSchema
>;
export const systemFieldLabels: Record<
  z.infer<typeof systemFieldKeySchema>,
  string
> = {
  middleName: 'Отчество',
  birthDate: 'Дата рождения',
  email: 'Email',
  phone: 'Телефон',
  personType: 'Статус участника',
  studyGroup: 'Учебная группа',
  organization: 'Образовательная организация',
};
export const defaultSystemFields = (
  mode: 'public' | 'onsite',
  legacy = false,
): SystemFields =>
  systemFieldKeySchema.options.map((key) => ({
    key,
    mode:
      legacy &&
      ([
        'birthDate',
        'phone',
        'personType',
        'studyGroup',
        'organization',
      ].includes(key) ||
        (mode === 'public' && key === 'email'))
        ? 'REQUIRED'
        : 'OPTIONAL',
  }));
export const missingSystemField = (
  values: Record<string, unknown>,
  fields: SystemFields,
  restricted = false,
): z.infer<typeof systemFieldKeySchema> | undefined => {
  const type = String(values.personType ?? 'OTHER');
  return fields.find(({ key, mode }) => {
    if (key === 'studyGroup' && type !== 'KAIT_STUDENT') return false;
    if (key === 'organization' && !type.startsWith('EXTERNAL_')) return false;
    return (
      (mode === 'REQUIRED' || (key === 'personType' && restricted)) &&
      !values[key]
    );
  })?.key;
};
