import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('web shell', () => {
  it('identifies the event registration system', () => {
    expect(renderToStaticMarkup(<App />)).toContain(
      'Система регистрации на мероприятия',
    );
  });
});
