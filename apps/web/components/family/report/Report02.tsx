import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { Report02 as Report02Data, SkillRow } from '@/lib/report-types';
import { reportMessages, type ReportMessages } from '@/messages/report';
import { SkillList, type SkillItem, type SkillStateKey } from './SkillList';
import { PracticeCount, WhoCanSee } from './WhoCanSee';
import { pick } from './util';

/**
 * How we know a skill's state, in words. Deliberately no "k of n": at this
 * age the per-wave tallies read as a score, and the state is the message.
 */
function evidence(s: SkillRow, m: ReportMessages['skills']): string {
  const hist = [...s.history].sort((a, b) => a.waveOrdinal - b.waveOrdinal);
  const last = hist[hist.length - 1];
  if (!s.state || !last) return m.ev.none;
  if (s.state === 'secure') {
    const w = s.securedAtWave ?? last.waveOrdinal;
    const before = hist.filter((h) => h.waveOrdinal < w).pop();
    return before ? fill(m.ev.secure, { a: before.waveOrdinal, w }) : fill(m.ev.secureOne, { w });
  }
  return fill(m.ev[s.state], { w: last.waveOrdinal });
}

/**
 * The grade 0–2 report, design/04: skill states only — no rank, no cohort,
 * no forecast (task.md § 1.9), and the refusal to forecast said out loud.
 */
