import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScannerApiClient } from './api-client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scanner API client', () => {
  it('turns a hung request into a bounded network error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    );
    const request = new ScannerApiClient().events();
    const assertion = expect(request).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });

    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
  });
});
