import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScannerUpdates } from './pwa-updates.js';

afterEach(() => vi.useRealTimers());

describe('Scanner update lifecycle', () => {
  it('retains early notifications and reloads only after activation', async () => {
    const reload = vi.fn();
    const activate = vi.fn(async () => undefined);
    const updates = new ScannerUpdates(reload);
    updates.connect(activate);
    updates.onOfflineReady();
    updates.onNeedRefresh();
    expect(updates.getSnapshot()).toMatchObject({
      offlineReady: true,
      available: true,
    });
    await updates.apply();
    await updates.apply();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    updates.onNeedReload();
    updates.onNeedReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not interrupt this tab when another tab activates the update', async () => {
    const reload = vi.fn();
    const activate = vi.fn(async () => undefined);
    const updates = new ScannerUpdates(reload);
    updates.connect(activate);
    updates.onNeedRefresh();
    updates.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    await updates.apply();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });

  it('recovers from failed activation and allows an explicit retry', async () => {
    const reload = vi.fn();
    const updates = new ScannerUpdates(reload);
    updates.connect(async () => {
      throw new Error('unavailable');
    });
    updates.onNeedRefresh();
    await updates.apply();
    expect(updates.getSnapshot()).toMatchObject({
      applying: false,
      error: true,
    });
    expect(reload).not.toHaveBeenCalled();
    updates.connect(async () => updates.onNeedReload());
    await updates.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('times out without a reload; a late activation requires another click', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const updates = new ScannerUpdates(reload);
    updates.connect(async () => undefined);
    updates.onNeedRefresh();
    await updates.apply();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updates.getSnapshot()).toMatchObject({
      applying: false,
      error: true,
    });
    updates.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    await updates.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
