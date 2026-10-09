import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { LiveRegion } from '@/components/staff/review/live';
import { ReviewPanel } from '@/components/staff/review/ReviewPanel';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { ReviewQueue, ReviewView } from '@/lib/bank-types';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { reviewMessages } from '@/messages/review';

export const dynamic = 'force-dynamic';

/**
 * `/staff/review?v=<versionId>` — design/13, two-hand review (task.md § 8.5
 * "Item reviewer"). The queue on the left; the selected version on the right,
 * solved blind first. The choice lives in the URL so "next item" is a link.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const { v: wanted } = await searchParams;
  const m = reviewMessages(locale);
  const self = `/${locale}/staff/review`;
  const hrefFor = (id: string) => `${self}?v=${encodeURIComponent(id)}`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'item.review')) return noAccess;

  const queue = await apiGet<ReviewQueue>('/api/staff/review-queue');
  if (!queue.ok) {
    if (queue.status === 403) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }
  const { items, mine } = queue.data;

  const head = (
    <div className="pageHead rv-head">
      <div className="fam-stack" style={{ '--gap': '8px', flex: 1, minWidth: 0 } as React.CSSProperties}>
        <h1 className="pageHead__title">{m.page.title}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {m.page.subtitle}
        </p>
      </div>
      <dl className="rv-stats" aria-label={m.page.statsLabel}>
        <div className="rv-stat rv-stat--ok">
          <dt>{m.page.statAccepted}</dt>
          <dd>{mine.accept}</dd>
        </div>
        <div className="rv-stat rv-stat--warn">
          <dt>{m.page.statRevise}</dt>
          <dd>{mine.revise}</dd>
        </div>
        <div className="rv-stat rv-stat--bad">
          <dt>{m.page.statRejected}</dt>
          <dd>{mine.reject}</dd>
        </div>
        <div className="rv-stat">
          <dt>{m.page.statLeft}</dt>
          <dd>{items.length}</dd>
        </div>
      </dl>
    </div>
  );

  const selectedId = wanted ?? items[0]?.versionId;
  if (!selectedId) {
    return (
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        {head}
        <StateBlock
          icon="inbox"
          title={m.states.emptyTitle}
          body={m.states.emptyBody}
          links={[
            { href: `/${locale}/staff/items`, label: m.states.emptyCta, primary: true },
            { href: `/${locale}/staff/forms`, label: m.states.emptyCta2 },
          ]}
        />
      </div>
    );
  }

  // The verdict removes the item from the queue, so "next" is the entry after
  // it now — or the first one when it was last or not in the queue at all.
  const at = items.findIndex((i) => i.versionId === selectedId);
  const rest = items.filter((i) => i.versionId !== selectedId);
  const next = (at >= 0 ? items[at + 1] : undefined) ?? rest[0];
  const nextHref = next ? hrefFor(next.versionId) : self;

  const view = await apiGet<ReviewView>(`/api/staff/reviews/${encodeURIComponent(selectedId)}`);
  let right: React.ReactNode;
  if (view.ok) {
    right = <ReviewPanel key={view.data.versionId} initial={view.data} m={m} locale={locale} nextHref={nextHref} />;
  } else if (view.status === 404) {
    right = (
      <StateBlock icon="alert" title={m.states.notFoundTitle} body={m.states.notFoundBody} links={[{ href: self, label: m.queue.title }]} />
    );
  } else if (view.status === 409 || view.status === 403) {
    right = (
      <StateBlock
        icon="ban"
        title={m.states.unavailableTitle}
        body={m.states.unavailableBody}
        links={[{ href: nextHref, label: m.done.next, primary: true }]}
      />
    );
  } else {
    right = (
      <ErrorState
        title={m.states.itemErrTitle}
        body={m.states.itemErrBody}
        retryHref={hrefFor(selectedId)}
        retryLabel={m.states.retry}
      />
    );
  }

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        {head}
        <div className="rv-grid">
          <aside className="rv-side">
            <nav className="fam-panel rv-queue" aria-label={m.queue.label}>
              <div className="rv-queue__head">
                <h2 className="fam-panel__title">{m.queue.title}</h2>
                <span className="fam-small fam-muted">{fill(m.queue.leftFmt, { n: items.length })}</span>
              </div>
              {items.length > 0 && (
                <ul className="rv-queue__list">
                  {items.map((it) => (
                    <li key={it.versionId}>
                      <Link
                        href={hrefFor(it.versionId)}
                        className="rv-qitem"
                        aria-current={it.versionId === selectedId ? 'page' : undefined}
                      >
                        <span className="rv-qitem__body">
                          <span className="rv-qitem__code mono">{it.code}</span>
                          <span className="rv-qitem__sub">
                            {it.authorName} · {m.cluster[it.cluster]}
                          </span>
                        </span>
                        <span className="fam-stack" style={{ '--gap': '4px', alignItems: 'flex-end' } as React.CSSProperties}>
                          <span className="fam-tag">{fill(m.item.gradeFmt, { g: it.grade })}</span>
                          {it.solvedByMe && <span className="fam-tag fam-tag--brand">{m.queue.solvedChip}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="rv-pay">
                <span className="rv-pay__icon" aria-hidden="true">
                  <Icon name="info" size={18} />
                </span>
                <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                  <strong className="fam-small">{m.queue.payTitle}</strong>
                  <span className="fam-small fam-muted">{m.queue.payBody}</span>
                </div>
              </div>
            </nav>
          </aside>
          <div className="rv-main">{right}</div>
        </div>
      </div>
    </LiveRegion>
  );
}
