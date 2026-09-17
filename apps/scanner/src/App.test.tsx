import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App, OnsiteRegistrationForm } from './App.js';
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

  it('offers parent and other participant categories onsite', () => {
    const markup = renderToStaticMarkup(
      <OnsiteRegistrationForm
        fields={[]}
        busy={false}
        onSubmit={async () => undefined}
      />,
    );
    expect(markup).toContain('<option value="PARENT">Родитель</option>');
    expect(markup).toContain('<option value="OTHER">Другое</option>');
  });
});
