import type { EventResponse } from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EventExcel } from './AdminExcel.js';

const event: EventResponse = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'День открытых дверей',
  slug: 'open-day',
  description: null,
  coverObjectKey: null,
  startAt: '2027-06-10T10:00:00.000Z',
  endAt: '2027-06-10T18:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'Москва',
  registrationDeadline: '2027-06-09T18:00:00.000Z',
  capacity: 100,
  status: 'REGISTRATION_OPEN',
  archivedAt: null,
  createdAt: '2026-08-24T10:00:00.000Z',
  updatedAt: '2026-08-24T10:00:00.000Z',
};

describe('Excel administrator workspace', () => {
  it('explains the safe preview workflow and upload limits', () => {
    const html = renderToStaticMarkup(
      <EventExcel
        event={event}
        onBack={() => undefined}
        onCommitted={() => undefined}
      />,
    );

    expect(html).toContain('Импорт участников');
    expect(html).toContain('До подтверждения регистрации не создаются');
    expect(html).toContain('до 5 МБ и 5000 строк');
    expect(html).toContain('Показать предпросмотр');
  });
});
