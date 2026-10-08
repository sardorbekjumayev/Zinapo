import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 32 random bytes, base64url — 43 chars, inside Telegram's 64-char start payload limit. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time compare of two hex digests of equal length. */
export function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** "lr_" + 24 base64url chars, used as the public login-request id. */
export function newRequestId(): string {
  return `lr_${randomBytes(18).toString('base64url')}`;
}
