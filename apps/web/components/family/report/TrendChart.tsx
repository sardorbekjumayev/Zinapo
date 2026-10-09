'use client';

import { useState } from 'react';
import type { TopRange, TrendState } from '@/lib/report-types';

export interface TrendColumn {
  key: string;
  label: string;
  sub: string;
  state: TrendState;
  /** Drawn only for a measured wave above the cohort minimum. */
  top: TopRange | null;
  /** "top 16–49%", or the words in an undrawn column: "not taken", "opens …". */
  position: string;
  note: string;
}

/**
 * design/03 "where heading": one column per wave of the season, the band as
 * a vertical range on a strongest-at-the-top axis. A wave not taken is an
 * empty column with words in it — never a bar at zero (task.md § 1.12).
 */
export function TrendChart({
  columns,
  max,
  initial,
  hint,
  ticks,
  table,
}: {
  columns: TrendColumn[];
  max: 50 | 100;
  initial: number;
  hint: string;
  ticks: { p: number; label: string }[];
  table: { caption: string; wave: string; position: string };
}) {
  const [sel, setSel] = useState(initial);
  const at = (p: number) => `${(Math.max(0, p) / max) * 100}%`;
  const cur = columns[sel] ?? columns[0];
  const title = (c: TrendColumn) => `${c.label} · ${c.position}`;

  return (
    <div className="rp-trend">
      <p className="rp-hint">{hint}</p>
      <div className="rp-chart">
        <div className="rp-chart__axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.p} className={t.p === 5 ? 'rp-chart__tick rp-chart__tick--zone' : 'rp-chart__tick'} style={{ top: at(t.p) }}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="rp-chart__plot">
          <div className="rp-chart__grid" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t.p} className={t.p === 5 ? 'rp-chart__line rp-chart__line--zone' : 'rp-chart__line'} style={{ top: at(t.p) }} />
            ))}
          </div>
          {columns.map((c, i) => {
            const future = c.state === 'open' || c.state === 'upcoming';
            const cls = ['rp-col'];
            if (i === sel) cls.push('rp-col--on');
            if (future) cls.push('rp-col--future');
            return (
              <button
                key={c.key}
                type="button"
                className={cls.join(' ')}
                aria-pressed={i === sel}
                aria-label={title(c)}
                onClick={() => setSel(i)}
              >
                <span className="rp-col__plot" aria-hidden="true">
                  {c.top ? (
                    <span
                      className="rp-col__band"
                      style={{ top: at(c.top.from), height: `max(12px, ${((c.top.to - c.top.from) / max) * 100}%)` }}
                    />
                  ) : (
                    <span className={future ? 'rp-col__empty rp-col__empty--future' : 'rp-col__empty'}>{c.position}</span>
                  )}
                </span>
                <span className="rp-col__label" aria-hidden="true">
                  <span>{c.label}</span>
                  <span className="rp-col__sub">{c.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rp-trend__note" aria-live="polite">
        <strong>{title(cur)}</strong>
        <span>{cur.note}</span>
      </div>

      <table className="visually-hidden">
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{table.wave}</th>
            <th scope="col">{table.position}</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.label}</th>
              <td>{c.position}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
