import type { ActivityDirection } from '@event-registration/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  DirectionPanel,
  directionStatusLabel,
  parseDirectionCreateRequest,
  parseDirectionUpdateRequest,
  refreshFailureNotice,
} from './AdminDirection.js';

const direction = (
  overrides: Partial<ActivityDirection> = {},
): ActivityDirection => ({
  id: '80000000-0000-4000-8000-000000000001',
  tenantId: '50000000-0000-4000-8000-000000000001',
  organizationId: '51000000-0000-4000-8000-000000000001',
  code: 'PROFORIENTATION',
  name: 'Профориентация',
  description: 'Мероприятия по профориентации школьников',
  active: true,
  sortOrder: 10,
  ...overrides,
});

const baseProps = {
  canManage: true,
  busy: false,
  directions: [] as ActivityDirection[],
  mode: 'idle' as const,
  editingDirection: undefined as ActivityDirection | undefined,
  onBeginCreate: () => undefined,
  onBeginEdit: () => undefined,
  onCancelForm: () => undefined,
  onSubmitCreate: () => undefined,
  onSubmitUpdate: () => undefined,
  onActivate: () => undefined,
  onDeactivate: () => undefined,
};

describe('direction admin', () => {
  it('A: shows an empty state when there are no Directions', () => {
    const markup = renderToStaticMarkup(<DirectionPanel {...baseProps} />);
    expect(markup).toContain('Направлений пока нет.');
  });

  it('B: active and inactive Directions are visible and distinctly labeled', () => {
    const markup = renderToStaticMarkup(
      <DirectionPanel
        {...baseProps}
        directions={[
          direction({ id: 'a', code: 'ACTIVE_ONE', active: true }),
          direction({ id: 'b', code: 'INACTIVE_ONE', active: false }),
        ]}
      />,
    );
    expect(markup).toContain('ACTIVE_ONE');
    expect(markup).toContain('INACTIVE_ONE');
    expect(markup).toContain('Активно');
    expect(markup).toContain('Неактивно');
  });

  it('C: the create form exposes exactly the domain fields (code, name, description, sortOrder)', () => {
    const markup = renderToStaticMarkup(
      <DirectionPanel {...baseProps} mode="create" />,
    );
    expect(markup).toContain('name="code"');
    expect(markup).toContain('name="name"');
    expect(markup).toContain('name="description"');
    expect(markup).toContain('name="sortOrder"');
  });

  it('D: the edit form is pre-filled with the canonical values of the Direction being edited', () => {
    const target = direction({
      code: 'EXISTING_CODE',
      name: 'Существующее название',
      sortOrder: 42,
    });
    const markup = renderToStaticMarkup(
      <DirectionPanel {...baseProps} mode="edit" editingDirection={target} />,
    );
    expect(markup).toContain('EXISTING_CODE');
    expect(markup).toContain('Существующее название');
    expect(markup).toContain('value="42"');
  });

  it('E: mutation controls are hidden for a role without manage permission', () => {
    const markup = renderToStaticMarkup(
      <DirectionPanel
        {...baseProps}
        canManage={false}
        directions={[direction()]}
      />,
    );
    expect(markup).not.toContain('Добавить направление');
    expect(markup).not.toContain('Изменить');
    expect(markup).not.toContain('Деактивировать');
  });

  it('F: busy disables the create-direction button', () => {
    const markup = renderToStaticMarkup(<DirectionPanel {...baseProps} busy />);
    expect(markup).toContain('disabled=""');
  });

  it('G: the list reads by code/name, never by raw UUID as the primary label', () => {
    const target = direction();
    const markup = renderToStaticMarkup(
      <DirectionPanel {...baseProps} directions={[target]} />,
    );
    expect(markup).toContain('PROFORIENTATION');
    expect(markup).toContain('Профориентация');
    expect(markup).not.toContain(target.id);
  });

  it('H: inactive status is readable, not a raw boolean', () => {
    expect(directionStatusLabel(true)).toBe('Активно');
    expect(directionStatusLabel(false)).toBe('Неактивно');
  });

  it('I: create/update parsers gate on the full shared contract, not an ad hoc check', () => {
    const validCreate = parseDirectionCreateRequest({
      code: 'VALID_CODE',
      name: 'Валидное направление',
      description: null,
      active: true,
      sortOrder: 0,
    });
    expect(validCreate.success).toBe(true);

    const invalidCode = parseDirectionCreateRequest({
      code: 'invalid code!',
      name: 'Название',
      description: null,
      active: true,
      sortOrder: 0,
    });
    expect(invalidCode.success).toBe(false);
    if (!invalidCode.success) expect(invalidCode.field).toBe('code');

    const emptyUpdate = parseDirectionUpdateRequest({});
    expect(emptyUpdate.success).toBe(false);

    const validUpdate = parseDirectionUpdateRequest({ sortOrder: 5 });
    expect(validUpdate.success).toBe(true);
  });

  it('I(b): the create parser rejects a sortOrder above the backend bound (100 000) and accepts the boundary itself', () => {
    const base = {
      code: 'SORT_BOUND',
      name: 'Sort bound direction',
      description: null,
      active: true,
    };
    const atBoundary = parseDirectionCreateRequest({
      ...base,
      sortOrder: 100_000,
    });
    expect(atBoundary.success).toBe(true);

    const overBoundary = parseDirectionCreateRequest({
      ...base,
      sortOrder: 100_001,
    });
    expect(overBoundary.success).toBe(false);
    if (!overBoundary.success) expect(overBoundary.field).toBe('sortOrder');
  });

  it('J: the canonical refresh failure notice reads as saved-but-stale, not as a failed action', () => {
    const text = refreshFailureNotice('Направление добавлено.');
    expect(text).toBe(
      'Направление добавлено. Но не удалось обновить список. Обновите страницу.',
    );
  });
});
