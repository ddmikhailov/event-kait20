import { describe, expect, it } from 'vitest';

import type { PublicEventResponse } from '@event-registration/contracts';
import { defaultSystemFields } from '@event-registration/contracts';

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
  privacyPolicyUrl: 'https://example.test/privacy-policy',
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
  it('accepts names and consent when optional fields are blank', () => {
    const form = new FormData();
    form.set('firstName', 'Анна');
    form.set('lastName', 'Родитель');
    form.set('consentAccepted', 'on');
    form.set('requestId', '12345678-1111-4111-8111-123456789012');
    expect(
      registrationValues(form, {
        ...event,
        systemFields: defaultSystemFields('public'),
        formFields: [],
      }),
    ).toMatchObject({
      phone: null,
      email: null,
      birthDate: null,
      personType: null,
    });
  });
  it('enforces organiser requirements and accepts an explicit No answer', () => {
    const form = validForm();
    form.set(`field-${event.formFields[0]!.id}`, 'false');
    const configured = {
      ...event,
      formFields: [{ ...event.formFields[0]!, type: 'BOOLEAN' as const }],
    };
    expect(registrationValues(form, configured).customAnswers[0]?.value).toBe(
      false,
    );
    form.delete('email');
    expect(() => registrationValues(form, configured)).toThrow('Email');
  });
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

  it('never sends a stale study group for participants outside KAIT students', () => {
    const form = validForm();
    form.set('personType', 'EXTERNAL_TEACHER');
    form.set('organization', 'Другая образовательная организация');

    expect(registrationValues(form, event).studyGroup).toBeNull();
  });

  it.each(['PARENT', 'OTHER'] as const)(
    'accepts %s without group or organization and drops stale values',
    (personType) => {
      const form = validForm();
      form.set('personType', personType);
      form.set('organization', 'Не должно сохраниться');

      expect(registrationValues(form, event)).toMatchObject({
        personType,
        studyGroup: null,
        organization: null,
      });
    },
  );
});
