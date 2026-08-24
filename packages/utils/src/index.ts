import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${String(value)}`);
};

export const registrationSignature = (
  publicId: string,
  secret: string,
): string =>
  createHmac('sha256', secret)
    .update(`registration:${publicId}`)
    .digest('base64url');

export const registrationQrPayload = (
  publicId: string,
  secret: string,
): string => `${publicId}.${registrationSignature(publicId, secret)}`;

export const registrationQrPayloadHash = (payload: string): string =>
  createHash('sha256').update(payload).digest('hex');

export const registrationTicketUrl = (
  publicId: string,
  secret: string,
  baseUrl: string,
): string =>
  new URL(
    `/tickets/${encodeURIComponent(publicId)}/${encodeURIComponent(registrationSignature(publicId, secret))}`,
    baseUrl,
  ).toString();

export const verifyRegistrationSignature = (
  publicId: string,
  signature: string,
  secret: string,
): boolean => {
  const expected = Buffer.from(registrationSignature(publicId, secret));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const authLinkToken = (
  purpose: 'invitation' | 'password-reset',
  recordId: string,
  expiresAt: Date,
  secret: string,
): string => {
  const signature = createHmac('sha256', secret)
    .update(`${purpose}:${recordId}:${expiresAt.toISOString()}`)
    .digest('base64url');
  return `${recordId}.${signature}`;
};
