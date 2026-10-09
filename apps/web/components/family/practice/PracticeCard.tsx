import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import type { FamilyPractice } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import { practiceMessages } from '@/messages/practice';
import { StartPracticeButton } from './StartPracticeButton';

const TONE: Record<FamilyPractice['status'], string> = {
  not_started: 'fam-tag fam-tag--teal',
  started: 'fam-tag fam-tag--teal',
  done: 'fam-tag fam-tag--ok',
};

/**
 * Sets an educator assigned to this child. The parent sees WHAT and WHETHER —
 * never how many were solved (task.md § 3 "practice results: count only";
 * the API does not send it either). Hidden when nothing was ever assigned.
 */
export function PracticeCard({
  data,
  childId,
  childName,
  locale,
  retryHref,
}: {
  /** null: the list could not be loaded — only this card says so. */
  data: FamilyPractice[] | null;
  childId: string;
  childName: string;
  locale: Locale;
  retryHref: string;
}) {
  if (data && data.length === 0) return null;
  const m = practiceMessages(locale).family;
  const name = { name: childName };
  const errors = Object.fromEntries(Object.entries(m.errors).map(([k, v]) => [k, fill(v, name)]));

  return (
    <section className="fam-panel pr-fam" aria-labelledby="pr-fam-title">
      <div className="fam-panel__head">
        <div>
          <h2 id="pr-fam-title" className="fam-panel__title">
            {m.title}
          </h2>
          <p className="fam-panel__sub">{fill(m.sub, name)}</p>
        </div>
        <span className="chip chip--practice">{m.chip}</span>
      </div>

      {!data ? (
        <p className="fam-note fam-note--danger" role="alert">
          <Icon name="alert" size={18} />
          <span>
            {m.loadError}{' '}
            <Link href={retryHref} className="pr-link">
              {m.retry}
            </Link>
          </span>
        </p>
      ) : (
        <>
          <ul className="pr-fam__list">
            {data.map((p) => (
              <li key={p.assignmentId} className="pr-fam__item" data-status={p.status}>
                <div className="pr-fam__body">
                  <span className="pr-fam__title">{locale === 'ru' ? p.titleRu : p.title}</span>
                  <span className="fam-small fam-muted">
                    {fill(m.from, { educator: p.educatorName })} · {fill(m.assigned, { date: formatDate(p.assignedAt, locale) })} ·{' '}
                    {fill(practiceMessages(locale).common.questions, { n: p.items })}
                  </span>
                  <span className={TONE[p.status]}>
                    {p.status === 'done' ? fill(m.status.done, { date: formatDate(p.doneAt, locale) }) : m.status[p.status]}
                  </span>
                </div>
                {p.status !== 'done' && (
                  <StartPracticeButton
                    childId={childId}
                    assignmentId={p.assignmentId}
                    locale={locale}
                    label={p.status === 'started' ? m.continue : m.start}
                    errors={errors}
                  />
                )}
              </li>
            ))}
          </ul>
          {data.some((p) => p.status !== 'done') && <p className="fam-small fam-muted">{fill(m.hint, name)}</p>}
        </>
      )}
    </section>
  );
}
