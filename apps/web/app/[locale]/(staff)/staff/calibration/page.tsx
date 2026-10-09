import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { RerunAll } from '@/components/staff/calibration/RerunAll';
import { RerunButton } from '@/components/staff/calibration/RerunButton';
import { RunCard } from '@/components/staff/calibration/RunCard';
import { RunHistory } from '@/components/staff/calibration/RunHistory';
import { GRADES, isYoung } from '@/components/staff/calibration/shared';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { CalibrationRun } from '@/lib/report-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { calibrationMessages } from '@/messages/calibration';

export const dynamic = 'force-dynamic';

/**
 * `/staff/calibration` — the bank editor's calibration runs (task.md § 8.5
 * "triggers calibration runs", § 9). Per grade: the current run the parent
 * reports read, older runs that can be made current, and a manual re-run.
 *
 * Current season only: picking another season would need `GET /staff/seasons`,
 * which is `season.manage` — a permission the bank editor does not hold.
 */
export default async function CalibrationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = calibrationMessages(locale);
  const self = `/${locale}/staff/calibration`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'calibration.run')) return noAccess;

  const res = await apiGet<CalibrationRun[]>('/api/staff/calibration-runs');
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }
  const runs = res.data;
  const seasonCode = runs[0]?.seasonCode ?? null;

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
          {seasonCode && <span className="chip chip--monitoring">{fill(m.head.seasonFmt, { s: seasonCode })}</span>}
        </div>

        <div className="cb-top">
          <section className="fam-panel cb-model" aria-labelledby="cb-model-title">
            <h2 id="cb-model-title" className="fam-panel__title">
              {m.model.title}
            </h2>
            <ul className="cb-model__list">
              {(['jobs', 'own', 'current', 'v0', 'band', 'young', 'v1'] as const).map((k) => (
                <li key={k}>{m.model[k]}</li>
              ))}
            </ul>
          </section>

          <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            <section className="fam-panel" aria-label={m.toolbar.rerunAll}>
              <RerunAll m={m} />
            </section>
            <section className="fam-panel" aria-labelledby="cb-items-title">
              <h2 id="cb-items-title" className="fam-panel__title">
                {m.items.title}
              </h2>
              <p className="fam-small fam-muted">{m.items.body}</p>
              <Link href={`/${locale}/staff/items`} className="fam-btn fam-btn--sm cb-itemsLink">
                <Icon name="bank" size={18} />
                {m.items.cta}
                <Icon name="arrowRight" size={16} />
              </Link>
            </section>
          </div>
        </div>

        {GRADES.map((g) => {
          const ofGrade = runs.filter((r) => r.grade === g);
          const current = ofGrade.find((r) => r.isCurrent) ?? null;
          const older = ofGrade.filter((r) => r !== current);
          const titleId = `cb-grade-${g}`;
          return (
            <section key={g} className="cb-grade" aria-labelledby={titleId}>
              <header className="cb-grade__head">
                <h2 id={titleId} className="cb-grade__title">
                  {fill(m.grade.titleFmt, { g })}
                </h2>
                <span className="chip chip--neutral">{isYoung(g) ? m.grade.chipSkills : m.grade.chipBands}</span>
                {ofGrade.length > 0 && (
                  <span className="cb-grade__action">
                    <RerunButton m={m} grade={g} label={m.grade.rerun} />
                  </span>
                )}
              </header>

              {ofGrade.length === 0 ? (
                <div className="cb-empty">
                  <Icon name="clock" size={20} />
                  <div>
                    <p className="cb-empty__title">{m.grade.emptyTitle}</p>
                    <p className="fam-small fam-muted">{m.grade.emptyBody}</p>
                  </div>
                </div>
              ) : (
                <>
                  {current ? (
                    <RunCard run={current} m={m} locale={locale} />
                  ) : (
                    <p className="fam-note fam-note--warn">
                      <Icon name="alert" size={18} />
                      <span>{m.grade.noCurrent}</span>
                    </p>
                  )}
                  {older.length > 0 && <RunHistory runs={older} m={m} locale={locale} open={!current} />}
                </>
              )}
            </section>
          );
        })}
      </div>
    </LiveRegion>
  );
}
