import type {
  ActivityDirection,
  EventResponse,
} from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { eventValues } from './admin-values.js';
import { AdminLogin, EventForm, EventGrid, RoleDenied } from './AdminApp.js';

const event: EventResponse = {
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  title: 'День открытых дверей',
  slug: 'open-day',
  description: 'Описание',
  coverObjectKey: null,
  startAt: '2026-09-01T07:00:00.000Z',
  endAt: '2026-09-01T10:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'Главный корпус',
  registrationDeadline: '2026-09-01T06:00:00.000Z',
  capacity: 200,
  status: 'DRAFT',
  archivedAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const direction = (
  overrides: Partial<ActivityDirection> = {},
): ActivityDirection => ({
  id: '80000000-0000-4000-8000-000000000001',
  tenantId: '50000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  code: 'PROFORIENTATION',
  name: 'Профориентация',
  description: null,
  active: true,
  sortOrder: 0,
  ...overrides,
});

const baseEventFormFields: Record<string, string> = {
  title: 'Мероприятие',
  slug: 'meropriyatie',
  startAt: '2026-09-01T10:00',
  endAt: '2026-09-01T12:00',
  registrationDeadline: '2026-08-31T10:00',
  capacity: '10',
  location: 'КАИТ №20',
  status: 'DRAFT',
};

const eventFormData = (overrides: Record<string, string> = {}): FormData => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    ...baseEventFormFields,
    ...overrides,
  })) {
    form.set(key, value);
  }
  return form;
};

describe('admin console views', () => {
  it('renders a password-manager friendly administrator login', () => {
    const markup = renderToStaticMarkup(
      <AdminLogin onLogin={async () => undefined} />,
    );
    expect(markup).toContain('Кабинет организатора');
    expect(markup).toContain('autoComplete="username"');
    expect(markup).toContain('autoComplete="current-password"');
  });

  it('shows an explicit role boundary for scanner accounts', () => {
    const markup = renderToStaticMarkup(
      <RoleDenied
        email="scanner@example.test"
        onLogout={async () => undefined}
      />,
    );
    expect(markup).toContain('Нужна роль администратора');
    expect(markup).toContain('предназначена для сканера');
  });

  it('renders events and only valid draft status transitions', () => {
    const grid = renderToStaticMarkup(
      <EventGrid
        events={[event]}
        onOpen={async () => undefined}
        onParticipants={async () => undefined}
        onAccess={async () => undefined}
        onStatistics={async () => undefined}
      />,
    );
    const form = renderToStaticMarkup(
      <EventForm
        event={event}
        busy={false}
        readOnly={false}
        onSubmit={async () => undefined}
      />,
    );
    expect(grid).toContain('День открытых дверей');
    expect(grid).toContain('Доступ');
    expect(grid).toContain('Статистика');
    expect(form).toContain('Регистрация открыта');
    expect(form).not.toContain('Идёт сейчас');
    expect(form).not.toContain('Завершено');
  });

  it('makes archived events read-only', () => {
    const markup = renderToStaticMarkup(
      <EventForm
        event={{ ...event, status: 'ARCHIVED' }}
        busy={false}
        readOnly
        onSubmit={async () => undefined}
      />,
    );
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('Сохранить изменения');
  });

  it('A/B: the create form renders canonical Direction options, active ones selectable', () => {
    const markup = renderToStaticMarkup(
      <EventForm
        busy={false}
        readOnly={false}
        onSubmit={async () => undefined}
        directions={[direction({ name: 'Профориентация' })]}
      />,
    );
    expect(markup).toContain('name="directionId"');
    expect(markup).toContain('Профориентация');
  });

  it('C: a new Event never offers an inactive Direction (directions is already active-only, no event to carry a legacy inactive one)', () => {
    const markup = renderToStaticMarkup(
      <EventForm
        busy={false}
        readOnly={false}
        onSubmit={async () => undefined}
        directions={[direction()]}
      />,
    );
    expect(markup).not.toContain('неактивно');
  });

  it('D: an existing Event with an active Direction selects the canonical id by default', () => {
    const activeDirection = direction({ id: 'active-direction-id' });
    const markup = renderToStaticMarkup(
      <EventForm
        event={{
          ...event,
          directionId: activeDirection.id,
          direction: 'Профориентация',
        }}
        busy={false}
        readOnly={false}
        onSubmit={async () => undefined}
        directions={[activeDirection]}
      />,
    );
    expect(markup).toContain(`value="${activeDirection.id}"`);
  });

  it('E: an existing Event whose Direction has since been deactivated still shows it readably', () => {
    const markup = renderToStaticMarkup(
      <EventForm
        event={{
          ...event,
          directionId: 'now-inactive-id',
          direction: 'Старое направление',
        }}
        busy={false}
        readOnly={false}
        onSubmit={async () => undefined}
        directions={[]}
      />,
    );
    expect(markup).toContain('Старое направление (неактивно)');
    expect(markup).toContain('disabled=""');
  });

  it('G: a legacy text-only Event (no directionId) shows its legacy context, not a silent auto-migration', () => {
    const markup = renderToStaticMarkup(
      <EventForm
        event={{
          ...event,
          directionId: null,
          direction: 'Старый свободный текст',
        }}
        busy={false}
        readOnly={false}
        onSubmit={async () => undefined}
        directions={[]}
      />,
    );
    expect(markup).toContain(
      'Текущее legacy-направление: Старый свободный текст',
    );
  });

  it('F/H: eventValues() omits directionId when unchanged from the current (possibly inactive) Direction, and never sends legacy direction', () => {
    const currentId = '80000000-0000-4000-8000-000000000001';
    const newId = '80000000-0000-4000-8000-000000000002';

    const unchanged = eventValues(
      eventFormData({ directionId: currentId }),
      currentId,
    );
    expect('directionId' in unchanged).toBe(false);
    expect('direction' in unchanged).toBe(false);

    const changed = eventValues(
      eventFormData({ directionId: newId }),
      currentId,
    );
    expect(changed.directionId).toBe(newId);
    expect('direction' in changed).toBe(false);

    const created = eventValues(eventFormData({ directionId: newId }));
    expect(created.directionId).toBe(newId);
  });

  it('disabled-option regression: a MISSING directionId field (a disabled current inactive <option> is never submitted) means unchanged, not detached', () => {
    const currentId = '80000000-0000-4000-8000-000000000001';
    // Models the real FormData a browser would produce when the current
    // Direction's <option> is `disabled` (see EventForm's inactive-Direction
    // handling) - the field is never a successful control, so the key is
    // genuinely absent, not present-with-empty-string.
    const form = eventFormData();
    expect(form.has('directionId')).toBe(false);

    const result = eventValues(form, currentId);
    expect('directionId' in result).toBe(false);
    expect('direction' in result).toBe(false);
  });

  it('disabled-option regression: an explicitly PRESENT empty directionId field (the real "Без направления" option, never disabled) means the admin detached it', () => {
    const currentId = '80000000-0000-4000-8000-000000000001';
    const form = eventFormData({ directionId: '' });
    expect(form.has('directionId')).toBe(true);

    const result = eventValues(form, currentId);
    expect(result.directionId).toBeNull();
  });
});
