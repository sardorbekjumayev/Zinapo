'use client';

import type { CaseDetail, FamilyDisputeDetail } from './trust-types';

/**
 * Client-side calls for the M8 screens (the staff cases queue and the family
 * side: dispute statements, answering a suspended link). Errors carry the
 * API's `{ error: 'CODE', details }`; a dropped connection is `NETWORK`.
 */
export class TrustApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'TrustApiError';
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
    throw new TrustApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new TrustApiError(typeof json.error === 'string' ? json.error : 'UNKNOWN', res.status, (json.details as Record<string, unknown>) ?? {});
  }
  return json as T;
}

const enc = encodeURIComponent;
const c = (id: string, action: string) => `/api/staff/cases/${enc(id)}/${action}`;

export const trustApi = {
  // staff
  assign: (id: string, personId: string | null) => request<CaseDetail>('POST', c(id, 'assign'), { personId }),
  note: (id: string, body: string) => request<CaseDetail>('POST', c(id, 'notes'), { body }),
  suspendLinks: (id: string, note?: string) => request<CaseDetail>('POST', c(id, 'suspend-links'), { note }),
  dismiss: (id: string, note: string) => request<CaseDetail>('POST', c(id, 'dismiss'), { note }),
  confirm: (id: string, note: string) => request<CaseDetail>('POST', c(id, 'confirm'), { note }),
  close: (id: string, note?: string) => request<CaseDetail>('POST', c(id, 'close'), { note }),
  decideFifth: (id: string, decision: 'approved' | 'rejected', note?: string) =>
    request<CaseDetail>('POST', c(id, 'fifth-child'), { decision, note }),
  decideDispute: (id: string, decision: 'keep' | 'transfer', note: string) =>
    request<CaseDetail>('POST', c(id, 'dispute'), { decision, note }),

  // family
  statement: (caseId: string, body: string) =>
    request<FamilyDisputeDetail>('POST', `/api/family/disputes/${enc(caseId)}/statements`, { body }),
  answerLink: (childId: string, linkId: string, keep: boolean) =>
    request<{ ok: true; status: 'active' | 'revoked' }>('POST', `/api/family/children/${enc(childId)}/educators/${enc(linkId)}/answer`, { keep }),
};
