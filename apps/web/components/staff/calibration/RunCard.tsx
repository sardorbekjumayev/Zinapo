import { Icon } from '@/components/shell/Icon';
import type { CalibrationRun } from '@/lib/report-types';
import { fill, type Locale } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { formatDec, formatWhen, isYoung, type RegionNames, triggerText, v1Params } from './shared';
import { V1Details } from './V1Details';

/**
 * The current run of one grade: what triggered it, when, what it wrote, and the
 * per-wave diagnostics (sessions, KR-20, SEM), plus the Rasch facts of a v1 run. Staff-only numbers — none of
 * this ever reaches a parent (task.md § 1.10).
 */
export function RunCard({
  run,
  m,
  locale,
  regions,
}: {
  run: CalibrationRun;
  m: CalibrationMessages;
  locale: Locale;
  regions: RegionNames;
}) {
  const young = isYoung(run.grade);
  const v1 = v1Params(run);
  const waves = Object.entries(run.params.waves ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  const tableId = `cb-waves-${run.id}`;

  const counts: { label: string; value: number | null }[] = [
    { label: m.run.sessions, value: run.sessions },
    { label: m.run.bands, value: young ? null : run.bands },
    { label: m.run.belowMinimum, value: young ? null : run.belowMinimum },
    { label: m.run.skillStates, value: run.skillStates },
    { label: m.run.itemStatistics, value: run.itemStatistics },
  ];

  return (
    <article className="cb-run" aria-label={`${m.run.current} · ${triggerText(run, m)}`}>
      <header className="cb-run__head">
        <span className="fam-inline" style={{ '--gap': '6px' } as React.CSSProperties}>
          <span className="chip chip--success">
            <Icon name="check" size={14} />
            {m.run.current}
          </span>
          <span className="chip chip--code">{m.run.method[run.method]}</span>
          {!run.finishedAt && <span className="chip chip--warning">{m.run.running}</span>}
        </span>
        <p className="cb-run__trigger">{triggerText(run, m)}</p>
        <p className="fam-small fam-muted">
          {fill(m.run.startedFmt, { d: formatWhen(run.startedAt, locale) })} ·{' '}
          {run.finishedAt ? fill(m.run.finishedFmt, { d: formatWhen(run.finishedAt, locale) }) : m.run.notFinished}
        </p>
      </header>

      <dl className="cb-counts">
        {counts.map((c) => (
          <div key={c.label} className="cb-count">
            <dt>{c.label}</dt>
            <dd>{c.value === null ? <span className="cb-count__na">{m.run.notForGrade}</span> : c.value}</dd>
          </div>
        ))}
      </dl>

      {v1 && <V1Details p={v1} m={m} locale={locale} regions={regions} />}

      <section className="cb-diag" aria-labelledby={`${tableId}-t`}>
        <div className="cb-diag__head">
          <h3 id={`${tableId}-t`} className="cb-diag__title">
            {m.run.wavesTitle}
          </h3>
          <span className="fam-small fam-muted cb-diag__note">
            <Icon name="lock" size={14} />
            {m.run.wavesNote}
          </span>
        </div>
        {waves.length === 0 ? (
          <p className="fam-small fam-muted">{m.run.noWaves}</p>
        ) : (
          <div className="cb-tableWrap">
            <table className="cb-table">
              <thead>
                <tr>
                  <th scope="col">{m.run.waveCol}</th>
                  <th scope="col">{m.run.sessionsCol}</th>
                  <th scope="col">{m.run.reliabilityCol}</th>
                  <th scope="col">{m.run.semCol}</th>
                </tr>
              </thead>
              <tbody>
                {waves.map(([ordinal, w]) => (
                  <tr key={ordinal}>
                    <th scope="row">{fill(m.run.waveFmt, { n: ordinal })}</th>
                    <td className="mono">{w.sessions}</td>
                    <td className="mono">{w.reliability === null ? m.run.noValue : formatDec(w.reliability, 2, locale)}</td>
                    <td className="mono">{w.sessions === 0 ? m.run.noValue : formatDec(w.sem, 2, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
