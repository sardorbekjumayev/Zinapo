import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { ChildWave, ChildWaves } from '@/lib/session-types';
import { wavesMessages } from '@/messages/waves';
import { StartWaveButton } from './StartWaveButton';

const TONE: Record<ChildWave['state'], string> = {
  upcoming: 'fam-tag',
  open: 'fam-tag fam-tag--brand',
  in_progress: 'fam-tag fam-tag--brand',
  taken: 'fam-tag fam-tag--ok',
  missed: 'fam-tag',
};

/**
 * The child's waves this season (task.md § 8.1.4 "Take a wave"): an open wave
 * is a big Start, a started one is Continue, the rest is dates. Owner and
 * co-guardian alike may start one (§ 3, § 8.2).
 *
 * Dates only — never a score, and never a countdown (§ 1.10): the clock
 * belongs inside kid mode, not on the parent's page.
 */
export function WavesCard({
  data,
  childId,
  childName,
  gradeLabel,
  locale,
  retryHref,
}: {
  /** null: the waves couldn't be loaded — the rest of the page still renders. */
  data: ChildWaves | null;
  childId: string;
  /** The given name, as the child is addressed in the copy. */
  childName: string;
  gradeLabel: string | null;
  locale: Locale;
  retryHref: string;
}) {
  const m = wavesMessages(locale);
  const name = { name: childName };
  const date = (iso: string) => formatDate(iso, locale);

  const head = (
    <div className="fam-panel__head">
      <div>
        <h2 id="wv-title" className="fam-panel__title">
          {m.title}
        </h2>
        <p className="fam-panel__sub">{fill(m.sub, name)}</p>
      </div>
      <span className="chip chip--monitoring">{m.chip}</span>
    </div>
  );

  if (!data) {
    return (
      <section className="fam-panel wv-card" aria-labelledby="wv-title">
        {head}
        <p className="fam-note fam-note--danger" role="alert">
          <Icon name="alert" size={18} />
          <span>
            {m.loadError}{' '}
            <Link href={retryHref} className="wv-link">
              {m.retry}
            </Link>
          </span>
        </p>
      </section>
    );
  }

  const errors = Object.fromEntries(Object.entries(m.errors).map(([k, v]) => [k, fill(v, name)]));
  const active = data.consent ? data.waves.filter((w) => w.state === 'open' || w.state === 'in_progress') : [];
  const rest = data.waves.filter((w) => !active.includes(w));

  return (
    <section className="fam-panel wv-card" aria-labelledby="wv-title">
      {head}

      {!data.consent && (
        <div className="fam-note fam-note--warn" role="note">
          <Icon name="lock" size={18} />
          <div>
            <strong>{m.noConsentTitle}</strong>
            {fill(m.noConsentBody, name)}{' '}
            <Link href={`/${locale}/family/access?child=${childId}`} className="wv-link">
              {m.noConsentLink}
            </Link>
          </div>
        </div>
      )}

      {data.grade === null ? (
        <Empty icon="calendar" title={m.noGradeTitle} body={m.noGradeBody} />
      ) : data.waves.length === 0 ? (
        <Empty
          icon="calendar"
          title={fill(m.emptyTitle, { grade: gradeLabel ?? String(data.grade) })}
          body={m.emptyBody}
        />
      ) : null}

      {active.map((w) => (
        <div key={w.id} className="wv-hero">
          <div className="wv-hero__top">
            <span className="wv-hero__kicker">{fill(m.wave, { n: w.ordinal })}</span>
            <span className={TONE[w.state]}>{m.state[w.state]}</span>
          </div>
          {w.state === 'in_progress' ? (
            <>
              <h3 className="wv-hero__title">{fill(m.inProgress.title, { n: w.ordinal })}</h3>
              <p className="wv-hero__body">{fill(m.inProgress.body, { ...name, date: date(w.closesAt) })}</p>
              <StartWaveButton
                childId={childId}
                waveId={w.id}
                locale={locale}
                label={fill(m.inProgress.continue, { n: w.ordinal })}
                errors={errors}
              />
            </>
          ) : !w.ready ? (
            <>
              <h3 className="wv-hero__title">{fill(m.open.title, { n: w.ordinal })}</h3>
              <p className="fam-note">
                <Icon name="clock" size={18} />
                <span>{fill(m.notReady, { n: w.ordinal })}</span>
              </p>
            </>
          ) : (
            <>
              <h3 className="wv-hero__title">{fill(m.open.title, { n: w.ordinal })}</h3>
              <p className="wv-hero__meta">
                {fill(w.timeLimitSec ? m.open.meta : m.open.metaNoLimit, {
                  date: date(w.closesAt),
                  questions: w.questions,
                  minutes: Math.round((w.timeLimitSec ?? 0) / 60),
                })}
              </p>
              <StartWaveButton
                childId={childId}
                waveId={w.id}
                locale={locale}
                label={fill(m.open.start, { n: w.ordinal })}
                errors={errors}
              />
              <p className="fam-small fam-muted">{m.open.device}</p>
              <div className="wv-guide">
                <div className="wv-guide__how">
                  <h4 className="wv-guide__title">{m.open.howTitle}</h4>
                  <ol className="wv-steps">
                    {m.open.how.map((line) => (
                      <li key={line}>{fill(line, name)}</li>
                    ))}
                  </ol>
                </div>
                <div className="fam-note fam-note--brand">
                  <Icon name="users" size={18} />
                  <div>
                    <strong>{fill(m.open.aloneTitle, name)}</strong>
                    {fill(m.open.aloneBody, name)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ))}

      {rest.length > 0 && (
        <ol className="wv-list">
          {rest.map((w) => (
            <li key={w.id} className="wv-row" data-state={w.state}>
              <span className="wv-row__n">{fill(m.wave, { n: w.ordinal })}</span>
              <span className="wv-row__body">
                <span className="wv-row__main">{rowText(w, m, date)}</span>
                {w.state === 'taken' && <span className="fam-small fam-muted">{m.row.takenNote}</span>}
                {w.state === 'missed' && <span className="fam-small fam-muted">{m.row.missedNote}</span>}
              </span>
              <span className={TONE[w.state]}>{m.state[w.state]}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function rowText(w: ChildWave, m: ReturnType<typeof wavesMessages>, date: (iso: string) => string): string {
  switch (w.state) {
    case 'upcoming':
      return fill(m.row.upcoming, { date: date(w.opensAt) });
    case 'open':
      return fill(m.row.open, { date: date(w.closesAt) });
    case 'in_progress':
      return fill(m.row.in_progress, { date: date(w.closesAt) });
    case 'taken':
      return fill(m.row.taken, { date: date(w.submittedAt ?? w.closesAt) });
    case 'missed':
      return m.row.missed;
  }
}

function Empty({ icon, title, body }: { icon: 'calendar'; title: string; body: string }) {
  return (
    <div className="wv-empty">
      <span className="wv-empty__icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
        <strong>{title}</strong>
        <span className="fam-small fam-muted">{body}</span>
      </div>
    </div>
  );
}
