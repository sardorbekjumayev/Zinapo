'use client';

import type {
  ComputeSummary,
  FinalPackage,
  OlympiadDetail,
  RegisterResult,
  StaffVenue,
  StageKind,
  SyncResult,
  SyncSession,
} from './olympiad-types';

/**
 * Client-side calls for the M7 screens (family olympiad page, the operator's
 * admin, the proctor console and offline runner). Same-origin through the
 * Next.js rewrite, cookies included — the API authorises every call again.
 *
 * Errors carry the API's `{ error: 'CODE', details }`; a dropped connection
 * is `NETWORK` (the offline runner relies on that to queue its upload).
 */
export class OlympiadApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'OlympiadApiError';
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
    });
  } catch {
    throw new OlympiadApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new OlympiadApiError(
      typeof json.error === 'string' ? json.error : 'UNKNOWN',
      res.status,
      (json.details as Record<string, unknown>) ?? {},
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

export const olympiadApi = {
  // family
  register: (childId: string, olympiadId: string, input: { stageId?: string; venueId?: string | null; source?: string | null }) =>
    request<RegisterResult>('POST', `/api/family/children/${enc(childId)}/olympiad/${enc(olympiadId)}/register`, input),
  cancel: (childId: string, entryId: string) =>
    request<{ ok: true }>('DELETE', `/api/family/children/${enc(childId)}/olympiad/entries/${enc(entryId)}`),
  startOnline: (childId: string, entryId: string) =>
    request<{ sessionId: string; resumed: boolean }>('POST', `/api/family/children/${enc(childId)}/olympiad/entries/${enc(entryId)}/sessions`),

  // operator
  create: (input: Record<string, unknown>) => request<OlympiadDetail>('POST', '/api/staff/olympiads', input),
  update: (id: string, patch: Record<string, unknown>) => request<OlympiadDetail>('PATCH', `/api/staff/olympiads/${enc(id)}`, patch),
  setStage: (id: string, kind: StageKind, dates: { opensAt: string; closesAt: string; registrationClosesAt?: string | null }) =>
    request<OlympiadDetail>('PUT', `/api/staff/olympiads/${enc(id)}/stages/${kind}`, dates),
  setForm: (id: string, stageId: string, grade: number, formId: string) =>
    request<OlympiadDetail>('PUT', `/api/staff/olympiads/${enc(id)}/stages/${enc(stageId)}/forms/${grade}`, { formId }),
  createVenue: (id: string, input: { stageId: string; regionId?: number | null; name: string; address: string; capacity: number; startsAt: string }) =>
    request<StaffVenue[]>('POST', `/api/staff/olympiads/${enc(id)}/venues`, input),
  updateVenue: (id: string, venueId: string, patch: Record<string, unknown>) =>
    request<StaffVenue[]>('PATCH', `/api/staff/olympiads/${enc(id)}/venues/${enc(venueId)}`, patch),
  addProctor: (id: string, venueId: string, phone: string) =>
    request<StaffVenue[]>('POST', `/api/staff/olympiads/${enc(id)}/venues/${enc(venueId)}/proctors`, { phone }),
  removeProctor: (id: string, venueId: string, personId: string) =>
    request<StaffVenue[]>('DELETE', `/api/staff/olympiads/${enc(id)}/venues/${enc(venueId)}/proctors/${enc(personId)}`),
  notifyVenue: (id: string, venueId: string) =>
    request<{ sent: number; already: number }>('POST', `/api/staff/olympiads/${enc(id)}/venues/${enc(venueId)}/notify`),
  computeResults: (id: string, stageId: string) =>
    request<ComputeSummary>('POST', `/api/staff/olympiads/${enc(id)}/stages/${enc(stageId)}/results`),
  publish: (id: string, stageId: string) =>
    request<{ published: boolean; notified: number }>('POST', `/api/staff/olympiads/${enc(id)}/stages/${enc(stageId)}/publish`),

  // proctor
  checkIn: (venueId: string, entryId: string, adultMatchesOwner: boolean) =>
    request<{ ok: true }>('POST', `/api/staff/finals/${enc(venueId)}/check-in`, { entryId, adultMatchesOwner }),
  undoCheckIn: (venueId: string, entryId: string) =>
    request<{ ok: true }>('DELETE', `/api/staff/finals/${enc(venueId)}/check-in/${enc(entryId)}`),
  package: (venueId: string) => request<FinalPackage>('GET', `/api/staff/finals/${enc(venueId)}/package`),
  sync: (venueId: string, sessions: SyncSession[]) =>
    request<SyncResult>('POST', `/api/staff/finals/${enc(venueId)}/sync`, { sessions }),
};
