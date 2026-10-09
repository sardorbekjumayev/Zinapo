'use client';

import type {
  AnonymisationRequest,
  ChangeLogPage,
  ConsentState,
  ConsentType,
  CreateChildInput,
  CreateChildResult,
  EducatorAccess,
  Enrolment,
  PendingInvite,
  School,
} from './family-types';

/**
 * Client-side calls for the family screens. Same-origin through the Next.js
 * rewrite, cookies included — the API authorises every call again (task.md
 * § 7: "Never trust the client").
 *
 * Errors carry the API's `{ error: 'CODE', details }` so a screen can map the
 * code to copy; a dropped connection is `NETWORK`.
 */
export class FamilyApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'FamilyApiError';
  }
}

/** A 2xx with a body, or the error. 202 bodies (FIFTH_CHILD_REVIEW) are errors too. */
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
    throw new FamilyApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || (typeof json.error === 'string' && res.status === 202)) {
    throw new FamilyApiError(
      typeof json.error === 'string' ? json.error : 'UNKNOWN',
      res.status,
      (json.details as Record<string, unknown>) ?? {},
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

export const familyApi = {
  // children
  createChild: (input: CreateChildInput) =>
    request<CreateChildResult>('POST', '/api/family/children', input),
  patchChild: (id: string, patch: { familyName?: string; givenName?: string; patronymic?: string }) =>
    request('PATCH', `/api/family/children/${id}`, patch),
  addEnrolment: (
    id: string,
    input: { schoolYear: number; grade: number; schoolRegionId: number; schoolId?: string },
  ) => request<Enrolment[]>('POST', `/api/family/children/${id}/enrolments`, input),
  schools: (regionId: number) => request<School[]>('GET', `/api/reference/schools?regionId=${regionId}`),
  confirmDispute: (caseId: string) =>
    request<{ caseId: string; reference: string; phone: string }>(
      'POST',
      `/api/family/ownership-disputes/${caseId}/confirm`,
    ),

  // consents
  setConsent: (childId: string, type: ConsentType, given: boolean) =>
    request<ConsentState[]>('PUT', `/api/family/children/${childId}/consents/${type}`, { given }),

  // guardians
  inviteCoGuardian: (childId: string, phone: string) =>
    request<PendingInvite>('POST', `/api/family/children/${childId}/co-guardian-invites`, { phone }),
  cancelInvite: (childId: string, inviteId: string) =>
    request<void>('DELETE', `/api/family/children/${childId}/guardian-invites/${inviteId}`),
  removeGuardian: (childId: string, personId: string) =>
    request<void>('DELETE', `/api/family/children/${childId}/guardians/${personId}`),
  /** To a current co-guardian, by their person id (the access page) or phone. */
  offerTransfer: (childId: string, to: { personId?: string; phone?: string }) =>
    request<PendingInvite>('POST', `/api/family/children/${childId}/ownership-transfer`, to),
  /** Re-issues the access token so its `ws` claim matches new relationships. */
  refreshSession: () => request<unknown>('POST', '/api/auth/refresh'),
  cancelTransfer: (childId: string) =>
    request<void>('DELETE', `/api/family/children/${childId}/ownership-transfer`),
  acceptInvite: (code: string) =>
    request<{ childId: string; role: 'owner' | 'co_guardian' }>(
      'POST',
      `/api/family/guardian-invites/${enc(code)}/accept`,
    ),
  declineInvite: (code: string) =>
    request<void>('POST', `/api/family/guardian-invites/${enc(code)}/decline`),

  // educator access
  approve: (linkId: string, validUntil: string) =>
    request<EducatorAccess>('POST', `/api/family/educator-requests/${linkId}/approve`, { validUntil }),
  decline: (linkId: string) => request<void>('POST', `/api/family/educator-requests/${linkId}/decline`),
  revoke: (childId: string, linkId: string) =>
    request<EducatorAccess>('POST', `/api/family/children/${childId}/educators/${linkId}/revoke`),
  restore: (childId: string, linkId: string) =>
    request<EducatorAccess>('POST', `/api/family/children/${childId}/educators/${linkId}/restore`),

  // privacy
  requestDeletion: (childId: string, reason?: string) =>
    request<AnonymisationRequest>('POST', `/api/family/children/${childId}/anonymisation-request`, {
      reason,
    }),
  cancelDeletion: (childId: string) =>
    request<void>('DELETE', `/api/family/children/${childId}/anonymisation-request`),

  // change log
  changelog: (childId: string, before?: string) =>
    request<ChangeLogPage>(
      'GET',
      `/api/family/children/${childId}/changelog?limit=20${before ? `&before=${before}` : ''}`,
    ),
};
