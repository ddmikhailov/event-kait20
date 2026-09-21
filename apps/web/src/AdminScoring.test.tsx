import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  PersonActivityParticipation,
  PersonStatusAssignment,
  PersonSummary,
  ScoringPolicy,
  ScoringPreviewResponse,
  Season,
  StatusTypeReference,
} from '@event-registration/contracts';

import {
  PersonStatusPanel,
  ScoringAdmin,
  SeasonScoringPanel,
  SimulatorPanel,
  statusState,
} from './AdminScoring.js';

describe('scoring v2 administration', () => {
  it('keeps policy/version mutation visible only to SUPER_ADMIN', () => {
    const organizer = renderToStaticMarkup(
      <ScoringAdmin role="ORGANIZER" onBack={() => undefined} />,
    );
    const superAdmin = renderToStaticMarkup(
      <ScoringAdmin role="SUPER_ADMIN" onBack={() => undefined} />,
    );
    expect(organizer).toContain('Изменять их может SUPER_ADMIN');
    expect(organizer).not.toContain('Создать политику');
    expect(superAdmin).toContain('Создать политику');
    expect(superAdmin).not.toContain('Изменять их может SUPER_ADMIN');
  });

  it('shows the scoring formula summary and back navigation', () => {
    const markup = renderToStaticMarkup(
      <ScoringAdmin role="SUPER_ADMIN" onBack={() => undefined} />,
    );
    expect(markup).toContain('Политики начисления баллов');
    expect(markup).toContain('роль × уровень × статус × новичок + результат');
    expect(markup).toContain('Мероприятия');
  });
});

const policy = (overrides: Partial<ScoringPolicy> = {}): ScoringPolicy => ({
  id: '30000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  code: 'KAIT20_DEFAULT',
  name: 'MosActive КАИТ №20',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const season = (overrides: Partial<Season> = {}): Season => ({
  id: '40000000-0000-4000-8000-000000000001',
  code: 'S2026',
  name: 'Сезон 2026',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2026-12-31T00:00:00.000Z',
  active: true,
  scoringPolicyId: null,
  scoringPolicyEffectiveFrom: null,
  ...overrides,
});

describe('season scoring policy activation', () => {
  it('shows an empty state when there are no seasons', () => {
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[]}
        policies={[]}
        publishablePolicyIds={new Set()}
        canManage
        busy={false}
        assigningSeasonId={undefined}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).toContain('Сезонов пока нет.');
  });

  it('offers first-time assignment for a season without a policy', () => {
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[season()]}
        policies={[policy()]}
        publishablePolicyIds={new Set()}
        canManage
        busy={false}
        assigningSeasonId={undefined}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).toContain('Не назначена');
    expect(markup).toContain('>Назначить<');
    expect(markup).not.toContain('>Изменить<');
  });

  it('shows the assigned policy name and offers change, not first assignment', () => {
    const activePolicy = policy();
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[
          season({
            scoringPolicyId: activePolicy.id,
            scoringPolicyEffectiveFrom: '2026-01-01T00:00:00.000Z',
          }),
        ]}
        policies={[activePolicy]}
        publishablePolicyIds={new Set([activePolicy.id])}
        canManage
        busy={false}
        assigningSeasonId={undefined}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).toContain(activePolicy.name);
    expect(markup).not.toContain('Не назначена');
    expect(markup).toContain('>Изменить<');
    expect(markup).not.toContain('>Назначить<');
  });

  it('does not show a policy id (UUID) anywhere in the row', () => {
    const activePolicy = policy();
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[
          season({
            scoringPolicyId: activePolicy.id,
            scoringPolicyEffectiveFrom: '2026-01-01T00:00:00.000Z',
          }),
        ]}
        policies={[activePolicy]}
        publishablePolicyIds={new Set([activePolicy.id])}
        canManage
        busy={false}
        assigningSeasonId={undefined}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).not.toContain(activePolicy.id);
  });

  it('directs the admin to publish a policy first when none is available', () => {
    const emptySeason = season();
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[emptySeason]}
        policies={[policy()]}
        publishablePolicyIds={new Set()}
        canManage
        busy={false}
        assigningSeasonId={emptySeason.id}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).toContain('Нет опубликованных систем начисления баллов');
    expect(markup).not.toContain('scoringPolicyId');
  });

  it('offers only published policies in the activation selector', () => {
    const published = policy({
      id: '30000000-0000-4000-8000-000000000002',
      code: 'PUB',
      name: 'Опубликованная система',
    });
    const draftOnly = policy({
      id: '30000000-0000-4000-8000-000000000003',
      code: 'DRF',
      name: 'Только черновик',
    });
    const target = season();
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[target]}
        policies={[published, draftOnly]}
        publishablePolicyIds={new Set([published.id])}
        canManage
        busy={false}
        assigningSeasonId={target.id}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).toContain('Опубликованная система');
    expect(markup).not.toContain('Только черновик');
  });

  it('hides the action column and controls from a role that cannot manage scoring', () => {
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[season()]}
        policies={[]}
        publishablePolicyIds={new Set()}
        canManage={false}
        busy={false}
        assigningSeasonId={undefined}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).not.toContain('Назначить');
    expect(markup).not.toContain('<th>Действие</th>');
  });

  it('disables the submit control while a mutation is pending', () => {
    const target = season();
    const markup = renderToStaticMarkup(
      <SeasonScoringPanel
        seasons={[target]}
        policies={[policy()]}
        publishablePolicyIds={new Set([policy().id])}
        canManage
        busy
        assigningSeasonId={target.id}
        onBegin={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(markup).toContain('disabled=""');
  });
});

