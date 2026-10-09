import type { Cluster, ItemStatus } from '@/lib/bank-types';
import type { ItemRole } from './parts';

export const CLUSTERS: Cluster[] = ['numeracy', 'reasoning', 'language'];
export const STATUSES: ItemStatus[] = ['draft', 'in_review', 'accepted', 'approved', 'rejected', 'retired'];
export const ROLES: ItemRole[] = ['core', 'anchor_h', 'anchor_v', 'pretest'];
export const GRADES = [0, 1, 2, 3, 4];
export const PER_PAGE = 25;

export interface BankFilters {
  grade?: string;
  cluster?: string;
  status?: string;
  role?: string;
  lang?: string;
  q?: string;
  page?: string;
}

type Raw = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = (v: string | undefined, allowed: readonly string[]) => (v && allowed.includes(v) ? v : undefined);

/**
 * The filters live in the URL so they survive reload and back/forward. A value
 * the API would reject (400) is dropped here instead, so a hand-edited link
 * shows the unfiltered bank rather than an error page.
 */
export function parseFilters(raw: Raw): BankFilters {
  const q = one(raw.q)?.trim().slice(0, 40);
  const page = Number(one(raw.page));
  return {
    grade: pick(one(raw.grade), GRADES.map(String)),
    cluster: pick(one(raw.cluster), CLUSTERS),
    status: pick(one(raw.status), STATUSES),
    role: pick(one(raw.role), ROLES),
    lang: pick(one(raw.lang), ['uz', 'ru']),
    q: q || undefined,
    page: Number.isInteger(page) && page > 1 && page <= 1000 ? String(page) : undefined,
  };
}

export function toQuery(f: BankFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** A link to the same list with one filter changed; any filter change goes back to page 1. */
export function hrefWith(base: string, f: BankFilters, patch: Partial<BankFilters>): string {
  const next: BankFilters = { ...f, ...patch };
  if (!('page' in patch)) delete next.page;
  return base + toQuery(next);
}

export function anyFilter(f: BankFilters): boolean {
  return !!(f.grade || f.cluster || f.status || f.role || f.lang || f.q);
}
