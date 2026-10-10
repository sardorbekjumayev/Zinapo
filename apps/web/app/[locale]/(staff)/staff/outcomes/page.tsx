import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { formatWhen } from '@/components/staff/calibration/shared';
import { ImportPanel } from '@/components/staff/outcomes/ImportPanel';
import { ReviewQueue } from '@/components/staff/outcomes/ReviewQueue';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import type { OutcomesSummary, PendingOutcome } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { outcomesMessages } from '@/messages/outcomes';

export const dynamic = 'force-dynamic';

/**
 * `/staff/outcomes?year=` — the outcomes operator's screen (task.md § 8.5,
 * § 12 M9): import the official admission list, review the rows the PINFL
 * hash did not match, and the reason the lists are collected at all — does a
 * child's last band predict admission? No PINFL ever reaches this page
 * (INV-06); summaries are counts only.
 */
export default async function OutcomesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const sp = await searchParams;
  const m = outcomesMessages(locale);
  const base = `/${locale}/staff/outcomes`;
  const year = /^\d{4}$/.test(sp.year ?? '') ? Number(sp.year) : null;
  const self = year === null ? base : `${base}?year=${year}`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'outcome.import')) return noAccess;

  const q = year === null ? '' : `?year=${year}`;
  // The all-years summary also supplies the year choices, so a filtered view can still switch.
  const [all, summaryRes, pendingRes] = await Promise.all([
    apiGet<OutcomesSummary>('/api/staff/outcomes'),
    year === null ? null : apiGet<OutcomesSummary>(`/api/staff/outcomes${q}`),
    apiGet<PendingOutcome[]>(`/api/staff/outcomes/pending${q}`),
  ]);
  if (!all.ok || !pendingRes.ok || (summaryRes && !summaryRes.ok)) {
    if ([all, pendingRes, summaryRes].some((r) => r && !r.ok && r.status === 403)) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }
  const summary = summaryRes?.ok ? summaryRes.data : all.data;
  const pending = pendingRes.data;
  const years = [...new Set(all.data.imports.map((i) => i.admitYear).filter((y): y is number => y !== null))].sort(
    (a, b) => b - a,
  );
  if (year !== null && !years.includes(year)) years.unshift(year);

  const s = m.summary;
  const totals: { label: string; value: number }[] = [
    { label: s.rows, value: summary.totals.rows },
    { label: s.matched, value: summary.totals.matched },
    { label: s.pending, value: summary.totals.pending },
    { label: s.notZinapo, value: summary.totals.notZinapo },
    { label: s.admitted, value: summary.totals.admitted },
  ];
  const pct = (r: number | null) => (r === null ? s.noRate : `${Math.round(r * 100)} %`);
  const h = m.history;

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

        {years.length > 0 && (
          <nav className="ad-oc-years" aria-label={m.head.yearsLabel}>
            {[null, ...years].map((y) => (
              <Link
                key={y ?? 'all'}
                href={y === null ? base : `${base}?year=${y}`}
                className="ad-oc-year"
                aria-current={y === year ? 'page' : undefined}
              >
                {y === null ? m.head.allYears : fill(m.head.yearFmt, { y })}
              </Link>
            ))}
          </nav>
        )}

        <div className="ad-oc-top">
          <ImportPanel m={m} />

          <section className="fam-panel ad-oc-panel" aria-labelledby="ad-oc-sum-title">
            <div>
              <h2 id="ad-oc-sum-title" className="fam-panel__title">
                {s.title}
              </h2>
              <p className="fam-panel__sub">{s.sub}</p>
            </div>
            {summary.totals.rows === 0 ? (
              <div className="ad-oc-empty">
                <Icon name="inbox" size={20} />
                <div>
                  <p className="ad-oc-empty__title">{s.emptyTitle}</p>
                  <p className="fam-small fam-muted">{s.emptyBody}</p>
                </div>
              </div>
            ) : (
              <>
                <dl className="ad-oc-counts">
                  {totals.map((x) => (
                    <div key={x.label}>
                      <dt>{x.label}</dt>
                      <dd>{x.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="ad-oc-tableWrap">
                  <table className="ad-oc-table">
                    <thead>
                      <tr>
                        <th scope="col">{s.bandCol}</th>
                        <th scope="col">{s.childrenCol}</th>
                        <th scope="col">{s.admittedCol}</th>
                        <th scope="col">{s.rateCol}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byBand.map((b) => (
                        <tr key={b.bucket}>
                          <th scope="row">{s.buckets[b.bucket]}</th>
                          <td>{b.children}</td>
                          <td>{b.admitted}</td>
                          <td>
                            <span className="ad-oc-rate">
                              <span className="ad-oc-rate__bar" aria-hidden="true">
                                <span style={{ width: `${Math.round((b.rate ?? 0) * 100)}%` }} />
                              </span>
                              {pct(b.rate)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="fam-small fam-muted">{s.noneNote}</p>
              </>
            )}
          </section>
        </div>

        <section className="fam-panel ad-oc-panel" aria-labelledby="ad-oc-review-title">
          <div className="ad-oc-panelHead">
            <div>
              <h2 id="ad-oc-review-title" className="fam-panel__title">
                {m.review.title}
              </h2>
              <p className="fam-panel__sub">{m.review.sub}</p>
            </div>
            {pending.length > 0 && <span className="chip chip--warning">{fill(m.review.countFmt, { n: pending.length })}</span>}
          </div>
          {pending.length === 0 ? (
            <div className="ad-oc-empty">
              <Icon name="check" size={20} />
              <div>
                <p className="ad-oc-empty__title">{m.review.emptyTitle}</p>
                <p className="fam-small fam-muted">{m.review.emptyBody}</p>
              </div>
            </div>
          ) : (
            <ReviewQueue m={m} locale={locale} rows={pending} />
          )}
        </section>

        <section className="fam-panel ad-oc-panel" aria-labelledby="ad-oc-hist-title">
          <h2 id="ad-oc-hist-title" className="fam-panel__title">
            {h.title}
          </h2>
          {summary.imports.length === 0 ? (
            <p className="fam-small fam-muted">{h.empty}</p>
          ) : (
            <div className="ad-oc-tableWrap">
              <table className="ad-oc-table">
                <thead>
                  <tr>
                    <th scope="col">{h.fileCol}</th>
                    <th scope="col">{h.yearCol}</th>
                    <th scope="col">{h.whenCol}</th>
                    <th scope="col">{h.byCol}</th>
                    <th scope="col">{h.rowsCol}</th>
                    <th scope="col">{h.matchedCol}</th>
                    <th scope="col">{h.pendingCol}</th>
                    <th scope="col">{h.invalidCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.imports.map((i) => (
                    <tr key={i.id}>
                      <th scope="row">{i.fileName}</th>
                      <td>{i.admitYear ?? h.mixedYears}</td>
                      <td>{formatWhen(i.importedAt, locale)}</td>
                      <td>{i.importedBy}</td>
                      <td>{i.rows}</td>
                      <td>{i.matched}</td>
                      <td>{i.unmatched}</td>
                      <td>{i.invalid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </LiveRegion>
  );
}
