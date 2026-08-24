import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  PublicEventResponse,
  TicketResponse,
} from '@event-registration/contracts';

import { App, RegistrationForm, TicketCard } from './App.js';

const event: PublicEventResponse = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'День открытых дверей',
  slug: 'open-day',
  description: 'Познакомьтесь с колледжем',
  coverObjectKey: null,
  startAt: '2026-09-01T07:00:00.000Z',
  endAt: '2026-09-01T10:00:00.000Z',
  timezone: 'Europe/Moscow',
  location: 'Главный корпус',
  availability: 'OPEN',
  consentUrl: 'https://example.test/consent',
  consentVersion: 'v1',
  formFields: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      type: 'SINGLE_CHOICE',
      label: 'Направление',
      required: true,
      sortOrder: 1,
      options: ['Разработка', 'Дизайн'],
    },
  ],
};

describe('web shell', () => {
  it('identifies the event registration system', () => {
    expect(renderToStaticMarkup(<App />)).toContain(
      'Регистрация на мероприятия',
    );
  });

  it('renders the complete public registration baseline', () => {
    const markup = renderToStaticMarkup(
      <RegistrationForm
        event={event}
        submitting={false}
        onSubmit={async () => undefined}
      />,
    );

    expect(markup).toContain('Дата рождения');
    expect(markup).toContain('Направление');
    expect(markup).toContain('consentAccepted');
    expect(markup).toContain('Получить билет');
  });

  it('renders ticket details and a QR image without exposing the raw payload', () => {
    const ticket: TicketResponse = {
      event: {
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        timezone: event.timezone,
        location: event.location,
      },
      participantName: {
        lastName: 'Иванов',
        firstName: 'Иван',
        middleName: null,
      },
      qrPayload: 'private-ticket-payload-that-must-not-be-rendered-as-text',
    };
    const markup = renderToStaticMarkup(
      <TicketCard ticket={ticket} qrImage="data:image/png;base64,example" />,
    );

    expect(markup).toContain('Иванов Иван');
    expect(markup).toContain('alt="QR-код билета"');
    expect(markup).not.toContain(ticket.qrPayload);
  });
});
