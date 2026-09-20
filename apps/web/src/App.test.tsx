import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  PublicEventResponse,
  PublicEventSummary,
  TicketResponse,
} from '@event-registration/contracts';

import {
  App,
  EventStatusLabel,
  filterPublicEvents,
  RegistrationForm,
  RegistrationSuccess,
  TicketCard,
} from './App.js';

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
  consentUrl: 'https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf',
  privacyPolicyUrl:
    'https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf',
  consentVersion: 'v1',
  formFields: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      type: 'SINGLE_CHOICE',
      label: 'Размер футболки',
      required: true,
      sortOrder: 1,
      options: ['S', 'M'],
    },
  ],
};

describe('web shell', () => {
  it.each([
    ['REGISTRATION_OPEN', 'Регистрация открыта'],
    ['REGISTRATION_CLOSED', 'Регистрация закрыта'],
    ['ACTIVE', 'Мероприятие идёт'],
    ['COMPLETED', 'Мероприятие завершено'],
  ] as const)('renders automatic %s status', (status, label) => {
    expect(
      renderToStaticMarkup(<EventStatusLabel status={status} />),
    ).toContain(label);
  });
  it('identifies the event registration system', () => {
    expect(renderToStaticMarkup(<App />)).toContain(
      'Учитесь, пробуйте, участвуйте',
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
    expect(markup).toContain('<option value="PARENT">Родитель</option>');
    expect(markup).toContain('<option value="OTHER">Другое</option>');
    expect(markup).toContain('Размер футболки');
    expect(markup).toContain('consentAccepted');
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain(
      'https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf',
    );
    expect(markup).toContain(
      'https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&amp;name=politika_v_otnoshenii_pd_rkait20.pdf',
    );
    expect(markup).toContain('Я даю <a');
    expect(markup).toContain('согласие</a> и принимаю <a');
    expect(markup).toContain('политику обработки персональных данных</a>.');
    expect(markup).toContain('Получить билет');
  });

  it('does not reveal a ticket for an existing public registration', () => {
    const queued = renderToStaticMarkup(
      <RegistrationSuccess
        event={event}
        result={{ status: 'ALREADY_REGISTERED', recoveryQueued: true }}
      />,
    );
    expect(queued).toContain('первоначальной регистрации');
    expect(queued).toContain('не изменили сохранённые данные');
    expect(queued).not.toContain('Открыть билет');
    expect(queued).not.toContain('href=');

    const organizer = renderToStaticMarkup(
      <RegistrationSuccess
        event={event}
        result={{ status: 'ALREADY_REGISTERED', recoveryQueued: false }}
      />,
    );
    expect(organizer).toContain('обратитесь к организатору');
  });

  it('filters the public event catalog by text and category', () => {
    const summaries: PublicEventSummary[] = [
      {
        id: event.id,
        title: event.title,
        slug: event.slug,
        description: event.description,
        direction: 'Профориентация',
        coverObjectKey: null,
        startAt: event.startAt,
        endAt: event.endAt,
        timezone: event.timezone,
        location: event.location,
        registrationDeadline: '2026-08-31T07:00:00.000Z',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        title: 'Мастер-класс по веб-разработке',
        slug: 'web-workshop',
        description: 'Практическое занятие',
        direction: 'Информационные технологии',
        coverObjectKey: null,
        startAt: '2026-10-01T07:00:00.000Z',
        endAt: '2026-10-01T10:00:00.000Z',
        timezone: 'Europe/Moscow',
        location: 'IT-полигон',
        registrationDeadline: '2026-09-30T07:00:00.000Z',
      },
    ];

    expect(
      filterPublicEvents(summaries, {
        query: 'веб',
        direction: 'Информационные технологии',
        month: 'ALL',
        location: 'ALL',
      }).map((item) => item.slug),
    ).toEqual(['web-workshop']);
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
