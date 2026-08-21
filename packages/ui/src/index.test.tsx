import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './index';

describe('Button', () => {
  it('uses a safe button type by default', () => {
    expect(renderToStaticMarkup(<Button>Продолжить</Button>)).toContain(
      'type="button"',
    );
  });
});
