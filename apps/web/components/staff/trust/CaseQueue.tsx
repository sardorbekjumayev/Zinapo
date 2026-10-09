import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { fill, type Locale } from '@/lib/i18n';
import type { CaseKind, CaseList } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { BUCKETS, type Bucket, queueHref, ruleTitle, sevChip, statusChip, TAB_KIND, TABS, type Tab, when } from './shared';

/** The four case types with their open + waiting counts; links, so the tab lives in the URL. */
export function QueueTabs({
  locale,
  m,
  tab,
  counts,
  status,
  mine,
}: {
  locale: Locale;
  m: TrustMessages;
  tab: Tab;
  counts: CaseList['counts'];
  status: Bucket;
  mine: boolean;
}) {
  const label: Record<Tab, string> = { fraud: m.tabs.fraud, disputes: m.tabs.dispute, fifth: m.tabs.fifth, applications: m.tabs.applications };
  return (
    <nav className="ts-tabs" aria-label={m.tabs.label}>
      {TABS.map((t) => {
        const c = counts[TAB_KIND[t]];
        const n = (c?.open ?? 0) + (c?.waiting ?? 0);
        // The status filter carries over except "waiting", which only flags have.
        const keep = t === 'fraud' || status !== 'waiting' ? status : 'open';
        return (
          <Link
            key={t}
            href={queueHref(locale, { tab: t, status: t === 'applications' ? undefined : keep, mine: t === 'applications' ? false : mine })}
            className="ts-tab"
            aria-current={t === tab ? 'page' : undefined}
          >
            {label[t]}
            <span className="ts-tab__count" aria-label={fill(m.tabs.count, { n })}>
              {n}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Open / Waiting for owners / Closed, and "Assigned to me" — all in the URL. */
export function QueueFilters({
  locale,
  m,
  tab,
  status,
  mine,
}: {
  locale: Locale;
  m: TrustMessages;
  tab: Tab;
  status: Bucket;
  mine: boolean;
}) {
  const label: Record<Bucket, string> = { open: m.filter.open, waiting: m.filter.waiting, closed: m.filter.closed };
  // Only a flag ever waits for owners (suspend-links); the other kinds go open → closed.
  const buckets = tab === 'fraud' ? BUCKETS : BUCKETS.filter((b) => b !== 'waiting');
  return (
    <div className="ts-filters">
      <nav className="ts-seg" aria-label={m.filter.label}>
        {buckets.map((b) => (
          <Link key={b} href={queueHref(locale, { tab, status: b, mine })} className="ts-seg__item" aria-current={b === status ? 'page' : undefined}>
            {label[b]}
          </Link>
        ))}
      </nav>
      <Link href={queueHref(locale, { tab, status, mine: !mine })} className="ts-mine" aria-current={mine ? 'true' : undefined}>
        <span className="ts-mine__box" aria-hidden="true">
          {mine && <Icon name="check" size={14} />}
        </span>
        {m.filter.mine}
      </Link>
    </div>
  );
}

const SUBJECT_LABEL: Record<CaseKind, 'subject' | 'claimant' | 'parent' | 'applicant'> = {
  fraud_flag: 'subject',
  ownership_dispute: 'claimant',
  fifth_child: 'parent',
  educator_application: 'applicant',
};

/** The list, in the API's order (severity, then oldest first). Each row opens the case. */
export function CaseRows({
  locale,
  m,
  tab,
  status,
  mine,
  list,
}: {
  locale: Locale;
  m: TrustMessages;
  tab: Tab;
  status: Bucket;
  mine: boolean;
  list: CaseList['cases'];
}) {
  if (list.length === 0) {
    const e = m.empty;
    if (mine) {
      return <StateBlock icon="user" title={e.mineT} body={e.mineB} links={[{ href: queueHref(locale, { tab, status }), label: e.seeAll, primary: true }]} />;
    }
    const copy = { open: [e.openT, e.openB], waiting: [e.waitingT, e.waitingB], closed: [e.closedT, e.closedB] }[status];
    const links = status === 'open' ? [] : [{ href: queueHref(locale, { tab }), label: e.seeOpen, primary: true }];
    return <StateBlock icon="shield" title={copy[0]} body={copy[1]} links={links} />;
  }

  return (
    <ul className="ts-list" aria-label={m.list.label}>
      {list.map((c) => {
        const sev = sevChip(c.severity, m);
        const st = statusChip(c.kind, c.status, c.resolution, m);
        const title = c.kind === 'fraud_flag' ? ruleTitle(c.rule, m) : m.kindTitle[c.kind];
        const closed = c.status === 'resolved' || c.status === 'dismissed';
        return (
          <li key={c.id}>
            <Link href={`/${locale}/staff/cases/${c.id}`} className="ts-row">
              <span className="ts-row__top">
                {sev && <span className={sev.cls}>{sev.label}</span>}
                <span className="mono ts-row__ref">{c.reference}</span>
                <span className={st.cls}>{st.label}</span>
                <span className="ts-row__when">
                  {fill(closed ? m.list.closedAt : m.list.opened, { when: when(closed ? c.resolvedAt : c.openedAt, locale) })}
                </span>
              </span>
              {c.rule && <span className="mono ts-row__code">{c.rule}</span>}
              <span className="ts-row__title">{title}</span>
              <span className="ts-row__meta">
                {c.subjectName && (
                  <span>
                    {m.list[SUBJECT_LABEL[c.kind]]}: <b>{c.subjectName}</b>
                  </span>
                )}
                {c.childName && (
                  <span>
                    {m.list.child}: <b>{c.childName}</b>
                  </span>
                )}
                <span className="ts-row__who">
                  <Icon name="user" size={14} />
                  {c.assignee ? fill(m.list.assignee, { name: c.assignee.me ? `${c.assignee.name} (${m.list.you})` : c.assignee.name }) : m.list.unassigned}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
