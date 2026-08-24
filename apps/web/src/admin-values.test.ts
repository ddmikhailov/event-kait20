import { describe, expect, it } from 'vitest';

import { eventValues, formFieldValues } from './admin-values.js';

describe('admin form values', () => {
  it('builds a contract-valid event payload', () => {
    const form = new FormData();
    form.set('title', 'День открытых дверей');
    form.set('slug', 'open-day');
    form.set('description', 'Описание');
    form.set('coverObjectKey', '');
    form.set('startAt', '2026-09-10T10:00');
    form.set('endAt', '2026-09-10T13:00');
    form.set('registrationDeadline', '2026-09-10T09:00');
    form.set('timezone', 'Europe/Moscow');
    form.set('location', 'Главный корпус');
    form.set('capacity', '250');
    form.set('status', 'DRAFT');

    const values = eventValues(form);
    expect(values.capacity).toBe(250);
    expect(values.coverObjectKey).toBeNull();
    expect(values.startAt).toBe('2026-09-10T07:00:00.000Z');
  });

  it('normalizes choice options and required state', () => {
    const form = new FormData();
    form.set('type', 'MULTI_CHOICE');
    form.set('label', 'Направления');
    form.set('sortOrder', '3');
    form.set('required', 'on');
    form.set('options', 'Разработка\n\n Дизайн ');

    expect(formFieldValues(form)).toEqual({
      type: 'MULTI_CHOICE',
      label: 'Направления',
      sortOrder: 3,
      required: true,
      options: ['Разработка', 'Дизайн'],
    });
  });

  it('does not send options for a text field', () => {
    const form = new FormData();
    form.set('type', 'SHORT_TEXT');
    form.set('label', 'Комментарий');
    form.set('sortOrder', '0');
    form.set('options', 'not applicable');

    expect(formFieldValues(form).options).toBeNull();
  });
});
