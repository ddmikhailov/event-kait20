import type {
  PersonSummary,
  StudentMembership,
  StudyGroup,
} from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminApiError } from './admin-api.js';
import {
  MembershipPanel,
  membershipError,
  membershipState,
  transferConfirmationText,
} from './AdminMembership.js';

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

const group = (overrides: Partial<StudyGroup> = {}): StudyGroup => ({
  id: '30000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  department: {
    id: '40000000-0000-4000-8000-000000000001',
    organizationId: '51000000-0000-4000-8000-000000000001',
    code: 'DEPT_A',
    name: 'Датахаб',
    active: true,
    sortOrder: 0,
  },
  name: 'ИС-21',
  code: 'IS21',
  course: 2,
  active: true,
  ...overrides,
});

const membership = (
  overrides: Partial<StudentMembership> = {},
): StudentMembership => ({
  id: '20000000-0000-4000-8000-000000000001',
  personId: '70000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  organization: 'КАИТ №20',
  departmentId: '40000000-0000-4000-8000-000000000001',
  department: 'Датахаб',
  studyGroupId: '30000000-0000-4000-8000-000000000001',
  studyGroup: 'ИС-21',
  course: 2,
  validFrom: '2026-09-01',
  validTo: null,
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
  memberships: [] as StudentMembership[],
  studyGroups: [] as StudyGroup[],
  mode: 'idle' as const,
  onBeginCreate: () => undefined,
  onBeginTransfer: () => undefined,
  onBeginClose: () => undefined,
  onCancelForm: () => undefined,
  onSubmitCreate: () => undefined,
  onSubmitTransfer: () => undefined,
  onSubmitClose: () => undefined,
};

describe('membership admin', () => {
  it('A: shows the search form when no Person is selected', () => {
    const markup = renderToStaticMarkup(<MembershipPanel {...baseProps} />);
    expect(markup).toContain('Найти человека');
    expect(markup).not.toContain('Учебная группа');
  });

  it('B: shows an empty history and the assign action for a Person with no membership', () => {
    const markup = renderToStaticMarkup(
      <MembershipPanel {...baseProps} selectedPerson={person()} />,
    );
    expect(markup).toContain('Принадлежность в этой организации не найдена.');
    expect(markup).toContain('Назначить');
    expect(markup).not.toContain('Перевести');
    expect(markup).not.toContain('>Завершить<');
  });

  it('C: shows current and historical memberships together, with transfer/close offered for the current one', () => {
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        selectedPerson={person()}
        memberships={[
          membership({
            id: '20000000-0000-4000-8000-000000000002',
            studyGroup: 'ИС-20',
            validFrom: '2025-09-01',
            validTo: '2026-08-31',
          }),
          membership(),
        ]}
      />,
    );
    expect(markup).toContain('ИС-20');
    expect(markup).toContain('ИС-21');
    expect(markup).toContain('Перевести');
    expect(markup).toContain('Завершить');
    expect(markup).not.toContain('Назначить');
  });

  it('D: renders readable group/department/course, never a raw study group UUID as the label', () => {
    const target = membership();
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        selectedPerson={person()}
        memberships={[target]}
      />,
    );
    expect(markup).toContain('ИС-21');
    expect(markup).toContain('Датахаб');
    expect(markup).toContain('>2<');
    expect(markup).not.toContain(target.studyGroupId as string);
  });

  it('E: builds the transfer target list dynamically from active StudyGroups, excluding the current one', () => {
    const current = membership();
    const otherActive = group({
      id: '30000000-0000-4000-8000-000000000002',
      name: 'ИС-22',
    });
    const inactive = group({
      id: '30000000-0000-4000-8000-000000000003',
      name: 'ИС-23 (архив)',
      active: false,
    });
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        selectedPerson={person()}
        memberships={[current]}
        studyGroups={[group(), otherActive, inactive]}
        mode="transfer"
      />,
    );
    expect(markup).toContain('ИС-22');
    expect(markup).not.toContain('ИС-23 (архив)');
    // The current group itself must not be offered as a transfer target.
    const optionsMarkup = markup.slice(
      markup.indexOf('<select name="studyGroupId"'),
    );
    expect((optionsMarkup.match(/<option/g) ?? []).length).toBeLessThan(3);
  });

  it('F: date fields use a plain type="date" input, never datetime-local', () => {
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        selectedPerson={person()}
        memberships={[membership()]}
        mode="transfer"
      />,
    );
    expect(markup).toContain('type="date"');
    expect(markup).not.toContain('type="datetime-local"');
  });

  it('G: an unauthorized (non-SUPER_ADMIN) user sees history but no mutation controls', () => {
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        canManage={false}
        selectedPerson={person()}
        memberships={[membership()]}
      />,
    );
    expect(markup).toContain('ИС-21');
    expect(markup).not.toContain('Перевести');
    expect(markup).not.toContain('Назначить');
    expect(markup).not.toContain('>Завершить<');
  });

  it('H: busy disables the mutation form controls', () => {
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        busy
        selectedPerson={person()}
        memberships={[membership()]}
        mode="transfer"
      />,
    );
    expect(markup).toContain('disabled=""');
  });

  it('I: transfer confirmation wording states both the transfer date and the D-1 closing date', () => {
    const lines = transferConfirmationText(
      'ИС-21',
      'ИС-22',
      '2026-10-01',
      '2026-01-01',
    );
    expect(lines[0]).toContain('ИС-21');
    expect(lines[0]).toContain('ИС-22');
    expect(lines[0]).toContain('01.10.2026');
    expect(lines[1]).toContain('30.09.2026');
    expect(lines).toHaveLength(2);
  });

  it('I: a retroactive transfer additionally warns that history is not rewritten', () => {
    const lines = transferConfirmationText(
      'ИС-21',
      'ИС-22',
      '2026-01-01',
      '2026-06-01',
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('не перепишет');
  });

  it('J: membershipState reports Текущая/Завершена/Запланирована correctly from plain dates', () => {
    const today = '2026-06-15';
    expect(
      membershipState(
        membership({ validFrom: '2026-01-01', validTo: null }),
        today,
      ),
    ).toBe('Текущая');
    expect(
      membershipState(
        membership({ validFrom: '2026-01-01', validTo: '2026-06-15' }),
        today,
      ),
    ).toBe('Текущая');
    expect(
      membershipState(
        membership({ validFrom: '2026-01-01', validTo: '2026-06-14' }),
        today,
      ),
    ).toBe('Завершена');
    expect(
      membershipState(
        membership({ validFrom: '2026-07-01', validTo: null }),
        today,
      ),
    ).toBe('Запланирована');
  });

  it('K: the detail view never shows a raw membership id as the primary label', () => {
    const target = membership();
    const markup = renderToStaticMarkup(
      <MembershipPanel
        {...baseProps}
        selectedPerson={person()}
        memberships={[target]}
      />,
    );
    expect(markup).not.toContain(target.id as string);
    expect(markup).not.toContain(target.organizationId as string);
  });

  it('membershipError: maps the no-op-transfer CONFLICT to a Membership-specific message (Stage 4 Final Cleanup)', () => {
    const notice = membershipError(new AdminApiError('CONFLICT', 409, 'raw'));
    expect(notice.text).toBe(
      'Выбранная группа уже является текущей принадлежностью.',
    );
  });

  it('membershipError: falls back to the shared mapper for any other code', () => {
    const notice = membershipError(
      new AdminApiError('STUDY_GROUP_NOT_FOUND', 404, 'raw'),
    );
    expect(notice.text).toBe('Учебная группа не найдена или недоступна.');
  });
});