const person = (overrides: Partial<PersonSummary> = {}): PersonSummary => ({
  id: '50000000-0000-4000-8000-000000000001',
  lastName: 'Петрова',
  firstName: 'Анна',
  middleName: null,
  birthDate: null,
  email: null,
  phone: null,
  studyGroup: 'ИС-21',
  personType: 'KAIT_STUDENT',
  organization: null,
  dedupReviewRequired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const statusType = (
  overrides: Partial<StatusTypeReference> = {},
): StatusTypeReference => ({
  id: '60000000-0000-4000-8000-000000000001',
  code: 'PROFESSION_AMBASSADOR',
  name: 'Амбассадор Профессионалитета',
  active: true,
  ...overrides,
});

const personStatus = (
  overrides: Partial<PersonStatusAssignment> = {},
): PersonStatusAssignment => ({
  id: '70000000-0000-4000-8000-000000000001',
  statusTypeId: '60000000-0000-4000-8000-000000000001',
  code: 'PROFESSION_AMBASSADOR',
  name: 'Амбассадор Профессионалитета',
  validFrom: '2020-01-01',
  validTo: null,
  retiredAt: null,
  retiredEffectiveOn: null,
  ...overrides,
});

describe('person status management', () => {
  it('shows a search box, not a statuses table, when no person is selected', () => {
    const markup = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType()]}
        canManage
        busy={false}
        hasSearched={false}
        searchResults={[]}
        selectedPerson={undefined}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[]}
        assigning={false}
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(markup).toContain('Найти человека');
    expect(markup).not.toContain('<table');
    expect(markup).toContain('Введите запрос и нажмите');
    expect(markup).not.toContain('Никого не найдено');
  });

  it('distinguishes "not searched yet" from "searched, found nothing"', () => {
    const searched = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType()]}
        canManage
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={undefined}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[]}
        assigning={false}
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(searched).toContain('Никого не найдено по этому запросу.');
    expect(searched).not.toContain('Введите запрос и нажмите');
  });

  it('shows an empty state for a selected person with no statuses', () => {
    const markup = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType()]}
        canManage
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[]}
        assigning={false}
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(markup).toContain('Петрова Анна');
    expect(markup).toContain('Статусов пока нет.');
  });

  it('renders an ongoing status as active and a past one as ended, by status type name not UUID', () => {
    const active = personStatus();
    const ended = personStatus({
      id: '70000000-0000-4000-8000-000000000002',
      validFrom: '2020-01-01',
      validTo: '2020-06-30',
    });
    const markup = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType()]}
        canManage
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[active, ended]}
        assigning={false}
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(markup).toContain('Амбассадор Профессионалитета');
    expect(markup).not.toContain(active.statusTypeId);
    expect(markup).toContain('Активен');
    expect(markup).toContain('Завершён');
  });

  it('hides the action column and mutation controls from a role that cannot manage scoring', () => {
    const markup = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType()]}
        canManage={false}
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[personStatus()]}
        assigning={false}
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(markup).not.toContain('Добавить статус');
    expect(markup).not.toContain('Завершить');
    expect(markup).not.toContain('<th>Действие</th>');
  });

  it('directs the admin to configure status types first when none are active', () => {
    const markup = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType({ active: false })]}
        canManage
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[]}
        assigning
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(markup).toContain('Нет доступных типов статуса');
    expect(markup).not.toContain('<select name="statusTypeId"');
  });

  it('uses plain calendar dates, not datetime-local, for the validity period', () => {
    const markup = renderToStaticMarkup(
      <PersonStatusPanel
        statusTypes={[statusType()]}
        canManage
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        statuses={[]}
        assigning
        onBeginAssign={() => undefined}
        onCancelAssign={() => undefined}
        onSubmitAssign={() => undefined}
        onRetire={() => undefined}
      />,
    );
    expect(markup).toContain('type="date"');
    expect(markup).toContain('name="validFrom"');
    expect(markup).not.toContain('datetime-local');
  });
});

