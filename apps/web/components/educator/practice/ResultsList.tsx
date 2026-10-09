import { fill } from '@/lib/i18n';
import type { AssignmentResults } from '@/lib/educator-types';
import type { PracticeMessages } from '@/messages/practice';

/**
 * Each child's line: status, and "solved X of N" once done — task.md § 1.11,
 * practice shows how many were solved and nothing else (no position, no
 * percentile). Kept hook-free so the server card and the client rows share it.
 */
export function ResultsList({
  results,
  m,
}: {
  results: Pick<AssignmentResults, 'children' | 'total' | 'summary'>;
  m: PracticeMessages['list'];
}) {
  if (results.children.length === 0) return <p className="fam-small fam-muted">{m.resultsEmpty}</p>;
  const below = results.summary.struggledBelow;
  return (
    <ul className="pr-results" aria-label={m.resultsLabel}>
      {results.children.map((c) => {
        const done = c.status === 'done' && c.solved !== null;
        const low = done && (c.solved ?? 0) < below;
        return (
          <li key={c.id} className="pr-results__row" data-status={c.status}>
            <span className="pr-results__name">{c.name}</span>
            <span className="pr-results__bar" aria-hidden="true">
              {done && (
                <span
                  className={low ? 'pr-results__fill pr-results__fill--low' : 'pr-results__fill'}
                  style={{ transform: `scaleX(${results.total ? (c.solved ?? 0) / results.total : 0})` }}
                />
              )}
            </span>
            <span className={low ? 'pr-results__val pr-results__val--low' : 'pr-results__val'}>
              {done ? fill(m.status.done, { x: c.solved ?? 0, n: results.total }) : m.status[c.status]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
