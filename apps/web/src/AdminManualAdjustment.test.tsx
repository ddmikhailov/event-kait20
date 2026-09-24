import type {
  PersonScoreSummary,
  PersonScoreTransaction,
  PersonSummary,
  Season,
} from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ManualAdjustmentPanel,
  adjustmentConfirmationText,
  formatSignedPoints,
  nextRequestId,
  parseManualAdjustmentRequest,
  seasonLabel,
  transactionTypeLabel,
} from './AdminManualAdjustment.js';

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

const season = (overrides: Partial<Season> = {}): Season => ({
  id: '60000000-0000-4000-8000-000000000001',
  code: 'S2026_27',
  name: '2026/27',
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2027-07-01T00:00:00.000Z',
  active: true,
  scoringPolicyId: null,
  scoringPolicyEffectiveFrom: null,
  ...overrides,
});

const summary = (
  overrides: Partial<PersonScoreSummary> = {},
): PersonScoreSummary => ({
  seasonId: '60000000-0000-4000-8000-000000000001',
  seasonName: '2026/27',
  points: '12.5000',
  ...overrides,
});

const transaction = (
  overrides: Partial<PersonScoreTransaction> = {},
): PersonScoreTransaction => ({
  id: '90000000-0000-4000-8000-000000000009',
  seasonId: '60000000-0000-4000-8000-000000000001',
  seasonName: '2026/27',
  type: 'MANUAL_ADJUSTMENT',
  points: '5.0000',
  reason: 'Компенсация за техническую ошибку',
  participationId: null,
  createdAt: '2026-10-01T07:00:00.000Z',
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
  scoreSummary: [] as PersonScoreSummary[],
  scoreTransactions: [] as PersonScoreTransaction[],
  seasons: [] as Season[],
  creating: false,
  onBeginCreate: () => undefined,
  onCancelCreate: () => undefined,
  onSubmitCreate: () => undefined,
  pointsValue: '',
  onPointsChange: () => undefined,
};

describe('manual adjustment admin', () => {
  it('A: shows the search form when no Person is selected', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel {...baseProps} />,
    );
    expect(markup).toContain('Найти человека');
    expect(markup).not.toContain('Итого по сезонам');
  });

  it('B: shows a readable score summary once a Person is selected', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel
        {...baseProps}
        selectedPerson={person()}
        scoreSummary={[summary()]}
      />,
    );
    expect(markup).toContain('2026/27');
    expect(markup).toContain('12.5000');
  });

  it('C: a manual ledger row reads as a manual adjustment, not an award', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel
        {...baseProps}
        selectedPerson={person()}
        scoreTransactions={[transaction({ type: 'MANUAL_ADJUSTMENT' })]}
      />,
    );
    expect(markup).toContain('Ручная корректировка');
    expect(markup).not.toContain('Начисление');
  });

  it('D: mutation form is hidden for a role without manage permission', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel
        {...baseProps}
        canManage={false}
        selectedPerson={person()}
      />,
    );
    expect(markup).not.toContain('Новая корректировка');
  });

  it('E: mutation form control is visible for a manage-capable role', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel {...baseProps} selectedPerson={person()} />,
    );
    expect(markup).toContain('Новая корректировка');
  });

  it('F: Season options are built dynamically from the loaded list', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel
        {...baseProps}
        selectedPerson={person()}
        creating
        seasons={[
          season({ name: '2026/27' }),
          season({ id: 's2', name: '2027/28' }),
        ]}
      />,
    );
    expect(markup).toContain('2026/27');
    expect(markup).toContain('2027/28');
  });

  it('G: both positive and negative point strings are accepted for display formatting', () => {
    expect(formatSignedPoints('5.0000')).toBe('+5.0000');
    expect(formatSignedPoints('-3.5000')).toBe('−3.5000');
  });

  it('H: the reason field is required in the create form', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel
        {...baseProps}
        selectedPerson={person()}
        creating
      />,
    );
    expect(markup).toContain('name="reason"');
    expect(markup).toMatch(/<textarea[^>]*required/);
  });

  it('I: busy disables the create-adjustment button', () => {
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel {...baseProps} busy selectedPerson={person()} />,
    );
    expect(markup).toContain('disabled=""');
  });

  it('J: a failed submit keeps the same requestId, so a retry stays idempotent', () => {
    let counter = 0;
    const generate = () => `generated-${++counter}`;
    const first = nextRequestId('original', 'failed', generate);
    const second = nextRequestId(first, 'failed', generate);
    expect(first).toBe('original');
    expect(second).toBe('original');
    expect(counter).toBe(0);
  });

  it('K: a succeeded operation (or an explicit reset) rotates to a fresh requestId', () => {
    let counter = 0;
    const generate = () => `generated-${++counter}`;
    const afterSuccess = nextRequestId('original', 'succeeded', generate);
    expect(afterSuccess).toBe('generated-1');
    const afterReset = nextRequestId(afterSuccess, 'reset', generate);
    expect(afterReset).toBe('generated-2');
  });

  it('L: the ledger never shows a raw season/transaction UUID as the primary label', () => {
    const target = transaction();
    const markup = renderToStaticMarkup(
      <ManualAdjustmentPanel
        {...baseProps}
        selectedPerson={person()}
        scoreTransactions={[target]}
      />,
    );
    expect(markup).not.toContain(target.id);
    expect(markup).not.toContain(target.seasonId);
  });

  it('adjustmentConfirmationText: a positive amount reads as adding points', () => {
    const text = adjustmentConfirmationText('Иванов И.И.', '2026/27', '5.0000');
    expect(text).toContain('Добавить +5.0000');
    expect(text).toContain('Иванов И.И.');
    expect(text).toContain('2026/27');
  });

  it('adjustmentConfirmationText: a negative amount reads as removing points, sign stripped from the magnitude', () => {
    const text = adjustmentConfirmationText(
      'Иванов И.И.',
      '2026/27',
      '-3.5000',
    );
    expect(text).toContain('Снять 3.5000');
    expect(text).not.toContain('Снять -3.5000');
  });

  it('transactionTypeLabel/seasonLabel: data-driven, readable labels', () => {
    expect(transactionTypeLabel('AWARD')).toBe('Начисление');
    expect(transactionTypeLabel('REVERSAL')).toBe('Отмена начисления');
    expect(seasonLabel(season({ name: '2026/27' }))).toBe('2026/27');
  });

  describe('parseManualAdjustmentRequest', () => {
    const baseCandidate = {
      requestId: '11111111-1111-4111-8111-111111111111',
      personId: '22222222-2222-4222-8222-222222222222',
      seasonId: '33333333-3333-4333-8333-333333333333',
      points: '5.0000',
      reason: 'Подтверждённая ручная корректировка',
    };

    it('a valid candidate parses into the exact payload to send', () => {
      const result = parseManualAdjustmentRequest(baseCandidate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(baseCandidate);
      }
    });

    it('a too-short reason is rejected even though points alone would pass', () => {
      const result = parseManualAdjustmentRequest({
        ...baseCandidate,
        reason: 'ab',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.field).toBe('reason');
        expect(result.message).toContain('от 3 до 500');
      }
    });

    it('an out-of-range points value is rejected by the full request contract', () => {
      const result = parseManualAdjustmentRequest({
        ...baseCandidate,
        points: '1000001',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.field).toBe('points');
        expect(result.message).toContain('1 000 000');
      }
    });

    it('an explicit zero is rejected by the full request contract', () => {
      const result = parseManualAdjustmentRequest({
        ...baseCandidate,
        points: '0',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.field).toBe('points');
    });
  });
});
