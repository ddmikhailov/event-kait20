import type {
  Participation,
  PersonAchievement,
  PersonSummary,
} from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  AchievementPanel,
  achievementContextLabel,
  achievementSourceLabel,
  achievementStatusLabel,
  linkableParticipations,
  type LinkedParticipation,
} from './AdminAchievement.js';

const person = (overrides: Partial<PersonSummary> = {}): PersonSummary => ({
  id: '70000000-0000-4000-8000-000000000001',
  lastName: 'Петрова',
  firstName: 'Анна',
  middleName: null,
  birthDate: null,
  email: null,
  phone: null,
  studyGroup: null,
  personType: 'KAIT_STUDENT',
  organization: null,
  dedupReviewRequired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const achievement = (
  overrides: Partial<PersonAchievement> = {},
): PersonAchievement => ({
  id: '80000000-0000-4000-8000-000000000001',
  title: 'Диплом победителя',
  description: null,
  type: 'CERTIFICATE',
  status: 'PENDING',
  source: 'MANUAL',
  occurredAt: '2026-10-01T07:00:00.000Z',
  eventId: null,
  eventTitle: null,
  eventStartAt: null,
  participationId: null,
  participationRole: null,
  participationResult: null,
  createdAt: '2026-10-01T07:05:00.000Z',
  ...overrides,
});

const participation = (
  overrides: Partial<Participation> = {},
): Participation => ({
  id: '90000000-0000-4000-8000-000000000001',
  registrationId: '90000000-0000-4000-8000-000000000002',
  personId: '70000000-0000-4000-8000-000000000001',
  eventId: '90000000-0000-4000-8000-000000000003',
  streamId: null,
  status: 'CONFIRMED',
  source: 'ADMIN',
  role: {
    id: '90000000-0000-4000-8000-000000000004',
    code: 'PARTICIPANT',
    name: 'Участник',
  },
  result: null,
  scoringState: 'AWARDED',
  scoringSequence: 1,
  scoreAwarded: '10.0000',
  scoreReason: null,
  confirmedAt: '2026-09-30T07:00:00.000Z',
  finalizedAt: null,
  registration: {
    lastName: 'Петрова',
    firstName: 'Анна',
    middleName: null,
    status: 'ACTIVE',
    firstAttendedAt: '2026-09-30T07:00:00.000Z',
    studyGroup: 'ИС-21',
  },
  streamTitle: null,
  eventTitle: 'Олимпиада по информатике',
  eventStartAt: '2026-09-30T07:00:00.000Z',
  seasonId: null,
  seasonName: null,
  directionId: null,
  directionName: null,
  ...overrides,
});

const baseProps = {
  canManage: true,
  busy: false,
  hasSearched: false,
  searchResults: [] as PersonSummary[],
  selectedPerson: undefined as PersonSummary | undefined,
  onSearch: () => undefined,
  onSelectPerson: () => undefined,
  onClearSelection: () => undefined,
  achievements: [] as PersonAchievement[],
  creating: false,
  onBeginCreate: () => undefined,
  onCancelCreate: () => undefined,
  onSubmitCreate: () => undefined,
  linkMode: 'none' as const,
  onLinkModeChange: () => undefined,
  participationQuery: '',
  participationResults: [] as Participation[],
  onParticipationSearch: () => undefined,
  selectedParticipation: undefined as LinkedParticipation | undefined,
  onSelectParticipation: () => undefined,
  decidingId: undefined as string | undefined,
  decisionReason: '',
  onDecisionReasonChange: () => undefined,
  onDecide: () => undefined,
};

describe('achievement admin', () => {
  it('A: shows the search form when no Person is selected', () => {
    const markup = renderToStaticMarkup(<AchievementPanel {...baseProps} />);
    expect(markup).toContain('Найти человека');
    expect(markup).not.toContain('Достижений пока нет.');
  });

  it('B: shows the empty state and the add-achievement action for a Person with no achievements', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel {...baseProps} selectedPerson={person()} />,
    );
    expect(markup).toContain('Достижений пока нет.');
    expect(markup).toContain('Добавить достижение');
  });

  it('C: shows readable achievement history', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        achievements={[achievement()]}
      />,
    );
    expect(markup).toContain('Диплом победителя');
  });

  it('D: shows type, status and source', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        achievements={[
          achievement({
            type: 'CERTIFICATE',
            status: 'VERIFIED',
            source: 'EVENT_KAIT20',
          }),
        ]}
      />,
    );
    expect(markup).toContain('CERTIFICATE');
    expect(markup).toContain('Подтверждено');
    expect(markup).toContain('Мероприятие КАИТ №20');
  });

  it('E: a linked Event is shown by readable title, never by raw UUID', () => {
    const target = achievement({
      eventId: '90000000-0000-4000-8000-000000000003',
      eventTitle: 'Олимпиада по информатике',
    });
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        achievements={[target]}
      />,
    );
    expect(markup).toContain('Олимпиада по информатике');
    expect(markup).not.toContain(target.eventId as string);
  });

  it('F: create controls are hidden for a role without manage permission', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        canManage={false}
        selectedPerson={person()}
      />,
    );
    expect(markup).not.toContain('Добавить достижение');
  });

  it('G: decision controls are only offered for a PENDING achievement', () => {
    const pending = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        achievements={[achievement({ status: 'PENDING' })]}
      />,
    );
    expect(pending).toContain('Решить…');

    const verified = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        achievements={[achievement({ status: 'VERIFIED' })]}
      />,
    );
    expect(verified).not.toContain('Решить…');
  });

  it('H: busy disables the create button', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel {...baseProps} busy selectedPerson={person()} />,
    );
    expect(markup).toContain('disabled=""');
  });

  it('I: status and source labels are data-driven, not hardcoded per achievement', () => {
    expect(achievementStatusLabel('PENDING')).toBe('Ожидает решения');
    expect(achievementStatusLabel('VERIFIED')).toBe('Подтверждено');
    expect(achievementStatusLabel('REJECTED')).toBe('Отклонено');
    expect(achievementStatusLabel('CANCELLED')).toBe('Отменено');
    expect(achievementSourceLabel('MANUAL')).toBe('Вручную');
    expect(achievementSourceLabel('IMPORT')).toBe('Импорт');
  });

  it('J: occurred date/time is presented in Moscow time, readable dd.mm.yyyy hh:mm', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        achievements={[achievement({ occurredAt: '2026-10-01T07:30:00.000Z' })]}
      />,
    );
    expect(markup).toContain('01.10.2026');
    expect(markup).toContain('10:30');
  });

  it('K: empty-achievements and no-Person-selected are distinct states', () => {
    const noPerson = renderToStaticMarkup(<AchievementPanel {...baseProps} />);
    const emptyList = renderToStaticMarkup(
      <AchievementPanel {...baseProps} selectedPerson={person()} />,
    );
    expect(noPerson).not.toContain('Достижений пока нет.');
    expect(emptyList).toContain('Достижений пока нет.');
    expect(noPerson).not.toEqual(emptyList);
  });

  it('achievementContextLabel: participation-linked achievement reads Event + role, not raw ids', () => {
    const target = achievement({
      participationId: '90000000-0000-4000-8000-000000000001',
      eventId: '90000000-0000-4000-8000-000000000003',
      eventTitle: 'Олимпиада по информатике',
      participationRole: { code: 'PARTICIPANT', name: 'Участник' },
    });
    expect(achievementContextLabel(target)).toBe(
      'Олимпиада по информатике · Участник',
    );
  });

  it('achievementContextLabel: manual achievement with no links returns null', () => {
    expect(achievementContextLabel(achievement())).toBeNull();
  });

  it('participation picker renders search results dynamically when linking a Participation', () => {
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        creating
        linkMode="participation"
        participationResults={[participation()]}
      />,
    );
    expect(markup).toContain('Олимпиада по информатике');
  });

  it('linkableParticipations: excludes a virtual DRAFT row (id === null), which is not a persisted foreign key', () => {
    const persisted = participation();
    const virtual = participation({
      id: null,
      eventTitle: 'Ещё не подтверждённое участие',
    });
    expect(linkableParticipations([persisted, virtual])).toEqual([persisted]);
  });

  it('the participation picker never renders a virtual (id === null) row as selectable', () => {
    const virtual = participation({
      id: null,
      eventTitle: 'Виртуальное участие без ID',
    });
    const markup = renderToStaticMarkup(
      <AchievementPanel
        {...baseProps}
        selectedPerson={person()}
        creating
        linkMode="participation"
        participationResults={[virtual]}
      />,
    );
    expect(markup).not.toContain('Виртуальное участие без ID');
  });
});
