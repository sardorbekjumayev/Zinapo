'use client';

import type {
  Candidate,
  DraftPatch,
  FormMode,
  FormView,
  ItemCard,
  MediaRef,
  PlanSlot,
  ReviewView,
  Taxonomy,
  BankOverview,
} from './bank-types';

/**
 * Client-side calls for the staff item bank and form builder. Same-origin
 * through the Next.js rewrite; the API authorises every call again by staff
 * role (403) — the UI only hides what a role cannot do.
 */
export class BankApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'BankApiError';
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
    throw new BankApiError('NETWORK', 0);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new BankApiError(
      typeof json.error === 'string' ? json.error : res.status === 403 ? 'FORBIDDEN' : 'UNKNOWN',
      res.status,
      (json.details as Record<string, unknown>) ?? {},
    );
  }
  return json as T;
}

export const bankApi = {
  // taxonomy (bank editor writes)
  createTopic: (b: Record<string, unknown>) => request<Taxonomy>('POST', '/api/staff/taxonomy/topics', b),
  patchTopic: (code: string, b: Record<string, unknown>) =>
    request<Taxonomy>('PATCH', `/api/staff/taxonomy/topics/${encodeURIComponent(code)}`, b),
  createSkill: (b: Record<string, unknown>) => request<Taxonomy>('POST', '/api/staff/taxonomy/skills', b),
  patchSkill: (code: string, b: Record<string, unknown>) =>
    request<Taxonomy>('PATCH', `/api/staff/taxonomy/skills/${encodeURIComponent(code)}`, b),
  createMisconception: (b: Record<string, unknown>) =>
    request<Taxonomy>('POST', '/api/staff/taxonomy/misconceptions', b),
  patchMisconception: (code: string, b: Record<string, unknown>) =>
    request<Taxonomy>('PATCH', `/api/staff/taxonomy/misconceptions/${encodeURIComponent(code)}`, b),
  setMisconceptionRetired: (code: string, retired: boolean) =>
    request<Taxonomy>(
      'POST',
      `/api/staff/taxonomy/misconceptions/${encodeURIComponent(code)}/${retired ? 'retire' : 'restore'}`,
    ),

  // items
  createItem: (b: { grade: number; topicCode: string; skillCode?: string; construct: string }) =>
    request<{ id: string; code: string }>('POST', '/api/staff/items', b),
  saveDraft: (id: string, patch: DraftPatch) => request<ItemCard>('PUT', `/api/staff/items/${id}/draft`, patch),
  submit: (id: string) => request<ItemCard>('POST', `/api/staff/items/${id}/submit`),
  newVersion: (id: string) => request<ItemCard>('POST', `/api/staff/items/${id}/versions`),
  approve: (id: string) => request<ItemCard>('POST', `/api/staff/items/${id}/approve`),
  retire: (id: string) => request<ItemCard>('POST', `/api/staff/items/${id}/retire`),
  setAnchor: (id: string, isAnchor: boolean, kind?: 'horizontal' | 'vertical') =>
    request<ItemCard>('PUT', `/api/staff/items/${id}/anchor`, { isAnchor, kind }),
  setTargets: (targets: { grade: number; target: number }[]) =>
    request<BankOverview>('PUT', '/api/staff/items/targets', { targets }),

  /** multipart upload; `kind` decides the allowed types (PNG/JPEG/SVG ≤ 2 MB, MP3 ≤ 3 MB). */
  async upload(kind: 'image' | 'audio', file: File): Promise<MediaRef & { kind: string; mime: string; bytes: number }> {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file);
    let res: Response;
    try {
      res = await fetch('/api/staff/media', { method: 'POST', credentials: 'include', body: fd });
    } catch {
      throw new BankApiError('NETWORK', 0);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new BankApiError(String(json.error ?? 'UNKNOWN'), res.status, (json.details as Record<string, unknown>) ?? {});
    }
    return json as unknown as MediaRef & { kind: string; mime: string; bytes: number };
  },

  // review
  review: (versionId: string) => request<ReviewView>('GET', `/api/staff/reviews/${versionId}`),
  solve: (versionId: string, optionId: string) =>
    request<ReviewView>('POST', `/api/staff/reviews/${versionId}/solve`, { optionId }),
  verdict: (versionId: string, verdict: 'accept' | 'revise' | 'reject', note?: string) =>
    request<ReviewView>('POST', `/api/staff/reviews/${versionId}/verdict`, { verdict, note }),

  // forms
  createForm: (b: { mode: FormMode; grade: number; label: string; template?: boolean }) =>
    request<FormView>('POST', '/api/staff/forms', b),
  setPlan: (id: string, plan: PlanSlot[]) => request<FormView>('PUT', `/api/staff/forms/${id}/plan`, { plan }),
  candidates: (id: string, position: number, f: { cluster?: string; topic?: string; q?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    return request<Candidate[]>('GET', `/api/staff/forms/${id}/positions/${position}/candidates?${q}`);
  },
  fill: (id: string, position: number, itemVersionId: string | null) =>
    request<FormView>('PUT', `/api/staff/forms/${id}/positions/${position}`, { itemVersionId }),
  freeze: (id: string) => request<FormView>('POST', `/api/staff/forms/${id}/freeze`),
  copy: (id: string) => request<FormView>('POST', `/api/staff/forms/${id}/copy`),
};
