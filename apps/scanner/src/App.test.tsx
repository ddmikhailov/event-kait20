import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import { QrCamera } from './QrCamera.js';

describe('scanner shell', () => {
  it('starts with a non-sensitive loading screen', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('Загружаем Scanner');
    expect(markup).not.toContain('password');
  });

  it('exposes an accessible QR viewport label', () => {
    expect(
      renderToStaticMarkup(
        <QrCamera active={false} onDecode={() => undefined} />,
      ),
    ).toContain('aria-label="Область сканирования QR"');
  });
});
