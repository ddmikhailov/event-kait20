import type {
  FormFieldResponse,
  RegistrationDetailResponse,
} from '@event-registration/contracts';
import { describe, expect, it } from 'vitest';

import {
  onsiteValues,
  ParticipantFormError,
  participantDefaults,
  personUpdateValues,
  registrationUpdateValues,
} from './participant-values.js';

describe('participant administration values', () => {
  it('builds the same validated snapshot shape for registration and Person edits', () => {
    const form = participantForm();
    expect(registrationUpdateValues(form)).toMatchObject({
      lastName: 'Иванов',
      phone: '+79990000000',
      studyGroup: 'ИС-21',
      organization: null,
    });
    expect(personUpdateValues(form)).toEqual(registrationUpdateValues(form));
  });

  it('builds typed onsite answers and keeps capacity override explicit', () => {
    const form = participantForm();
    form.set('capacityOverride', 'on');
    form.set('field-10000000-0000-4000-8000-000000000001', 'Разработка');
    form.append('field-20000000-0000-4000-8000-000000000001', 'Утро');
    form.append('field-20000000-0000-4000-8000-000000000001', 'День');
    form.set('field-30000000-0000-4000-8000-000000000001', 'on');

    const values = onsiteValues(form, [
      field('10000000-0000-4000-8000-000000000001', 'SINGLE_CHOICE'),
      field('20000000-0000-4000-8000-000000000001', 'MULTI_CHOICE'),
      field('30000000-0000-4000-8000-000000000001', 'BOOLEAN'),
    ]);

    expect(values.capacityOverride).toBe(true);
    expect(values.customAnswers).toEqual([
      {
        fieldId: '10000000-0000-4000-8000-000000000001',
        value: 'Разработка',
      },
      {
        fieldId: '20000000-0000-4000-8000-000000000001',
        value: ['Утро', 'День'],
      },
      {
        fieldId: '30000000-0000-4000-8000-000000000001',
        value: true,
      },
    ]);
  });

  it('reads defaults without mixing historical answers into editable identity fields', () => {
    const registration = {
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: null,
      birthDate: '2007-03-10',
      email: 'participant@example.test',
      phone: '+79990000000',
      studyGroup: 'ИС-21',
      personType: 'KAIT_STUDENT',
      organization: null,
    } as RegistrationDetailResponse;
    expect(participantDefaults(registration)).toEqual({
      ...registration,
      middleName: '',
      organization: '',
    });
  });

  it('rejects a missing required multi-choice answer before sending', () => {
    expect(() =>
      onsiteValues(participantForm(), [
        {
          ...field('20000000-0000-4000-8000-000000000001', 'MULTI_CHOICE'),
          required: true,
        },
      ]),
    ).toThrow(ParticipantFormError);
  });
});

const participantForm = (): FormData => {
  const form = new FormData();
  form.set('lastName', 'Иванов');
  form.set('firstName', 'Иван');
  form.set('middleName', '');
  form.set('birthDate', '2007-03-10');
  form.set('email', 'participant@example.test');
  form.set('phone', '8 999 000-00-00');
  form.set('studyGroup', 'ИС-21');
  form.set('personType', 'KAIT_STUDENT');
  form.set('organization', '');
  return form;
};

const field = (
  id: string,
  type: FormFieldResponse['type'],
): FormFieldResponse => ({
  id,
  eventId: '40000000-0000-4000-8000-000000000001',
  type,
  label: 'Вопрос',
  required: false,
  sortOrder: 0,
  options: type.includes('CHOICE') ? ['Разработка', 'Утро', 'День'] : null,
  active: true,
  createdAt: '2026-08-24T10:00:00.000Z',
  updatedAt: '2026-08-24T10:00:00.000Z',
});
