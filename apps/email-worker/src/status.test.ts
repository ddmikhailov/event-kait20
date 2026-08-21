import { describe, expect, it } from 'vitest';

import { getWorkerStatus } from './status.js';

describe('email worker shell', () => {
  it('reports its startup status', () => {
    expect(getWorkerStatus()).toEqual({
      service: 'email-worker',
      status: 'ready',
    });
  });
});
