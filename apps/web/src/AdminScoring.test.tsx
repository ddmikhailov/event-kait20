import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ScoringAdmin } from './AdminScoring.js';

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
