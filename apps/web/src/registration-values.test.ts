import { describe, expect, it } from 'vitest';

import type { PublicEventResponse } from '@event-registration/contracts';

import {
  RegistrationFormError,
  registrationValues,
} from './registration-values.js';

const event: PublicEventResponse = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'День открытых дверей',
  slug: 'open-day',
  description: null,
  coverObjectKey: null,
  startAt: '2026-09-01T07:00:00.000Z',
  endAt: '2026-09-01T10:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'Главный корпус',
  availability: 'OPEN',
  consentUrl: 'https://example.test/consent',
  consentVersion: 'consent-v1',
  formFields: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      type: 'MULTI_CHOICE',
      label: 'Интересы',
      required: true,
      sortOrder: 1,
      options: ['Разработка', 'Робототехника'],
    },
  ],
};

const validForm = () => {
  const form = new FormData();
  form.set('lastName', 'Иванов');
  form.set('firstName', 'Иван');
  form.set('birthDate', '2008-05-12');
  form.set('email', 'student@example.test');
  form.set('phone', '8 (999) 000-00-00');
  form.set('personType', 'KAIT_STUDENT');
  form.set('studyGroup', 'ИС-101');
  form.set('consentAccepted', 'on');
  form.append(`field-${event.formFields[0]!.id}`, 'Разработка');
  return form;
};

describe('public registration form values', () => {
  it('uses the rendered consent version and typed custom answers', () => {
    expect(registrationValues(validForm(), event)).toMatchObject({
      phone: '+79990000000',
      consentAccepted: true,
      consentVersion: 'consent-v1',
      customAnswers: [
        { fieldId: event.formFields[0]!.id, value: ['Разработка'] },
      ],
    });
  });

  it('rejects a missing required multi-choice answer before transmission', () => {
    const form = validForm();
    form.delete(`field-${event.formFields[0]!.id}`);

    expect(() => registrationValues(form, event)).toThrow(
      RegistrationFormError,
    );
  });

  it('rejects missing consent and conditional participant fields', () => {
    const form = validForm();
    form.delete('consentAccepted');
    form.delete('studyGroup');

    expect(() => registrationValues(form, event)).toThrow(
      'Проверьте обязательные поля формы',
    );
  });
});
