import Link from 'next/link';
import { Avatar } from '@/components/family/Avatar';
import { Icon } from '@/components/shell/Icon';
import type { Pupil, WaveState } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { gradeName, pick, waveName } from './labels';
import { ProgressChip } from './ProgressChip';

/**
 * design/08's pupil panel — the same content in the group page's expanded row
 * and on /educator/children/[id]. Progress categories only: no score, no
 * position, no item-by-item answers (task.md § 3, rule 1.9; note M6-a).
 */
export function PupilView({
  pupil,
  locale,
  variant = 'page',
  headingLevel = 1,
}: {
  pupil: Pupil;
  locale: Locale;
  variant?: 'page' | 'panel';
  headingLevel?: 1 | 3;
}) {
  const m = educatorMessages(locale);
  const p = m.pupil;
  const Heading = headingLevel === 1 ? 'h1' : 'h3';
  const Sub = headingLevel === 1 ? 'h2' : 'h4';
  const waveStatus = (state: WaveState, taken: boolean) =>
    taken ? p.taken : state === 'upcoming' ? p.upcoming : state === 'open' ? p.openNow : p.notTaken;
  const mistake = pupil.dominantMisconception;

  return (
    <div className={variant === 'panel' ? 'ed-pupil ed-pupil--panel' : 'ed-pupil'}>
      <header className="ed-pupil__head">
        <Avatar name={pupil.child.name} tone={pupil.isOwnChild ? 'brand' : 'teal'} size={variant === 'page' ? 'lg' : 'md'} />
        <div className="ed-pupil__who">
          {variant === 'page' && <span className="card__kicker">{p.kicker}</span>}
          <Heading className={headingLevel === 1 ? 'pageHead__title' : 'ed-pupil__name'}>{pupil.child.name}</Heading>
          <p className="fam-muted fam-small ed-pupil__meta">
            {[
              gradeName(locale, pupil.child.grade, m.common.gradeAny),
              pupil.groups.length ? fill(p.groups, { list: pupil.groups.map((g) => g.name).join(', ') }) : p.groupsNone,
            ].join(' · ')}
          </p>
        </div>
      </header>

      <div className="ed-pupil__grid">
        <section className="ed-pupil__block" aria-label={p.latest}>
          <span className="ed-label">{p.latest}</span>
          {pupil.latestProgress ? (
            <>
              <ProgressChip value={pupil.latestProgress.category} label={m.progress[pupil.latestProgress.category]} />
              <span className="fam-muted fam-small">{fill(p.latestSub, { n: pupil.latestProgress.waveOrdinal })}</span>
            </>
          ) : (
            <span className="fam-muted fam-small">{p.latestNone}</span>
          )}
        </section>

        <section className="ed-pupil__block" aria-label={p.practiceTitle}>
          <span className="ed-label">{p.practiceTitle}</span>
          <span className="ed-pupil__strong">
            {pupil.practice.assigned === 0
              ? p.practiceNone
              : fill(p.practiceLine, { assigned: pupil.practice.assigned, done: pupil.practice.done })}
          </span>
        </section>
      </div>

      <section className="ed-pupil__section">
        <Sub className="ed-label">{p.wavesTitle}</Sub>
        <ol className="ed-waveList">
          {pupil.waves.map((w) => (
            <li key={w.id} className="ed-waveList__item" data-state={w.state} data-taken={w.taken ? 'true' : 'false'}>
              <span className="ed-waveList__name">{waveName(m, w.ordinal)}</span>
              <span className="fam-muted fam-small">{waveStatus(w.state, w.taken)}</span>
              {w.progress && w.progress !== 'not_taken' && <ProgressChip value={w.progress} label={m.progress[w.progress]} />}
            </li>
          ))}
        </ol>
      </section>

      <section className="ed-pupil__section">
        <Sub className="ed-label">{p.mistakeTitle}</Sub>
        {mistake ? (
          <div className="ed-pupil__mistake">
            <strong>{pick(locale, mistake.nameUz, mistake.nameRu)}</strong>
            <p className="card__body">{pick(locale, mistake.explainUz, mistake.explainRu)}</p>
            <span className="fam-muted fam-small">{fill(p.mistakeWave, { n: mistake.waveOrdinal })}</span>
          </div>
        ) : (
          <p className="fam-muted fam-small">{p.mistakeNone}</p>
        )}
      </section>

      <p className="fam-caption">
        <Icon name="shield" size={14} />
        {pupil.isOwnChild ? p.accessOwn : fill(p.accessUntil, { date: formatDate(pupil.accessUntil, locale) })}
      </p>

      {pupil.isOwnChild && pupil.parentReportAvailable && (
        <div className="fam-note fam-note--brand">
          <Icon name="child" size={18} />
          <div className="fam-stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            <span>{p.ownNote}</span>
            <Link href={`/${locale}/family/children/${pupil.child.id}`} className="fam-btn fam-btn--sm ed-selfStart">
              {p.openReport}
              <Icon name="arrowRight" size={16} />
            </Link>
          </div>
        </div>
      )}

      <p className="fam-caption">
        <Icon name="lock" size={14} />
        {p.noScore}
      </p>

      {variant === 'panel' && (
        <Link href={`/${locale}/educator/children/${pupil.child.id}`} className="fam-btn fam-btn--sm ed-selfStart">
          {p.openPage}
          <Icon name="arrowRight" size={16} />
        </Link>
      )}
    </div>
  );
}
