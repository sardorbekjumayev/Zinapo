import type { V1Params } from '@/lib/admin-types';
import { fill, type Locale } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { formatSigned, INFLATION_MIN_PAIRS, regionName, type RegionNames } from './shared';

/** One region's inflation line: the delta taken off θ, or why it was not applied. */
function inflationText(
  row: V1Params['inflation'][number],
  names: RegionNames,
  m: CalibrationMessages,
  locale: Locale,
): string {
  const region = regionName(row.regionId, names, m);
  return row.delta === null
    ? fill(m.v1.inflationNotFmt, { r: region, n: row.n, min: INFLATION_MIN_PAIRS })
    : fill(m.v1.inflationAppliedFmt, { r: region, d: formatSigned(row.delta, 2, locale), n: row.n });
}

/**
 * What a Rasch v1 run did (task.md § 9): people and items on the scale,
 * anchors held at the earlier v1 values, convergence, finals placed, and the
 * per-region inflation of the in-person final (task.md note M9-c).
 */
export function V1Details({
  p,
  m,
  locale,
  regions,
  compact = false,
}: {
  p: V1Params;
  m: CalibrationMessages;
  locale: Locale;
  regions: RegionNames;
  compact?: boolean;
}) {
  const convergence = fill(p.converged ? m.v1.convergedFmt : m.v1.notConvergedFmt, { n: p.iterations });

  if (compact) {
    return (
      <>
        <span className="fam-small fam-muted">
          {fill(m.v1.summaryFmt, { p: p.persons, i: p.items, a: p.fixedAnchors, f: p.finals })} · {convergence}
        </span>
        {p.inflation.map((row) => (
          <span key={row.regionId} className="fam-small fam-muted">
            {inflationText(row, regions, m, locale)}
          </span>
        ))}
      </>
    );
  }

  const facts: { label: string; value: string | number }[] = [
    { label: m.v1.persons, value: p.persons },
    { label: m.v1.items, value: p.items },
    { label: m.v1.anchors, value: p.fixedAnchors },
    { label: m.v1.finals, value: p.finals },
  ];

  return (
    <section className="cb-v1" aria-label={m.v1.title}>
      <div className="cb-diag__head">
        <h3 className="cb-diag__title">{m.v1.title}</h3>
        <span className={p.converged ? 'chip chip--success' : 'chip chip--warning'}>{convergence}</span>
      </div>
      <dl className="cb-v1__facts">
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {p.fixedAnchors === 0 && <p className="fam-small fam-muted">{m.v1.firstRun}</p>}
      <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <h4 className="cb-v1__sub">{m.v1.inflationTitle}</h4>
        {p.inflation.length === 0 ? (
          <p className="fam-small fam-muted">{m.v1.noInflation}</p>
        ) : (
          <ul className="cb-v1__inflation">
            {p.inflation.map((row) => (
              <li key={row.regionId} data-applied={row.delta === null ? 'false' : 'true'}>
                {inflationText(row, regions, m, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