export function Report02({
  r,
  locale,
  childId,
  owner,
}: {
  r: Report02Data;
  locale: Locale;
  childId: string;
  owner: boolean;
}) {
  const all = reportMessages(locale);
  const m = all.skills;
  const name = r.child.givenName;
  const counts = r.counts ?? { secure: 0, emerging: 0, notYet: 0, unassessed: r.skillsTotal };
  const total = Math.max(r.skillsTotal, 1);
  const skills = r.skills ?? [];
  const fresh = r.newlySecure ?? [];

  const firstWave = skills
    .flatMap((s) => s.history.map((h) => h.opensAt))
    .filter((d): d is string => !!d)
    .sort()[0];

  const label = (st: SkillStateKey) => m.state[st];
  const items: SkillItem[] = skills.map((s) => {
    const state: SkillStateKey = s.state ?? 'none';
    return {
      code: s.code,
      name: pick(locale, s.nameUz, s.nameRu),
      cluster: all.common.cluster[s.cluster],
      state,
      stateLabel: label(state),
      evidence: evidence(s, m),
      trail: [...s.history]
        .sort((a, b) => a.waveOrdinal - b.waveOrdinal)
        .map((h) => fill(m.trail, { n: h.waveOrdinal, state: label(h.state) })),
    };
  });
  const count = (k: SkillStateKey) => items.filter((i) => i.state === k).length;
  const tabs = [
    { key: 'all' as const, label: `${m.all} · ${items.length}` },
    { key: 'secure' as const, label: `${label('secure')} · ${count('secure')}` },
    { key: 'emerging' as const, label: `${label('emerging')} · ${count('emerging')}` },
    { key: 'not_yet' as const, label: `${label('not_yet')} · ${count('not_yet')}` },
  ];

  const segs = [
    { key: 'secure', n: counts.secure, label: label('secure') },
    { key: 'emerging', n: counts.emerging, label: label('emerging') },
    { key: 'not_yet', n: counts.notYet, label: label('not_yet') },
    { key: 'none', n: counts.unassessed, label: label('none') },
  ];

  const nextLine = r.next
    ? fill(r.next.open ? all.common.nextOpen : all.common.nextUpcoming, {
        n: r.next.ordinal,
        date: formatDate(r.next.open ? r.next.closesAt : r.next.opensAt, locale),
      })
    : all.common.nextNone;

  return (
    <div className="rp">
      <div className="rp-row rp-row--even">
        <section className="fam-panel" aria-labelledby="rp-sum-over">
          <span id="rp-sum-over" className="rp-over">
            {fill(m.over, { name })}
          </span>
          <div>
            <p className="rp-hero__big">{fill(m.big, { k: counts.secure, n: r.skillsTotal })}</p>
            <p className="rp-sum__unit">{m.unit}</p>
          </div>
          <div
            className="rp-bar"
            role="img"
            aria-label={fill(m.barAria, {
              n: r.skillsTotal,
              s: counts.secure,
              e: counts.emerging,
              ny: counts.notYet,
              u: counts.unassessed,
            })}
          >
            {segs
              .filter((s) => s.n > 0)
              .map((s) => (
                <span key={s.key} className={`rp-bar__seg rp-bar__seg--${s.key}`} style={{ width: `${(s.n / total) * 100}%` }} />
              ))}
          </div>
          <ul className="rp-legend" aria-hidden="true">
            {segs
              .filter((s) => s.n > 0)
              .map((s) => (
                <li key={s.key}>
                  <span className={`rp-dot rp-dot--${s.key}`} />
                  {s.label} · {s.n}
                </li>
              ))}
          </ul>
          <p className="fam-small fam-muted">{m.rule}</p>
          <p className="fam-note fam-note--brand">
            <Icon name="calendar" size={18} />
            <span>{nextLine}</span>
          </p>
        </section>

        <section className="fam-panel" aria-labelledby="rp-new-title">
          <div>
            <span className="rp-over">{firstWave ? fill(m.newOver, { date: formatDate(firstWave, locale, false) }) : m.newOverSeason}</span>
            <h2 id="rp-new-title" className="fam-panel__title">
              {m.newTitle}
            </h2>
          </div>
          {fresh.length === 0 ? (
            <p className="card__body rp-body">{m.newNone}</p>
          ) : (
            <>
              <ul className="rp-new">
                {fresh.map((s) => (
                  <li key={s.code}>
                    <Icon name="check" size={18} />
                    <strong>{pick(locale, s.nameUz, s.nameRu)}</strong>
                    <span className="rp-new__when">{fill(m.confirmed, { n: s.waveOrdinal })}</span>
                  </li>
                ))}
              </ul>
              <p className="fam-small fam-muted">{m.newNote}</p>
            </>
          )}
        </section>
      </div>

      <section className="fam-panel" aria-labelledby="rp-skills-title">
        <div>
          <h2 id="rp-skills-title" className="fam-panel__title">
            {m.listTitle}
          </h2>
          <p className="fam-panel__sub">{m.listHint}</p>
        </div>
        <SkillList items={items} tabs={tabs} copy={{ filterLabel: m.filterLabel, filterEmpty: m.filterEmpty, shown: m.shown }} />
      </section>

      <div className="rp-row">
        <section className="fam-panel rp-act" aria-labelledby="rp-act-title">
          <span className="rp-over">{all.act02.over}</span>
          <h2 id="rp-act-title" className="rp-act__title">
            {r.focus ? fill(all.act02.title, { skill: pick(locale, r.focus.nameUz, r.focus.nameRu) }) : all.act02.noneTitle}
          </h2>
          <p className="rp-act__body">{fill(r.focus ? all.act02.body : all.act02.noneBody, { name })}</p>
          <p className="fam-note fam-note--brand">
            <Icon name="clock" size={18} />
            <span>{all.act02.note}</span>
          </p>
        </section>

        <section className="fam-panel rp-refusal" aria-labelledby="rp-refusal-title">
          <span className="rp-over rp-over--brand rp-refusal__over">
            <span className="rp-refusal__icon" aria-hidden="true">
              <Icon name="ban" size={16} />
            </span>
            {all.refusal.over}
          </span>
          <h2 id="rp-refusal-title" className="fam-panel__title">
            {all.refusal.title}
          </h2>
          <p className="card__body rp-body">{all.refusal.body}</p>
        </section>
      </div>

      <div className="rp-row">
        <WhoCanSee access={r.access} owner={owner} childId={childId} childName={name} locale={locale} />
        <PracticeCount count={r.practiceCount} locale={locale} template="grade_0_2" />
      </div>
    </div>
  );
}
