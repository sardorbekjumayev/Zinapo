export const LOGIN_STATUSES = [
  'PENDING',
  'TG_LINKED',
  'PHONE_MISMATCH',
  'CODE_SENT',
  'VERIFIED',
  'LOCKED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type LoginStatus = (typeof LOGIN_STATUSES)[number];

export const TERMINAL_STATUSES: LoginStatus[] = [
  'PHONE_MISMATCH',
  'VERIFIED',
  'LOCKED',
  'CANCELLED',
  'EXPIRED',
];

export type Lang = 'uz' | 'ru' | 'en';

export interface LoginRequest {
  id: string;
  phone: string;
  lang: Lang;
  tokenHash: string;
  bindHash: string;
  status: LoginStatus;
  tgUserId: number | null;
  chatId: number | null;
  codeExpiresAt: number | null;
  attempts: number;
  codesIssued: number;
  lastCodeAt: number | null;
  firstName: string | null;
  lastName: string | null;
  ua: string;
  ip: string;
  createdAt: number;
  expiresAt: number;
}

/** signin.md § 3 — limits. */
export const LIMITS = {
  requestTtlSec: 600,
  codeTtlSec: 120,
  maxAttempts: 5,
  maxCodes: 3,
  newCodeCooldownSec: 30,
  startPerPhone: { limit: 3, ttlSec: 600 },
  startPerIp: { limit: 10, ttlSec: 3600 },
  verifyPerIp: { limit: 10, ttlSec: 60 },
} as const;
