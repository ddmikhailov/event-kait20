import type { EventResponse } from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminLogin, EventForm, EventGrid, RoleDenied } from './AdminApp.js';

const event: EventResponse = {
  id: '10000000-0000-4000-8000-000000000001',
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
});
