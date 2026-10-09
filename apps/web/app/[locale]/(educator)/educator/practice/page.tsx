import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { AssignmentRow } from '@/components/educator/practice/AssignmentRow';
import { LatestResult } from '@/components/educator/practice/LatestResult';
import { ModeBanner } from '@/components/educator/practice/ModeBanner';
import { NotApproved } from '@/components/educator/practice/NotApproved';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import { formatDate } from '@/lib/format';
import type { AssignmentResults, AssignmentSummary, GroupList } from '@/lib/educator-types';
import { isLocale } from '@/lib/i18n';
import { practiceMessages } from '@/messages/practice';

export const dynamic = 'force-dynamic';

/**
 * `/educator/practice` — the sets sent (newest first, as the API orders them)
 * and how many each child solved (task.md § 8.4.6, design/09). Never a
 * percentile or a position (§ 1.11).
 */
export default async function PracticeListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { group } = await searchParams;
  const m = practiceMessages(locale);
  const l = m.list;
  const groupId = group && /^[0-9a-f-]{36}$/i.test(group) ? group : null;
  const self = `/${locale}/educator/practice${groupId ? `?group=${groupId}` : ''}`;

  const [listRes, groupsRes] = await Promise.all([
    apiGet<AssignmentSummary[]>(`/api/educator/practice/assignments${groupId ? `?groupId=${groupId}` : ''}`),
    apiGet<GroupList>('/api/educator/groups'),
  ]);

  if (!listRes.ok) {
    if (listRes.status === 403) return <NotApproved locale={locale} m={m.common} />;
    return <ErrorState title={l.errTitle} body={l.errBody} retryHref={self} retryLabel={m.common.retry} />;
  }
  const list = listRes.data;
  const groups = groupsRes.ok ? groupsRes.data.groups : [];
  const latest = list[0] ?? null;
  const latestRes = latest ? await apiGet<AssignmentResults>(`/api/educator/practice/assignments/${latest.id}/results`) : null;
  const newHref = `/${locale}/educator/practice/new${groupId ? `?group=${groupId}` : ''}`;

  const head = (
    <div className="pageHead">
      <div className="pr-head">
        <span className="card__kicker">{l.kicker}</span>
        <h1 className="pageHead__title">{l.title}</h1>
        <p className="card__body">{l.sub}</p>
      </div>
      <Link href={newHref} className="fam-btn fam-btn--primary">
        <Icon name="plus" size={18} />
        {l.newSet}
      </Link>
    </div>
  );

  const filter = groups.length > 1 && (
    <nav className="pr-filter" aria-label={l.filterLabel}>
      {[{ id: null as string | null, name: l.filterAll }, ...groups].map((g) => (
        <Link
          key={g.id ?? 'all'}
          href={`/${locale}/educator/practice${g.id ? `?group=${g.id}` : ''}`}
          className={g.id === groupId ? 'pr-chip pr-chip--on' : 'pr-chip'}
          aria-current={g.id === groupId ? 'page' : undefined}
        >
          {g.name}
        </Link>
      ))}
    </nav>
  );

  if (list.length === 0) {
    // The common mistakes live on a group's page (design/08); the first group is the way in.
    const firstGroup = groups.find((g) => g.memberCount > 0) ?? groups[0];
    return (
      <>
        <ModeBanner m={m.mode} />
        {head}
        {filter}
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="list" size={26} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className="state__title">{groupId ? l.filteredEmpty : l.emptyTitle}</h2>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {l.emptyBody}
            </p>
          </div>
          <div className="fam-inline" style={{ '--gap': '12px' } as React.CSSProperties}>
            <Link
              href={firstGroup ? `/${locale}/educator/groups/${groupId ?? firstGroup.id}` : `/${locale}/educator/practice/new`}
              className="fam-btn fam-btn--primary"
            >
              {l.emptyCta}
            </Link>
            <Link
              href={`/${locale}/educator/practice/new?source=topic${groupId ? `&group=${groupId}` : ''}`}
              className="fam-btn"
            >
              {l.emptyAlt}
            </Link>
          </div>
        </section>
      </>
    );
  }

  const earlier = latestRes?.ok ? list.slice(1) : list;

  return (
    <>
      <ModeBanner m={m.mode} />
      {head}
      {filter}
      <div className="pr-listGrid">
        {latestRes?.ok ? (
          <LatestResult r={latestRes.data} locale={locale} m={m} />
        ) : (
          <p className="fam-note fam-note--danger" role="alert">
            <Icon name="alert" size={18} />
            <span>
              {l.resultsError}{' '}
              <Link href={self} className="pr-link">
                {m.common.retry}
              </Link>
            </span>
          </p>
        )}

        {earlier.length > 0 && (
          <section className="fam-panel" aria-labelledby="pr-earlier-title">
            <h2 id="pr-earlier-title" className="fam-panel__title">
              {l.earlierTitle}
            </h2>
            <ul className="pr-rows">
              {earlier.map((a) => (
                <AssignmentRow
                  label={locale === 'ru' ? a.labelRu : a.label}
                  key={a.id}
                  a={a}
                  dateLabel={formatDate(a.createdAt, locale)}
                  m={l}
                  retryLabel={m.common.retry}
                />
              ))}
            </ul>
            <p className="fam-caption">
              <Icon name="info" size={14} />
              {l.noPct}
            </p>
          </section>
        )}
      </div>
    </>
  );
}
