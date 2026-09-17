import { useState } from 'react';
export const BooleanQuestion = ({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required: boolean;
}) => (
  <label>
    {label}
    {required ? ' *' : ''}
    <select name={name} required={required} defaultValue="">
      <option value="">Выберите ответ</option>
      <option value="true">Да</option>
      <option value="false">Нет</option>
    </select>
  </label>
);
import {
  personTypeLabels,
  personTypeSchema,
  systemFieldLabels,
  type SystemFields,
} from '@event-registration/contracts';

export const RegistrationSystemFields = ({
  fields,
  allowedTypes,
  disabled = false,
}: {
  fields: SystemFields;
  allowedTypes?: string[] | null | undefined;
  disabled?: boolean;
}) => {
  const [personType, setPersonType] = useState('');
  const restricted =
    !!allowedTypes && allowedTypes.length < personTypeSchema.options.length;
  const eligible =
    !personType || !restricted || allowedTypes.includes(personType);
  return (
    <fieldset disabled={disabled} className="system-registration-fields">
      <legend>Данные участника</legend>
      <div className="form-grid">
        <label>
          Фамилия *
          <input
            name="lastName"
            required
            maxLength={100}
            autoComplete="family-name"
          />
        </label>
        <label>
          Имя *
          <input
            name="firstName"
            required
            maxLength={100}
            autoComplete="given-name"
          />
        </label>
        {fields.map(({ key, mode }) => {
          const setting =
            key === 'personType' && restricted ? 'REQUIRED' : mode;
          if (
            setting === 'HIDDEN' ||
            (key === 'studyGroup' && personType !== 'KAIT_STUDENT') ||
            (key === 'organization' && !personType.startsWith('EXTERNAL_'))
          )
            return null;
          const required = setting === 'REQUIRED';
          return (
            <label key={key}>
              {systemFieldLabels[key]}
              {required ? ' *' : ''}
              {key === 'personType' ? (
                <>
                  <select
                    name="personType"
                    value={personType}
                    required={required}
                    onChange={(event) => setPersonType(event.target.value)}
                  >
                    <option value="">
                      {required ? 'Выберите статус' : 'Не указан (Другое)'}
                    </option>
                    {personTypeSchema.options.map((type) => (
                      <option key={type} value={type}>
                        {personTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                  {!eligible && (
                    <span role="alert">
                      Мероприятие предназначено только для участников:{' '}
                      {allowedTypes
                        .map(
                          (type) =>
                            personTypeLabels[
                              type as keyof typeof personTypeLabels
                            ],
                        )
                        .join(', ')}
                      .
                    </span>
                  )}
                </>
              ) : (
                <input
                  name={key}
                  type={
                    key === 'email'
                      ? 'email'
                      : key === 'phone'
                        ? 'tel'
                        : key === 'birthDate'
                          ? 'date'
                          : 'text'
                  }
                  required={required}
                  maxLength={
                    key === 'phone'
                      ? 32
                      : key === 'email'
                        ? 320
                        : key === 'organization'
                          ? 255
                          : 100
                  }
                />
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

export const approvedConsentUrl =
  'https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf';
export const approvedPrivacyPolicyUrl =
  'https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf';

export const ConsentCheckbox = ({
  onsite = false,
  consentUrl = approvedConsentUrl,
  privacyPolicyUrl = approvedPrivacyPolicyUrl,
}: {
  onsite?: boolean;
  consentUrl?: string;
  privacyPolicyUrl?: string;
}) => (
  <label className="consent-row">
    <input
      name="consentAccepted"
      type="checkbox"
      required
      defaultChecked={false}
    />
    <span>
      {onsite ? 'Участник подтвердил: «' : ''}Я даю{' '}
      <a href={consentUrl} target="_blank" rel="noopener noreferrer">
        согласие
      </a>{' '}
      и принимаю{' '}
      <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
        политику обработки персональных данных
      </a>
      .{onsite ? '»' : ''}
    </span>
  </label>
);
