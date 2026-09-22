import type {
  ActivityDirection,
  ActivityReference,
  Participation,
  Season,
} from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ParticipationsPanel } from './AdminActivityAdmin.js';

const season = (overrides: Partial<Season> = {}): Season => ({
  id: '20000000-0000-4000-8000-000000000001',
  code: 'S2026',
  name: 'Сезон 2026',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2026-12-31T00:00:00.000Z',
  active: true,
  scoringPolicyId: null,
  scoringPolicyEffectiveFrom: null,
  ...overrides,
});

const direction = (
  overrides: Partial<ActivityDirection> = {},
): ActivityDirection => ({
  id: '30000000-0000-4000-8000-000000000001',
  tenantId: '40000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  code: 'IT',
  name: 'Информационные технологии',
  description: null,
  active: true,
  sortOrder: 0,
  ...overrides,
});

const reference = (
  overrides: Partial<ActivityReference> = {},
): ActivityReference => ({
  id: '60000000-0000-4000-8000-000000000001',
  code: 'ORGANIZER',
  name: 'Организатор',
  description: null,
  active: true,
  sortOrder: 0,
  builtIn: true,
  ...overrides,
});

const participation = (
  overrides: Partial<Participation> = {},
): Participation => ({
  id: '70000000-0000-4000-8000-000000000001',
  registrationId: '80000000-0000-4000-8000-000000000001',
  personId: '50000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000001',
  streamId: null,
  status: 'DRAFT',
  source: 'ADMIN',
  role: {
    id: '60000000-0000-4000-8000-000000000001',
    code: 'ORGANIZER',
    name: 'Организатор',
  },
  result: null,
  scoringState: 'NOT_SCORED',
  scoringSequence: null,
  scoreAwarded: '0.0000',
  scoreReason: null,
  confirmedAt: null,
  finalizedAt: null,
  registration: {
    lastName: 'Петрова',
    firstName: 'Анна',
    middleName: null,
    status: 'ACTIVE',
    firstAttendedAt: '2026-10-01T09:00:00.000Z',
    studyGroup: 'ИС-21',
  },
  streamTitle: null,
  eventTitle: 'День открытых дверей',
  eventStartAt: '2026-10-01T10:00:00.000Z',
  seasonId: '20000000-0000-4000-8000-000000000001',
  seasonName: 'Сезон 2026',
  directionId: '30000000-0000-4000-8000-000000000001',
  directionName: 'Информационные технологии',
  ...overrides,
});

const baseProps = {
  seasons: [season()],
  directions: [direction()],
  roles: [reference()],
  results: [
    reference({
      id: '61000000-0000-4000-8000-000000000001',
      code: 'WINNER',
      name: 'Победитель',
    }),
  ],
  filters: {
    query: '',
    status: '',
    scoringState: '',
    seasonId: '',
    directionId: '',
  },
  onFilterChange: () => undefined,
  onSearchSubmit: () => undefined,
  items: [] as Participation[],
  page: 1,
  pageSize: 25,
  total: 0,
  onPageChange: () => undefined,
  selectedId: undefined as string | undefined,
  onSelectRow: () => undefined,
  busy: false,
  selected: undefined as Participation | undefined,
  roleId: '',
  resultId: '',
  reason: '',
  onRoleIdChange: () => undefined,
  onResultIdChange: () => undefined,
  onReasonChange: () => undefined,
  onChangeRoleResult: () => undefined,
  onConfirm: () => undefined,
  onCancel: () => undefined,
  onCloseDetail: () => undefined,
};

