import { describe, expect, it } from 'vitest';
import { acceptQrRead } from './qr-repeat-guard.js';

describe('continuous camera duplicate guard', () => {
  it('does not re-read a ticket held in view, even after confirmation resumes the camera', () => {
    const state = { value: '', lastSeenAt: 0 };
    expect(acceptQrRead(state, 'test-ticket-a', 100)).toBe(true);
    expect(acceptQrRead(state, 'test-ticket-a', 6000)).toBe(false);
    expect(acceptQrRead(state, 'test-ticket-a', 6100)).toBe(false);
    expect(acceptQrRead(state, 'test-ticket-b', 6200)).toBe(true);
  });
  it('re-arms only after removal, not a momentary undecodable frame', () => {
    const state = { value: 'test-ticket-a', lastSeenAt: 100 };
    expect(acceptQrRead(state, undefined, 200)).toBe(false);
    expect(acceptQrRead(state, 'test-ticket-a', 300)).toBe(false);
    expect(acceptQrRead(state, undefined, 1300)).toBe(false);
    expect(acceptQrRead(state, 'test-ticket-a', 1400)).toBe(true);
  });
});
