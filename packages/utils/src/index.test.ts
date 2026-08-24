import { describe, expect, it } from 'vitest';

import {
  assertNever,
  registrationQrPayload,
  registrationTicketUrl,
  verifyRegistrationSignature,
} from './index';

describe('assertNever', () => {
  it('throws for an impossible runtime value', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(
      'Unexpected value',
    );
  });
});

it('signs opaque registration references and rejects tampering', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const secret = 's'.repeat(32);
  const payload = registrationQrPayload(id, secret);
  const signature = payload.split('.')[1]!;
  expect(payload).not.toContain('@');
  expect(verifyRegistrationSignature(id, signature, secret)).toBe(true);
  expect(verifyRegistrationSignature(id, `${signature}x`, secret)).toBe(false);
  expect(registrationTicketUrl(id, secret, 'https://example.test')).toContain(
    `/tickets/${id}/`,
  );
});
