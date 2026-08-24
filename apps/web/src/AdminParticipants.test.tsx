import type { RegistrationListResponse } from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ParticipantForm, RegistrationTable } from './AdminParticipants.js';

const registration: RegistrationListResponse['items'][number] = {
  id: '10000000-0000-4000-8000-000000000001',
  eventId: '20000000-0000-4000-8000-000000000001',
  personId: '30000000-0000-4000-8000-000000000001',
  lastName: 'Иванов',
  firstName: 'Иван',
  middleName: 'Иванович',
  birthDate: '2007-03-10',
  email: 'participant@example.test',
  phone: '+79990000000',
  studyGroup: 'ИС-21',
  personType: 'KAIT_STUDENT',
  organization: null,
  source: 'PUBLIC_FORM',
  status: 'ACTIVE',
  registeredAt: '2026-08-24T10:00:00.000Z',
  firstAttendedAt: null,
  annulledAt: null,
};

describe('participant administrator views', () => {
  it('renders registration data and its historical source without ticket secrets', () => {
    const markup = renderToStaticMarkup(
      <RegistrationTable
        items={[registration]}
        busy={false}
        onOpen={async () => undefined}
      />,
    );
    expect(markup).toContain('Иванов Иван Иванович');
    expect(markup).toContain('Публичная форма');
    expect(markup).toContain('Действует');
    expect(markup).not.toContain('ticketUrl');
  });

  it('renders conditional student fields in an editable participant form', () => {
    const markup = renderToStaticMarkup(
      <ParticipantForm onSubmit={async () => undefined} />,
    );
    expect(markup).toContain('Учебная группа');
    expect(markup).not.toContain('Организация');
    expect(markup).toContain('Сохранить');
  });

  it('makes a historical participant form read-only when requested', () => {
    const markup = renderToStaticMarkup(
      <ParticipantForm disabled onSubmit={async () => undefined} />,
    );
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('Сохранить');
  });

  it('pre-fills editable contact data from the registration snapshot', () => {
    const markup = renderToStaticMarkup(
      <ParticipantForm
        participant={{
          ...registration,
          answers: [],
          ticketUrl: 'https://example.test/tickets/test/signed',
        }}
        onSubmit={async () => undefined}
      />,
    );
    expect(markup).toContain('value="participant@example.test"');
    expect(markup).toContain('value="+79990000000"');
  });
});
