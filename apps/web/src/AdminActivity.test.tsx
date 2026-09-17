import type { EventResponse } from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ActivitySettings,
  EventParticipationWorkspace,
} from './AdminActivity.js';

const event: EventResponse = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'Завершённое мероприятие',
  slug: 'completed-event',
  description: null,
  coverObjectKey: null,
  startAt: '2026-01-01T10:00:00.000Z',
  endAt: '2026-01-01T12:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'КАИТ №20',
  registrationDeadline: '2025-12-31T10:00:00.000Z',
  capacity: 100,
  status: 'COMPLETED',
  archivedAt: null,
  createdAt: '2025-12-01T10:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
};

describe('activity administration', () => {
  it('separates attendance, participation and scoring actions', () => {
    const markup = renderToStaticMarkup(
      <EventParticipationWorkspace event={event} onBack={() => undefined} />,
    );
    expect(markup).toContain('Фактическое участие');
    expect(markup).toContain('Подтвердить участие');
    expect(markup).toContain('Registration, Attendance');
    expect(markup).toContain('Отменить участие');
    expect(markup).not.toContain('Начислить при сканировании');
  });

  it('keeps global scoring mutation visible only to SUPER_ADMIN', () => {
    const organizer = renderToStaticMarkup(
      <ActivitySettings role="ORGANIZER" onBack={() => undefined} />,
    );
    const superAdmin = renderToStaticMarkup(
      <ActivitySettings role="SUPER_ADMIN" onBack={() => undefined} />,
    );
    expect(organizer).toContain('только SUPER_ADMIN');
    expect(organizer).not.toContain('Создать правило');
    expect(superAdmin).toContain('Создать правило');
    expect(superAdmin).toContain('Создать сезон');
  });
});
