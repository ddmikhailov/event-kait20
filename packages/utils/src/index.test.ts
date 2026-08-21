import { describe, expect, it } from 'vitest';

import { assertNever } from './index';

describe('assertNever', () => {
  it('throws for an impossible runtime value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(
      'Unexpected value',
    );
  });
});
