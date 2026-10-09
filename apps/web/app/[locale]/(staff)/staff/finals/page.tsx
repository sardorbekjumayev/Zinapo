import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { olympiadTitle, stageLabel, whenOf } from '@/components/staff/finals/shared';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { ProctorVenue } from '@/lib/olympiad-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { finalsMessages } from '@/messages/finals';

export const dynamic = 'force-dynamic';

/**
 * `/staff/finals` — the proctor's venues (task.md § 8.5 "Proctor"): only the
 * venues this proctor is assigned to, with how many are seated, checked in and
 * submitted. Each leads to the roster and to the offline runner (note M7-a).
 */
export default async function FinalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = finalsMessages(locale);
  const self = `/${locale}/staff/finals`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'final.proctor')) return noAccess;

  const res = await apiGet<ProctorVenue[]>('/api/staff/finals');
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.common.retry} />;
  }
  const venues = res.data;

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1 className="pageHead__title">{m.venues.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {m.venues.subtitle}
          </p>
        </div>
      </div>

      {venues.length === 0 ? (
        <StateBlock icon="pin" title={m.venues.emptyTitle} body={m.venues.emptyBody} />
      ) : (
        <ul className="fn-venues">
          {venues.map((v) => {
            const stage = stageLabel(v.stageKind, m);
            const titleId = `fn-v-${v.id}`;
            return (
              <li key={v.id}>
                <article className="fam-panel fn-venue" aria-labelledby={titleId}>
                  <div className="fn-venue__head">
                    <span className="fn-over">
                      {olympiadTitle(v, locale)}
                      {stage ? ` · ${stage}` : ''}
                    </span>
                    <h2 id={titleId} className="fam-panel__title">
                      {v.name}
                    </h2>
                    <p className="fn-venue__meta">
                      <span>
                        <Icon name="pin" size={16} />
                        {[v.address, locale === 'ru' ? v.regionRu ?? v.regionUz : v.regionUz].filter(Boolean).join(' · ')}
                      </span>
                      <span>
                        <Icon name="calendar" size={16} />
                        {whenOf(v.startsAt, locale, m)}
                      </span>
                    </p>
                  </div>

                  <dl className="fn-counts">
                    <div className="fn-count">
                      <dt>{m.venues.seated}</dt>
                      <dd>
                        <span className="fn-count__num">{v.seated}</span>
                        <span className="fn-count__sub">{fill(m.venues.seatsFmt, { n: v.seated, cap: v.capacity })}</span>
                      </dd>
                    </div>
                    <div className="fn-count">
                      <dt>{m.venues.checkedIn}</dt>
                      <dd>
                        <span className="fn-count__num">{v.checkedIn}</span>
                      </dd>
                    </div>
                    <div className="fn-count">
                      <dt>{m.venues.submitted}</dt>
                      <dd>
                        <span className="fn-count__num">{v.submitted}</span>
                      </dd>
                    </div>
                  </dl>

                  <div className="fam-inline" style={{ '--gap': '12px' } as React.CSSProperties}>
                    <Link href={`${self}/${v.id}`} className="fam-btn fam-btn--primary">
                      <Icon name="list" size={18} />
                      {m.venues.openRoster}
                    </Link>
                    <Link href={`${self}/${v.id}/runner`} className="fam-btn">
                      <Icon name="play" size={18} />
                      {m.venues.openRunner}
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <section className="fam-panel" aria-labelledby="fn-how">
        <h2 id="fn-how" className="fam-panel__title">
          {m.venues.howTitle}
        </h2>
        <ol className="fn-steps">
          {[m.venues.how1, m.venues.how2, m.venues.how3, m.venues.how4].map((s, i) => (
            <li key={i}>
              <span className="fn-steps__n" aria-hidden="true">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
