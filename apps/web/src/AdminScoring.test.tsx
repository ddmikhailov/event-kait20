import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ScoringPolicy, Season } from '@event-registration/contracts';

import { ScoringAdmin, SeasonScoringPanel } from './AdminScoring.js';

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
