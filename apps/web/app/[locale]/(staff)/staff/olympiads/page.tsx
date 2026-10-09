import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { NewOlympiad } from '@/components/staff/olympiads/NewOlympiad';
import { formatWhen, gradesText, STAGE_KINDS, titleOf } from '@/components/staff/olympiads/shared';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { OlympiadSummary } from '@/lib/olympiad-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { olympiadsMessages } from '@/messages/olympiads';

export const dynamic = 'force-dynamic';

/**
 * `/staff/olympiads` — the olympiad operator's list (task.md § 8.5): every
 * olympiad with its grades, ranking, season, entries and stage dates, plus
 * "New olympiad".
 */
export default async function OlympiadsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = olympiadsMessages(locale);
  const self = `/${locale}/staff/olympiads`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'olympiad.manage')) return noAccess;

  const res = await apiGet<OlympiadSummary[]>('/api/staff/olympiads');
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }
  const olympiads = res.data;
  const order = (k: string) => STAGE_KINDS.indexOf(k as never);

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{m.head.title}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {m.head.subtitle}
            </p>
          </div>
        </div>

        <section className="fam-panel" aria-labelledby="oa-list-title">
          <div className="fam-panel__head">
            <div>
              <h2 id="oa-list-title" className="fam-panel__title">
                {m.list.title}
              </h2>
              <p className="fam-panel__sub">{m.list.sub}</p>
            </div>
          </div>

          <NewOlympiad locale={locale} m={m} />

          {olympiads.length === 0 ? (
            <p className="fam-note">
              <Icon name="trophy" size={18} />
              <span>
                <strong>{m.list.emptyTitle}</strong> {m.list.emptyBody}
              </span>
            </p>
          ) : (
            <ul className="oa-list">
              {olympiads.map((o) => {
                const title = titleOf(o, locale);
                const stages = [...(o.stages ?? [])].sort((a, b) => order(a.kind) - order(b.kind));
                return (
                  <li key={o.id} className="oa-card">
                    <div className="oa-card__main">
                      <Link href={`${self}/${o.id}`} className="oa-card__title" aria-label={fill(m.list.openAria, { title })}>
                        {title}
                      </Link>
                      <span className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
                        <span className="chip chip--code mono">{o.slug}</span>
                        <span className="chip chip--neutral">{gradesText(o.gradeMin, o.gradeMax, m)}</span>
                        {o.isRanked ? (
                          <span className="chip chip--success">{m.list.ranked}</span>
                        ) : (
                          <span className="chip chip--warning">{m.list.marathon}</span>
                        )}
                        <span className="chip chip--monitoring">{fill(m.list.seasonFmt, { code: o.seasonCode })}</span>
                        <span className="fam-small fam-muted">{fill(m.list.entriesFmt, { n: o.entries })}</span>
                      </span>
                    </div>
                    {stages.length === 0 ? (
                      <p className="fam-small fam-muted">{m.list.noStages}</p>
                    ) : (
                      <ul className="oa-card__stages">
                        {stages.map((s) => (
                          <li key={s.kind}>
                            <span className="oa-card__stage">{m.stage[s.kind]}</span>
                            <span className="fam-small fam-muted">
                              {fill(m.stages.windowFmt, {
                                from: formatWhen(s.opensAt, locale),
                                to: formatWhen(s.closesAt, locale),
                              })}
                            </span>
                            {s.published && (
                              <span className="fam-tag fam-tag--ok">
                                <Icon name="check" size={14} />
                                {m.list.published}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </LiveRegion>
  );
}
