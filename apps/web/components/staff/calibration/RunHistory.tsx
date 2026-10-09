import type { CalibrationRun } from '@/lib/report-types';
import { fill, type Locale } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { MakeCurrentButton } from './MakeCurrentButton';
import { formatWhen, triggerText } from './shared';

/**
 * Older runs of one grade, newest first, behind a native disclosure. Every run
 * keeps its own rows (task.md § 9), so any finished one can be made current.
 */
export function RunHistory({
  runs,
  m,
  locale,
  open = false,
}: {
  runs: CalibrationRun[];
  m: CalibrationMessages;
  locale: Locale;
  open?: boolean;
}) {
  return (
    <details className="cb-history" open={open}>
      <summary className="cb-history__summary">{fill(m.history.summaryFmt, { n: runs.length })}</summary>
      <ul className="cb-history__list">
        {runs.map((r) => {
          const when = formatWhen(r.startedAt, locale);
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
              </div>
              {r.finishedAt ? (
                <MakeCurrentButton m={m} runId={r.id} grade={r.grade} when={when} />
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