describe('participations admin', () => {
  it('shows an empty state when nothing matches the search', () => {
    const markup = renderToStaticMarkup(<ParticipationsPanel {...baseProps} />);
    expect(markup).toContain('Ничего не найдено.');
  });

  it('renders a row by readable Person and Event names, never raw UUIDs', () => {
    const target = participation();
    const markup = renderToStaticMarkup(
      <ParticipationsPanel {...baseProps} items={[target]} />,
    );
    expect(markup).toContain('Петрова Анна');
    expect(markup).toContain('День открытых дверей');
    expect(markup).not.toContain(target.id as string);
    expect(markup).not.toContain(target.registrationId);
    expect(markup).not.toContain(target.eventId);
  });

  it('renders role, result, status and scoring state from canonical values', () => {
    const target = participation({
      status: 'CONFIRMED',
      scoringState: 'AWARDED',
      scoreAwarded: '18.5000',
      result: {
        id: '61000000-0000-4000-8000-000000000001',
        code: 'WINNER',
        name: 'Победитель',
      },
    });
    const markup = renderToStaticMarkup(
      <ParticipationsPanel {...baseProps} items={[target]} />,
    );
    expect(markup).toContain('Организатор');
    expect(markup).toContain('Победитель');
    expect(markup).toContain('Подтверждено');
    expect(markup).toContain('Начислено');
    expect(markup).toContain('18.5000');
  });

  it('builds season/direction/role/result options dynamically from props, not hardcoded', () => {
    const customSeason = season({
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Особый сезон',
    });
    const customDirection = direction({
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Волонтёрство',
    });
    const customRole = reference({
      id: '60000000-0000-4000-8000-000000000002',
      name: 'Координатор',
    });
    const markup = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        seasons={[customSeason]}
        directions={[customDirection]}
        roles={[customRole]}
        selected={participation()}
      />,
    );
    expect(markup).toContain('Особый сезон');
    expect(markup).toContain('Волонтёрство');
    expect(markup).toContain('Координатор');
  });

  it('disables the search control while a request is pending', () => {
    const markup = renderToStaticMarkup(
      <ParticipationsPanel {...baseProps} busy />,
    );
    expect(markup).toContain('disabled=""');
  });

  it('disables season/direction/status/scoringState filters and pagination while busy, so a mutation in flight cannot be raced by a new search', () => {
    const busyMarkup = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        busy
        items={[participation()]}
        total={40}
        pageSize={25}
      />,
    );
    const busySeasonStart = busyMarkup.indexOf('<span>Сезон</span>');
    const busyFilters = busyMarkup.slice(
      busySeasonStart,
      busyMarkup.indexOf('kait-button', busySeasonStart),
    );
    expect((busyFilters.match(/<select/g) ?? []).length).toBe(4);
    expect((busyFilters.match(/disabled=""/g) ?? []).length).toBe(4);
    const busyPagination = busyMarkup.slice(busyMarkup.indexOf('Раньше') - 200);
    expect(busyPagination).toContain('disabled=""');

    const idleMarkup = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        busy={false}
        items={[participation()]}
        total={40}
        pageSize={25}
      />,
    );
    const idleSeasonStart = idleMarkup.indexOf('<span>Сезон</span>');
    const idleFilters = idleMarkup.slice(
      idleSeasonStart,
      idleMarkup.indexOf('kait-button', idleSeasonStart),
    );
    expect(idleFilters).not.toContain('disabled=""');
  });

  it('disables the detail actions while a mutation is pending', () => {
    const markup = renderToStaticMarkup(
      <ParticipationsPanel {...baseProps} busy selected={participation()} />,
    );
    expect(markup).toContain('Сохранить роль и результат');
    const detailSection = markup.slice(markup.indexOf('Роль и результат'));
    expect(detailSection).toContain('disabled=""');
  });

  it('offers Confirm only for a DRAFT participation, never for an already-confirmed one', () => {
    const draft = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        selected={participation({ status: 'DRAFT' })}
      />,
    );
    expect(draft).toContain('Подтвердить участие');

    const confirmed = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        selected={participation({ status: 'CONFIRMED' })}
      />,
    );
    expect(confirmed).not.toContain('Подтвердить участие');
  });

  it('hides the entire mutation form for an already-cancelled participation', () => {
    const markup = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        selected={participation({ status: 'CANCELLED' })}
      />,
    );
    expect(markup).not.toContain('Роль и результат');
    expect(markup).not.toContain('Отменить участие');
  });

  it('shows full participation context in the detail panel without a raw id', () => {
    const target = participation();
    const markup = renderToStaticMarkup(
      <ParticipationsPanel {...baseProps} selected={target} />,
    );
    expect(markup).toContain('День открытых дверей');
    expect(markup).toContain('Сезон 2026');
    expect(markup).toContain('Информационные технологии');
    expect(markup).toContain('ИС-21');
    expect(markup).toContain('Вход подтверждён Scanner');
    expect(markup).not.toContain(target.id as string);
  });

  it('shows pagination only when there is more than one page of results', () => {
    const single = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        items={[participation()]}
        total={1}
        pageSize={25}
      />,
    );
    expect(single).not.toContain('Раньше');

    const many = renderToStaticMarkup(
      <ParticipationsPanel
        {...baseProps}
        items={[participation()]}
        total={40}
        pageSize={25}
      />,
    );
    expect(many).toContain('Позже');
  });
});
