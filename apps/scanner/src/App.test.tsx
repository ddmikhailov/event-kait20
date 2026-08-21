import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('scanner shell', () => {
  it('exposes an accessible QR viewport label', () => {
    expect(renderToStaticMarkup(<App />)).toContain(
      'aria-label="Область сканирования QR"',
    );
  });
});
