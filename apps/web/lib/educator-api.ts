'use client';

import type {
  AccessRequestResult,
  ApplyInput,
  AssignmentResults,
  AssignResult,
  EducatorKind,
  EducatorProfile,
  GroupOverview,
  InviteSendResult,
  MatchLimits,
  MatchResult,
  PracticeForm,
  Pupil,
  RemindResult,
} from './educator-types';

/**
 * Client-side calls for the M6 screens (educator workspace, the family
 * practice card, the staff applications tab). Same-origin through the Next.js
 * rewrite, cookies included — the API authorises every call again.
 *
 * Errors carry the API's `{ error: 'CODE', details }`; a dropped connection
 * is `NETWORK`. Reads for the first paint belong in server components
 * (`apiGet` from lib/api-server); these are for actions and refreshes.
 */
export class EducatorApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'EducatorApiError';
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
    throw new EducatorApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new EducatorApiError(
      typeof json.error === 'string' ? json.error : 'UNKNOWN',
      res.status,
      (json.details as Record<string, unknown>) ?? {},
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

export const educatorApi = {
  // application
  apply: (input: ApplyInput) => request<EducatorProfile>('POST', '/api/educator/apply', input),
  schools: (regionId: number) =>
    request<{ id: string; name: string; district: string | null }[]>('GET', `/api/reference/schools?regionId=${regionId}`),

  // invites and access requests
  sendInvites: (phones: string[]) => request<InviteSendResult>('POST', '/api/educator/invites', { phones }),
  remindInvites: () => request<{ reminded: number }>('POST', '/api/educator/invites/remind'),
  resendInvite: (id: string) => request<{ ok: true }>('POST', `/api/educator/invites/${enc(id)}/resend`),
  matchLimits: () => request<MatchLimits>('GET', '/api/educator/match-check/limits'),
  matchCheck: (pinfl: string, familyName: string) =>
    request<MatchResult>('POST', '/api/educator/match-check', { pinfl, familyName }),
  requestAccess: (matchToken: string) =>
    request<AccessRequestResult>('POST', '/api/educator/access-requests', { matchToken }),

  // groups
  createGroup: (input: { name: string; grade?: number | null; note?: string }) =>
    request<{ id: string; created: boolean }>('POST', '/api/educator/groups', input),
  updateGroup: (id: string, patch: { name?: string; grade?: number | null; note?: string | null; archived?: boolean }) =>
    request<{ ok: true }>('PATCH', `/api/educator/groups/${enc(id)}`, patch),
  addMembers: (id: string, childIds: string[]) =>
    request<{ added: number; skipped: number }>('POST', `/api/educator/groups/${enc(id)}/members`, { childIds }),
  removeMember: (id: string, childId: string) =>
    request<{ ok: true }>('DELETE', `/api/educator/groups/${enc(id)}/members/${enc(childId)}`),
  overview: (id: string, waveId?: string) =>
    request<GroupOverview>('GET', `/api/educator/groups/${enc(id)}/overview${waveId ? `?waveId=${enc(waveId)}` : ''}`),
  remind: (groupId: string, childIds?: string[]) =>
    request<RemindResult>('POST', `/api/educator/groups/${enc(groupId)}/reminders`, childIds ? { childIds } : {}),
  pupil: (childId: string) => request<Pupil>('GET', `/api/educator/children/${enc(childId)}`),

  // practice
  buildPractice: (input: { source: 'misconception' | 'topic'; code: string; grade: number; size?: number }) =>
    request<PracticeForm>('POST', '/api/educator/practice/forms', input),
  swap: (formId: string, position: number) =>
    request<PracticeForm>('POST', `/api/educator/practice/forms/${enc(formId)}/swap`, { position }),
  assign: (input: { formId: string; childIds: string[]; groupId?: string | null }) =>
    request<AssignResult>('POST', '/api/educator/practice/assignments', input),
  repeat: (assignmentId: string, childIds: string[]) =>
    request<AssignResult>('POST', `/api/educator/practice/assignments/${enc(assignmentId)}/repeat`, { childIds }),
  undo: (assignmentId: string) => request<{ ok: true }>('DELETE', `/api/educator/practice/assignments/${enc(assignmentId)}`),
  results: (assignmentId: string) =>
    request<AssignmentResults>('GET', `/api/educator/practice/assignments/${enc(assignmentId)}/results`),

  // family side
  startPractice: (childId: string, assignmentId: string) =>
    request<{ sessionId: string; resumed: boolean }>(
      'POST',
      `/api/family/children/${enc(childId)}/practice/${enc(assignmentId)}/sessions`,
    ),

  // staff
  decide: (personId: string, decision: 'approved' | 'rejected', note?: string) =>
    request<{ personId: string; status: string }>('POST', `/api/staff/educator-applications/${enc(personId)}/decision`, { decision, note }),
  preapprove: (phone: string, kind?: EducatorKind, note?: string) =>
    request<{ phone: string; approvedNow: boolean }>('POST', '/api/staff/educator-preapprovals', { phone, kind, note }),
  cancelPreapproval: (id: string) => request<{ ok: true }>('DELETE', `/api/staff/educator-preapprovals/${enc(id)}`),
};
