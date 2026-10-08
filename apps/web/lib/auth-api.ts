import type { Locale } from './i18n';

export type LoginStatus =
  | 'PENDING'
  | 'TG_LINKED'
  | 'PHONE_MISMATCH'
  | 'CODE_SENT'
  | 'VERIFIED'
  | 'LOCKED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface StartResponse {
  requestId: string;
  deepLink: string;
  expiresAt: string;
}

export interface StatusResponse {
  status: LoginStatus;
  codeExpiresAt: string | null;
  attemptsLeft: number;
  codesLeft: number;
  expiresAt: string | null;
  terminal: boolean;
}

export interface VerifyResponse {
  next: string;
  isNewUser: boolean;
}

export type ApiErrorCode =
  | 'PHONE_INVALID'
  | 'RATE_LIMITED'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'LOCKED'
  | 'REQUEST_EXPIRED'
  | 'PHONE_MISMATCH'
  | 'BROWSER_MISMATCH'
  | 'VALIDATION_FAILED'
  | 'NETWORK';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly attemptsLeft?: number;
  readonly retryAfter?: number;

  constructor(code: ApiErrorCode, status: number, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.attemptsLeft = typeof extra.attemptsLeft === 'number' ? extra.attemptsLeft : undefined;
    this.retryAfter = typeof extra.retryAfter === 'number' ? extra.retryAfter : undefined;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  }

  const body: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const code = (payload.error as ApiErrorCode) ?? 'NETWORK';
    throw new ApiError(code, res.status, payload);
  }

  return body as T;
}

export function start(phone: string, lang: Locale): Promise<StartResponse> {
  return request<StartResponse>('/api/auth/telegram/start', {
    method: 'POST',
    body: JSON.stringify({ phone, lang }),
  });
}

export function status(requestId: string): Promise<StatusResponse> {
  return request<StatusResponse>(
    `/api/auth/telegram/status?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET' },
  );
}

export function verify(requestId: string, code: string): Promise<VerifyResponse> {
  return request<VerifyResponse>('/api/auth/telegram/verify', {
    method: 'POST',
    body: JSON.stringify({ requestId, code }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
}