describe('statusState boundary semantics', () => {
  const today = '2026-09-21';

  it('treats an inclusive validTo of yesterday as ended', () => {
    expect(statusState(personStatus({ validTo: '2026-09-20' }), today)).toBe(
      'Завершён',
    );
  });

  it('treats an inclusive validTo of today as still active', () => {
    expect(statusState(personStatus({ validTo: today }), today)).toBe(
      'Активен',
    );
  });

  it('treats an inclusive validTo of tomorrow as still active', () => {
    expect(statusState(personStatus({ validTo: '2026-09-22' }), today)).toBe(
      'Активен',
    );
  });

  it('treats an exclusive retiredEffectiveOn of today as ended', () => {
    expect(
      statusState(
        personStatus({
          retiredAt: '2026-09-20T10:00:00.000Z',
          retiredEffectiveOn: today,
        }),
        today,
      ),
    ).toBe('Завершён');
  });

  it('treats an exclusive retiredEffectiveOn of tomorrow as still active today', () => {
    expect(
      statusState(
        personStatus({
          retiredAt: '2026-09-21T10:00:00.000Z',
          retiredEffectiveOn: '2026-09-22',
        }),
        today,
      ),
    ).toBe('Активен');
  });

  it('does not conflate validTo (inclusive) with retiredEffectiveOn (exclusive)', () => {
    // A status with an inclusive validTo of "today" combined with an
    // unrelated future retirement boundary must still read as active today —
    // proves the two fields are checked independently, not merged into one
    // "endsOn" value the way the earlier, incorrect implementation did.
    expect(
      statusState(
        personStatus({ validTo: today, retiredEffectiveOn: '2026-09-22' }),
        today,
      ),
    ).toBe('Активен');
  });

  it('still reports a not-yet-started status as neither active nor ended', () => {
    expect(
      statusState(personStatus({ validFrom: '2026-09-22' }), today),
    ).toBeNull();
  });
});

const participation = (
  overrides: Partial<PersonActivityParticipation> = {},
): PersonActivityParticipation => ({
  id: '80000000-0000-4000-8000-000000000001',
  eventId: '10000000-0000-4000-8000-000000000001',
  eventTitle: 'День открытых дверей',
  eventStartAt: '2026-10-01T07:00:00.000Z',
  status: 'CONFIRMED',
  scoringState: 'NOT_SCORED',
  confirmedAt: '2026-10-01T07:00:00.000Z',
  role: { code: 'ORGANIZER', name: 'Организатор' },
  result: { code: 'WINNER', name: 'Победитель' },
  points: '0.0000',
  ...overrides,
});

