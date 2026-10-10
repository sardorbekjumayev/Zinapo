'use client';

import type { ImportResult, OutcomeCandidate, StaffRoles } from './admin-types';

/**
 * Client-side calls for the M9 screens (calibration v1 + compare, outcomes,
 * support, roles, audit). Errors carry the API's `{ error, details }`; a
 * dropped connection is `NETWORK`.
 */
export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'AdminApiError';
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
    throw new AdminApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AdminApiError(typeof json.error === 'string' ? json.error : 'UNKNOWN', res.status, (json.details as Record<string, unknown>) ?? {});
  return json as T;
}

const enc = encodeURIComponent;

export const adminApi = {
  // calibration
  runV1: (grade?: number) => request<{ runs: string[] }>('POST', '/api/staff/calibration-runs', { method: 'rasch_anchor_equating_v1', grade }),
  // outcomes
  importOutcomes: (fileName: string, csv: string) => request<ImportResult>('POST', '/api/staff/outcomes/import', { fileName, csv }),
  outcomeCandidates: (id: string) => request<OutcomeCandidate[]>('GET', `/api/staff/outcomes/${enc(id)}/candidates`),
  matchOutcome: (id: string, childId: string) => request<{ ok: true }>('POST', `/api/staff/outcomes/${enc(id)}/match`, { childId }),
  notZinapo: (id: string) => request<{ ok: true }>('POST', `/api/staff/outcomes/${enc(id)}/not-zinapo`),
  // support
  resendInvite: (id: string, kind: 'guardian' | 'educator') =>
    request<{ resent: boolean }>('POST', `/api/staff/people/invites/${enc(id)}/resend`, { kind }),
  cancelLogin: (requestId: string, phone: string) =>
    request<{ ok: true }>('POST', `/api/staff/people/login-requests/${enc(requestId)}/cancel`, { phone }),
  // super admin
  grantRole: (phone: string, role: string) => request<StaffRoles>('POST', '/api/staff/roles', { phone, role }),
  revokeRole: (assignmentId: string) => request<StaffRoles>('DELETE', `/api/staff/roles/${enc(assignmentId)}`),
};
