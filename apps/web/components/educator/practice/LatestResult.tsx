import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import type { AssignmentResults } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';
import { RepeatButton } from './RepeatButton';
import { ResultsList } from './ResultsList';

/**
 * design/09 "Did it work?" for the newest set: the typical (median) solved,
 * who finished, who struggled — and "repeat for those who struggled" sits on
 * this card (task.md § 8.4.6).
 */
export function LatestResult({ r, locale, m }: { r: AssignmentResults; locale: Locale; m: PracticeMessages }) {
  const l = m.list;
  const s = r.summary;

  return (
    <section className="fam-panel pr-latest" aria-labelledby="pr-latest-title">
      <div>
        <span className="pr-kicker">{fill(l.lastOver, { date: formatDate(r.createdAt, locale, false) })}</span>
        <h2 id="pr-latest-title" className="fam-panel__title">
          {l.lastTitle}
        </h2>
        <p className="fam-panel__sub">
          {[fill(l.lastSet, { label: locale === 'ru' ? r.labelRu : r.label, n: s.assigned }), r.groupName].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="pr-stats">
        <div className="pr-stat pr-stat--teal">
          <span className="pr-stat__label">{l.stTyp}</span>
          {s.typicalSolved === null ? (
            <span className="pr-stat__sub">{l.stTypNone}</span>
          ) : (
            <>
              <span className="pr-stat__value">
                {s.typicalSolved} / {r.total}
              </span>
              <span className="pr-stat__sub">{fill(l.stTypSub, { n: r.total })}</span>
            </>
          )}
        </div>
        <div className="pr-stat">
          <span className="pr-stat__label">{l.stDone}</span>
          <span className="pr-stat__value">
            {s.completed} / {s.assigned}
          </span>
          <span className="pr-stat__sub">{s.notStarted > 0 ? fill(l.stDoneSub, { n: s.notStarted }) : l.stDoneAll}</span>
        </div>
      </div>

      <ResultsList results={r} m={l} />

      {s.completed > 0 && (
        <div className="pr-lag">
          <p className="pr-lag__text">
            {s.struggledCount > 0
              ? fill(l.lag, { k: s.struggledCount, s: s.struggledBelow, n: r.total })
              : fill(l.lagNone, { s: s.struggledBelow, n: r.total })}
          </p>
          {s.struggledCount > 0 && (
            <RepeatButton
              assignmentId={r.id}
              childIds={s.struggledIds}
              m={l}
              undoCopy={m.builder}
              common={m.common}
            />
          )}
        </div>
      )}

      <p className="fam-caption">
        <Icon name="info" size={14} />
        {l.noPct}
      </p>
    </section>
  );
}
