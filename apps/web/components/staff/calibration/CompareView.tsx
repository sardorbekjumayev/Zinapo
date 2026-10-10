import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { RunComparison } from '@/lib/admin-types';
import { fill, type Locale } from '@/lib/i18n';
import type { CalibrationRun } from '@/lib/report-types';
import type { CalibrationMessages } from '@/messages/calibration';
import { formatDec, formatSigned, formatWhen, isYoung } from './shared';

/**
 * Two runs of one grade side by side (task.md § 12 M9 "compare runs"): how far
 * the bands moved per wave (or how many skill states changed for grades 0–2),
 * the items whose difficulty moved most, and the inflation each run applied.
 * Counts only — no child is named.
 */
export function CompareView({
  data,
  m,
  locale,
  swapHref,
  closeHref,
}: {
  data: RunComparison;
  m: CalibrationMessages;
  locale: Locale;
  swapHref: string;
  closeHref: string;
}) {
  const t = m.compare;
  const young = isYoung(data.grade);
  const dash = m.run.noValue;
  // A difficulty is a position, not a move: no plus sign, but a typographic minus like the moves.
  const dec = (n: number | null) => (n === null ? dash : `${n < 0 ? '−' : ''}${formatDec(Math.abs(n), 2, locale)}`);
  const side = (key: 'a' | 'b') => {
    const r = data[key];
    return (
      <div className="cb-cmp__side">
        <span className="cb-cmp__letter" aria-hidden="true">
          {key.toUpperCase()}
        </span>
        <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <span className="fam-inline" style={{ '--gap': '6px' } as React.CSSProperties}>
            <span className="visually-hidden">{key === 'a' ? t.runA : t.runB}:</span>
            <span className="chip chip--code">{m.run.method[r.method as CalibrationRun['method']] ?? r.method}</span>
            {r.isCurrent && <span className="chip chip--success">{m.run.current}</span>}
          </span>
          <span className="fam-small fam-muted">{formatWhen(r.startedAt, locale)}</span>
        </div>
      </div>
    );
  };

  return (
    <article className="cb-cmp" aria-labelledby="cb-cmp-title">
      <header className="cb-cmp__head">
        <h3 id="cb-cmp-title" className="cb-diag__title">
          {fill(t.resultFmt, { g: data.grade })}
        </h3>
        <span className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
          <Link href={swapHref} className="fam-btn fam-btn--sm fam-btn--quiet">
            {t.swap}
          </Link>
          <Link href={closeHref} className="fam-btn fam-btn--sm fam-btn--quiet">
            <Icon name="x" size={16} />
            {t.close}
          </Link>
        </span>
      </header>
      <div className="cb-cmp__sides">
        {side('a')}
        {side('b')}
      </div>
      <p className="fam-small fam-muted cb-diag__note">
        <Icon name="lock" size={14} />
        {t.privacy}
      </p>

      <section className="cb-diag" aria-labelledby="cb-cmp-waves">
        <h4 id="cb-cmp-waves" className="cb-diag__title">
          {young ? t.skillsTitle : t.wavesTitle}
        </h4>
        {(young ? data.skills.length : data.waves.length) === 0 ? (
          <p className="fam-small fam-muted">{t.noWaves}</p>
        ) : young ? (
          <div className="cb-tableWrap">
            <table className="cb-table">
              <thead>
                <tr>
                  <th scope="col">{m.run.waveCol}</th>
                  <th scope="col">{t.statesCol}</th>
                  <th scope="col">{t.changedCol}</th>
                </tr>
              </thead>
              <tbody>
                {data.skills.map((s) => (
                  <tr key={s.ordinal}>
                    <th scope="row">{fill(m.run.waveFmt, { n: s.ordinal })}</th>
                    <td className="mono">{s.states}</td>
                    <td className="mono">{s.changed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="cb-tableWrap">
            <table className="cb-table">
              <thead>
                <tr>
                  <th scope="col">{m.run.waveCol}</th>
                  <th scope="col">{t.childrenCol}</th>
                  <th scope="col">{t.shiftCol}</th>
                  <th scope="col">{t.movedCol}</th>
                  <th scope="col">{t.bandsACol}</th>
                  <th scope="col">{t.bandsBCol}</th>
                </tr>
              </thead>
              <tbody>
                {data.waves.map((w) => (
                  <tr key={w.ordinal}>
                    <th scope="row">{fill(m.run.waveFmt, { n: w.ordinal })}</th>
                    <td className="mono">{w.children}</td>
                    <td className="mono">{w.meanShift === null ? dash : formatSigned(w.meanShift, 1, locale)}</td>
                    <td className="mono">{w.movedTenOrMore}</td>
                    <td className="mono">{w.bandsA}</td>
                    <td className="mono">{w.bandsB}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cb-diag" aria-labelledby="cb-cmp-items">
        <h4 id="cb-cmp-items" className="cb-diag__title">
          {t.itemsTitle}
        </h4>
        {data.items.length === 0 ? (
          <p className="fam-small fam-muted">{t.noItems}</p>
        ) : (
          <div className="cb-tableWrap">
            <table className="cb-table">
              <thead>
                <tr>
                  <th scope="col">{t.codeCol}</th>
                  <th scope="col">{t.bACol}</th>
                  <th scope="col">{t.bBCol}</th>
                  <th scope="col">{t.moveCol}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.code}>
                    <th scope="row">
                      <span className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
                        <span className="mono">{it.code}</span>
                        {it.isAnchor && <span className="fam-tag fam-tag--blue">{t.anchor}</span>}
                      </span>
                    </th>
                    <td className="mono">{dec(it.bA)}</td>
                    <td className="mono">{dec(it.bB)}</td>
                    <td className="mono">
                      {it.bA === null || it.bB === null ? dash : formatSigned(it.bB - it.bA, 2, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cb-diag" aria-labelledby="cb-cmp-infl">
        <h4 id="cb-cmp-infl" className="cb-diag__title">
          {m.v1.inflationTitle}
        </h4>
        {data.inflation.length === 0 ? (
          <p className="fam-small fam-muted">{t.noInflation}</p>
        ) : (
          <div className="cb-tableWrap">
            <table className="cb-table">
              <thead>
                <tr>
                  <th scope="col">{t.regionCol}</th>
                  <th scope="col">{t.runCol}</th>
                  <th scope="col">{t.deltaCol}</th>
                  <th scope="col">{t.pairsCol}</th>
                </tr>
              </thead>
              <tbody>
                {data.inflation.map((row) => (
                  <tr key={`${row.runId}-${row.regionId}`}>
                    <th scope="row">{locale === 'ru' ? row.regionRu : row.regionUz}</th>
                    <td>{row.runId === data.a.id ? 'A' : 'B'}</td>
                    <td className="mono">{formatSigned(row.delta, 2, locale)}</td>
                    <td className="mono">{row.n}</td>
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
