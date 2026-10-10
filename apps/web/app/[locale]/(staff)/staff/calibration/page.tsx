import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { ComparePicker } from '@/components/staff/calibration/ComparePicker';
import { CompareView } from '@/components/staff/calibration/CompareView';
import { RerunAll } from '@/components/staff/calibration/RerunAll';
import { RerunButton } from '@/components/staff/calibration/RerunButton';
import { RunCard } from '@/components/staff/calibration/RunCard';
import { RunHistory } from '@/components/staff/calibration/RunHistory';
import { defaultPair, GRADES, isYoung, type RegionNames, runLabel } from '@/components/staff/calibration/shared';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import type { RunComparison } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { Region } from '@/lib/family-types';
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
 * M9: v1 (Rasch with anchor equating) runs are started here too but stay out
 * of the parent reports until made current (task.md note M9-d); `?a=&b=`
 * compares two runs of one grade before that switch.
 *
 * Current season only: picking another season would need `GET /staff/seasons`,
 * which is `season.manage` — a permission the bank editor does not hold.
 */
export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { locale: raw } = await params;
  const sp = await searchParams;
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

  const pairAsked = Boolean(sp.a && sp.b);
  const [res, regionsRes, cmpRes] = await Promise.all([
    apiGet<CalibrationRun[]>('/api/staff/calibration-runs'),
    apiGet<Region[]>('/api/reference/regions'),
    pairAsked && sp.a !== sp.b
      ? apiGet<RunComparison>(`/api/staff/calibration-runs/compare?${new URLSearchParams({ a: sp.a!, b: sp.b! })}`)
      : null,
  ]);
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }
  const runs = res.data;
  const seasonCode = runs[0]?.seasonCode ?? null;
  // Region names only label the inflation lines; without them "Region 14" still reads.
  const regions: RegionNames = Object.fromEntries(
    (regionsRes.ok ? regionsRes.data : []).map((r) => [r.id, locale === 'ru' ? r.nameRu : r.nameUz]),
  );

  const compareHref = (a: string, b: string) => `${self}?${new URLSearchParams({ a, b })}#cb-compare`;
  const finished = runs.filter((r) => r.finishedAt);
  const pickerRuns = finished.map((r) => ({ id: r.id, grade: r.grade, isCurrent: r.isCurrent, label: runLabel(r, m, locale) }));
  const pickerGrades = GRADES.filter((g) => finished.filter((r) => r.grade === g).length >= 2);
  const askedA = finished.find((r) => r.id === sp.a);
  const pickGrade = askedA && pickerGrades.includes(askedA.grade) ? askedA.grade : (pickerGrades.find((g) => g >= 3) ?? pickerGrades[0]);
  const initialPair =
    pickGrade === undefined
      ? null
      : askedA && askedA.grade === pickGrade && sp.b
        ? { grade: pickGrade, a: sp.a!, b: sp.b }
        : { grade: pickGrade, ...defaultPair(pickerRuns, pickGrade) };

  let compareResult: React.ReactNode = null;
  if (pairAsked) {
    if (sp.a === sp.b) compareResult = <p className="fam-alert" role="alert">{m.compare.samePair}</p>;
    else if (cmpRes?.ok)
      compareResult = (
        <CompareView
          data={cmpRes.data}
          m={m}
          locale={locale}
          swapHref={compareHref(sp.b!, sp.a!)}
          closeHref={`${self}#cb-compare`}
        />
      );
    else {
      const status = cmpRes && !cmpRes.ok ? cmpRes.status : 0;
      const text =
        status === 409
          ? m.compare.errNotComparable
          : status === 400 || status === 404
            ? m.compare.errNotFound
            : status === 403
              ? m.errors.FORBIDDEN
              : m.compare.errLoad;
      compareResult = (
        <p className="fam-alert" role="alert">
          {text}{' '}
          {status !== 409 && status !== 400 && status !== 404 && (
            <Link href={compareHref(sp.a!, sp.b!)}>{m.states.retry}</Link>
          )}
        </p>
      );
    }
  }

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

        <section id="cb-compare" className="fam-panel cb-compare" aria-labelledby="cb-compare-title">
          <div>
            <h2 id="cb-compare-title" className="fam-panel__title">
              {m.compare.title}
            </h2>
            <p className="fam-panel__sub">{m.compare.sub}</p>
          </div>
          {initialPair ? (
            <ComparePicker
              key={`${sp.a ?? ''}-${sp.b ?? ''}`}
              m={m}
              runs={pickerRuns}
              grades={pickerGrades}
              initial={initialPair}
              basePath={self}
            />
          ) : (
            <p className="fam-small fam-muted">{m.compare.needTwo}</p>
          )}
          {compareResult}
        </section>

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
                    <RerunButton m={m} grade={g} method="rasch_anchor_equating_v1" label={m.grade.runV1} />
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
                    <RunCard run={current} m={m} locale={locale} regions={regions} />
                  ) : (
                    <p className="fam-note fam-note--warn">
                      <Icon name="alert" size={18} />
                      <span>{m.grade.noCurrent}</span>
                    </p>
                  )}
                  {older.length > 0 && (
                    <RunHistory
                      runs={older}
                      m={m}
                      locale={locale}
                      open={!current}
                      regions={regions}
                      currentId={current?.id ?? null}
                      compareHref={compareHref}
                    />
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </LiveRegion>
  );
}
