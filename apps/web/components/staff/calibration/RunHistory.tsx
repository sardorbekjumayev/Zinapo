import Link from 'next/link';
import type { CalibrationRun } from '@/lib/report-types';
import { fill, type Locale } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { MakeCurrentButton } from './MakeCurrentButton';
import { formatWhen, type RegionNames, triggerText, v1Params } from './shared';
import { V1Details } from './V1Details';

/**
 * Older runs of one grade, newest first, behind a native disclosure. Every run
 * keeps its own rows (task.md § 9), so any finished one can be made current.
 */
export function RunHistory({
  runs,
  m,
  locale,
  open = false,
  regions,
  currentId,
  compareHref,
}: {
  runs: CalibrationRun[];
  m: CalibrationMessages;
  locale: Locale;
  open?: boolean;
  regions: RegionNames;
  /** The grade's current run, the other side of "Compare with current". */
  currentId: string | null;
  compareHref: (a: string, b: string) => string;
}) {
  return (
    <details className="cb-history" open={open}>
      <summary className="cb-history__summary">{fill(m.history.summaryFmt, { n: runs.length })}</summary>
      <ul className="cb-history__list">
        {runs.map((r) => {
          const when = formatWhen(r.startedAt, locale);
          const v1 = v1Params(r);
          return (
            <li key={r.id} className="cb-old">
              <div className="cb-old__main">
                <span className="cb-old__trigger">{triggerText(r, m)}</span>
                <span className="fam-small fam-muted">
                  {when} · {m.run.method[r.method]}
                </span>
                <span className="fam-small fam-muted">
                  {fill(m.run.summaryFmt, { s: r.sessions, b: r.bands, k: r.skillStates })}
                </span>
                {v1 && <V1Details p={v1} m={m} locale={locale} regions={regions} compact />}
              </div>
              {r.finishedAt ? (
                <span className="cb-old__actions">
                  {currentId && (
                    <Link href={compareHref(currentId, r.id)} className="fam-btn fam-btn--sm fam-btn--quiet">
                      {m.history.compare}
                    </Link>
                  )}
                  <MakeCurrentButton m={m} runId={r.id} grade={r.grade} when={when} v1={v1 !== null} />
                </span>
              ) : (
                <span className="chip chip--warning">{m.run.running}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