const previewResponse = (
  overrides: Partial<ScoringPreviewResponse> = {},
): ScoringPreviewResponse => ({
  points: '18.5000',
  policyVersionId: '90000000-0000-4000-8000-000000000001',
  policyVersionStatus: 'PUBLISHED',
  calculation: {
    snapshotSchemaVersion: 1,
    engineVersion: 'V2',
    scoringPolicyId: '30000000-0000-4000-8000-000000000001',
    policyVersionId: '90000000-0000-4000-8000-000000000001',
    policyVersion: 1,
    policyVersionStatus: 'PUBLISHED',
    eventId: '10000000-0000-4000-8000-000000000001',
    eventStartAt: '2026-10-01T07:00:00.000Z',
    eventMoscowDate: '2026-10-01',
    seasonId: '20000000-0000-4000-8000-000000000001',
    participationId: '80000000-0000-4000-8000-000000000001',
    personId: '50000000-0000-4000-8000-000000000001',
    role: { id: 'r1', code: 'ORGANIZER', name: 'Организатор', value: '3.0000' },
    level: { id: 'l1', code: 'CITY', name: 'Городской', value: '2.0000' },
    statuses: [
      {
        id: 's1',
        code: 'PROFESSION_AMBASSADOR',
        name: 'Амбассадор Профессионалитета',
        value: '1.5000',
      },
    ],
    newcomer: { sequence: 1, value: '1.5000' },
    result: { id: 'res1', code: 'WINNER', name: 'Победитель', value: '5.0000' },
    multiplicativeSubtotal: '13.5000',
    resultBonus: '5.0000',
    finalPoints: '18.5000',
    roundingMode: 'ROUND_HALF_UP',
    calculatedAt: '2026-10-01T08:00:00.000Z',
    ...(overrides.calculation as object | undefined),
  },
  ...overrides,
});

describe('scoring simulator', () => {
  it('shows the search box before a person is selected', () => {
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy={false}
        hasSearched={false}
        searchResults={[]}
        selectedPerson={undefined}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[]}
        selectedParticipationId={undefined}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={undefined}
      />,
    );
    expect(markup).toContain('Найти человека');
    expect(markup).not.toContain('<table');
  });

  it('shows the selected person by name and the participation by event title, not raw UUIDs', () => {
    const target = participation();
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[target]}
        selectedParticipationId={undefined}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={undefined}
      />,
    );
    expect(markup).toContain('Петрова Анна');
    expect(markup).toContain('День открытых дверей');
    expect(markup).not.toContain(target.id);
    expect(markup).not.toContain(target.eventId);
  });

  it('disables the calculate control while busy', () => {
    const target = participation();
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[target]}
        selectedParticipationId={target.id}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={undefined}
      />,
    );
    expect(markup).toContain('disabled=""');
  });

  it('disables the calculate control when no participation is selected', () => {
    const target = participation();
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[target]}
        selectedParticipationId={undefined}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={undefined}
      />,
    );
    expect(markup).toContain('disabled=""');
  });

  it('renders a successful breakdown with each status multiplier shown separately', () => {
    const response = previewResponse({
      calculation: {
        ...previewResponse().calculation,
        statuses: [
          {
            id: 's1',
            code: 'PROFESSION_AMBASSADOR',
            name: 'Амбассадор Профессионалитета',
            value: '1.5000',
          },
          {
            id: 's2',
            code: 'VOLUNTEER_CORPS',
            name: 'Волонтёрский корпус',
            value: '1.2000',
          },
        ],
      },
    });
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[]}
        selectedParticipationId={undefined}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={{ kind: 'result', response }}
      />,
    );
    expect(markup).toContain('18.50');
    expect(markup).toContain('Амбассадор Профессионалитета');
    expect(markup).toContain('Волонтёрский корпус');
    expect(markup).not.toContain(response.calculation.role.id);
    expect(markup).not.toContain(response.calculation.statuses[0]!.id);
  });

  it('renders a NO_RULE-style outcome as an explanatory message, not a zero score', () => {
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[]}
        selectedParticipationId={undefined}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={{
          kind: 'explanation',
          text: 'Для выбранной комбинации правило начисления не настроено.',
        }}
      />,
    );
    expect(markup).toContain(
      'Для выбранной комбинации правило начисления не настроено.',
    );
    expect(markup).not.toContain('0.00 балл');
    expect(markup).not.toContain('Результат:');
  });

  it('shows no stale breakdown or explanation when the outcome is cleared', () => {
    const markup = renderToStaticMarkup(
      <SimulatorPanel
        busy={false}
        hasSearched
        searchResults={[]}
        selectedPerson={person()}
        onSearch={() => undefined}
        onSelectPerson={() => undefined}
        onClearSelection={() => undefined}
        participations={[]}
        selectedParticipationId={undefined}
        onSelectParticipation={() => undefined}
        onCalculate={() => undefined}
        outcome={undefined}
      />,
    );
    expect(markup).not.toContain('Результат:');
    expect(markup).not.toContain('Для выбранной комбинации');
  });
});
