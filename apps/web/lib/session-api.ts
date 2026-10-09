'use client';

import type {
  AnswerInput,
  Bundle,
  Season,
  SessionResult,
  StaffSchool,
  StaffWave,
} from './session-types';

/**
 * Client calls for sessions (kid mode, the family "start" button) and the
 * season manager's admin. Errors carry the API code; a dropped connection is
 * `NETWORK` — kid mode treats that as "offline, keep buffering", not a failure.
 */
export class SessionApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'SessionApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new SessionApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new SessionApiError(
      typeof json.error === 'string' ? json.error : res.status === 401 ? 'UNAUTHENTICATED' : 'UNKNOWN',
      res.status,
      (json.details as Record<string, unknown>) ?? {},
    );
  }
  return json as T;
}

interface DeviceInfo {
  device?: string;
  os?: string;
  clientVersion?: string;
}

export const sessionApi = {
  // family / educator
  start: (childId: string, waveId: string) =>
    request<{ sessionId: string; resumed: boolean }>('POST', `/api/family/children/${childId}/sessions`, { waveId }),

  // kid mode
  bundle: (sessionId: string) => request<Bundle>('GET', `/api/sessions/${sessionId}/bundle`),
  /** The child pressed Start: the server sets the deadline once (idempotent). */
  begin: (sessionId: string) =>
    request<{ deadlineAt: string | null; serverTime: string }>('POST', `/api/sessions/${sessionId}/begin`),
  saveAnswers: (sessionId: string, answers: AnswerInput[], device?: DeviceInfo) =>
    request<{ saved: number; status: string; serverTime: string }>(
      'POST',
      `/api/sessions/${sessionId}/responses`,
      { answers, ...device },
    ),
  submit: (sessionId: string, answers: AnswerInput[], device?: DeviceInfo & { offline?: boolean }) =>
    request<SessionResult>('POST', `/api/sessions/${sessionId}/submit`, { answers, ...device }),
  result: (sessionId: string) => request<SessionResult>('GET', `/api/sessions/${sessionId}/result`),

  // season manager
  createSeason: (b: { code: string; nameUz: string; nameRu: string; startsOn: string; endsOn: string; makeCurrent?: boolean }) =>
    request<Season[]>('POST', '/api/staff/seasons', b),
  patchSeason: (id: string, b: Partial<{ nameUz: string; nameRu: string; startsOn: string; endsOn: string }>) =>
    request<Season[]>('PATCH', `/api/staff/seasons/${id}`, b),
  makeCurrent: (id: string) => request<Season[]>('POST', `/api/staff/seasons/${id}/current`),
  upsertWave: (b: { seasonId?: string; grade: number; ordinal: number; opensAt: string; closesAt: string; formId?: string | null }) =>
    request<StaffWave>('POST', '/api/staff/waves', b),
  patchWave: (id: string, b: { opensAt?: string; closesAt?: string; formId?: string | null }) =>
    request<StaffWave>('PATCH', `/api/staff/waves/${id}`, b),
  remind: (waveId: string) =>
    request<{ eligible: number; queued: number; throttled: number }>('POST', `/api/staff/waves/${waveId}/reminders`),
  createSchool: (b: { regionId: number; kind: string; name: string; district?: string }) =>
    request<StaffSchool[]>('POST', '/api/staff/schools', b),
  patchSchool: (id: string, b: { kind?: string; name?: string; district?: string }) =>
    request<StaffSchool[]>('PATCH', `/api/staff/schools/${id}`, b),
};
