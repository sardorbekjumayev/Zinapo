import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { CaseKind, CaseStatus, RuleCode } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';

/** The queue's tabs, as they appear in the URL (`?tab=`). */
export const TABS = ['fraud', 'disputes', 'fifth', 'applications'] as const;
export type Tab = (typeof TABS)[number];
export const TAB_KIND: Record<Tab, CaseKind> = {
  fraud: 'fraud_flag',
  disputes: 'ownership_dispute',
  fifth: 'fifth_child',
  applications: 'educator_application',
};
export const KIND_TAB: Record<CaseKind, Tab> = {
  fraud_flag: 'fraud',
  ownership_dispute: 'disputes',
  fifth_child: 'fifth',
  educator_application: 'applications',
};

export const BUCKETS = ['open', 'waiting', 'closed'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** `/uz/staff/cases?tab=…&status=…&mine=1`, leaving out the defaults. */
export function queueHref(locale: Locale, q: { tab?: Tab; status?: Bucket; mine?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (q.tab && q.tab !== 'fraud') p.set('tab', q.tab);
  if (q.status && q.status !== 'open') p.set('status', q.status);
  if (q.mine) p.set('mine', '1');
  const s = p.toString();
  return `/${locale}/staff/cases${s ? `?${s}` : ''}`;
}

/** "14:52" in Tashkent time — the same string on the server and in the browser. */
function tashkentTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tashkent',
  }).format(new Date(iso));
}

/** "9-oktabr, 18:29" — a case's moments matter to the minute (design/15). */
export function when(iso: string | null | undefined, locale: Locale, withYear = false): string {
  if (!iso) return '';
  return `${formatDate(iso, locale, withYear)}, ${tashkentTime(iso)}`;
}

export function ruleTitle(rule: RuleCode | null, m: TrustMessages): string {
  return rule ? m.rule[rule]?.title ?? rule : m.kindTitle.fraud_flag;
}

export function sevChip(sev: number | null, m: TrustMessages): { cls: string; label: string } | null {
  if (sev === 3) return { cls: 'chip chip--danger', label: m.sev.s3 };
  if (sev === 2) return { cls: 'chip chip--warning', label: m.sev.s2 };
  if (sev === 1) return { cls: 'chip chip--neutral', label: m.sev.s1 };
  return null;
}

/** Waiting is amber; a confirmed flag is red; anything closed calmly is green. */
export function statusChip(kind: CaseKind, status: CaseStatus, resolution: string | null, m: TrustMessages) {
  let cls = 'chip chip--neutral';
  if (status === 'waiting_owner') cls = 'chip chip--warning';
  else if (status === 'dismissed') cls = 'chip chip--success';
  else if (status === 'resolved') {
    const bad = (kind === 'fraud_flag' && resolution !== 'owners_answered') || resolution === 'rejected';
    cls = bad ? 'chip chip--danger' : 'chip chip--success';
  }
  return { cls, label: m.status[status] };
}

/** The resolution in words, per kind (task.md § 8.5). */
export function resolutionText(kind: CaseKind, resolution: string | null, m: TrustMessages): string {
  if (!resolution) return '';
  const table = m.resolution[kind] as Record<string, string>;
  return table[resolution] ?? resolution;
}

export function gradeText(grade: number | null, m: TrustMessages): string {
  if (grade === null) return m.detail.noGrade;
  if (grade === 0) return m.detail.preschool;
  return fill(m.detail.grade, { n: grade });
}
