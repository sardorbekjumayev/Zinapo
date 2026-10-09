import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { CaseDetail, CasePerson } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { gradeText, queueHref, resolutionText, statusChip, when } from './shared';

function Party({ label, person, extra, m }: { label: string; person: CasePerson | null; extra?: string; m: TrustMessages }) {
  return (
    <div className="ts-box">
      <h3 className="ts-kicker">{label}</h3>
      {person ? (
        <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <span className="ts-person__name">{person.name}</span>
          {person.phone && <span className="fam-small fam-muted">{fill(m.dispute.phone, { phone: person.phone })}</span>}
          {extra && <span className="fam-small">{extra}</span>}
        </div>
      ) : (
        <p className="fam-small fam-muted">{m.dispute.noOwner}</p>
      )}
    </div>
  );
}

/** The child and the two sides, side by side (design/15 dispute card). */
export function DisputePanel({ c, locale, m }: { c: CaseDetail; locale: Locale; m: TrustMessages }) {
  const dp = m.dispute;
  const x = c.dispute!;
  return (
    <section className="fam-panel" aria-labelledby="ts-dispute-title">
      <h2 id="ts-dispute-title" className="fam-panel__title">
        {m.kindTitle.ownership_dispute}
      </h2>
      <p className="fam-note fam-note--brand">
        <Icon name="info" size={18} />
        <span>{dp.why}</span>
      </p>
      {x.child && (
        <div className="ts-person">
          <span className="ts-person__icon" aria-hidden="true">
            <Icon name="child" size={20} />
          </span>
          <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
            <span className="ts-kicker">{dp.childLbl}</span>
            <span className="ts-person__name">{x.child.name}</span>
            <span className="fam-small fam-muted">
              {gradeText(x.child.grade, m)} · {fill(m.detail.born, { date: formatDate(x.child.dob, locale) })}
            </span>
          </div>
        </div>
      )}
      <div className="ts-twoCol">
        <Party label={dp.ownerLbl} person={x.owner} m={m} />
        <Party
          label={dp.claimLbl}
          person={x.claimant}
          extra={x.claimant ? fill(dp.claimed, { name: x.claimant.claimedName }) : undefined}
          m={m}
        />
      </div>
      <p className="fam-caption">
        <Icon name="lock" size={14} />
        <span>{m.detail.privacy}</span>
      </p>
    </section>
  );
}

/** The parent, the fifth child they ask for and the four they already own. */
export function FifthPanel({ c, locale, m }: { c: CaseDetail; locale: Locale; m: TrustMessages }) {
  const ff = m.fifth;
  const x = c.fifthChild!;
  return (
    <section className="fam-panel" aria-labelledby="ts-fifth-title">
      <h2 id="ts-fifth-title" className="fam-panel__title">
        {m.kindTitle.fifth_child}
      </h2>
      <p className="fam-note fam-note--brand">
        <Icon name="info" size={18} />
        <span>{ff.why}</span>
      </p>
      <div className="ts-twoCol">
        <Party label={ff.parentLbl} person={x.parent} m={m} />
        <div className="ts-box">
          <h3 className="ts-kicker">{ff.requestedLbl}</h3>
          <span className="ts-person__name">{x.requested.name}</span>
          <span className="fam-small fam-muted">{gradeText(x.requested.grade, m)}</span>
        </div>
      </div>
      {x.used && (
        <p className="fam-note fam-note--ok">
          <Icon name="check" size={18} />
          <span>{ff.used}</span>
        </p>
      )}
      <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <h3 className="ts-kicker">{fill(ff.ownsLbl, { n: x.alreadyOwns })}</h3>
        <ul className="ts-rows">
          {x.children.map((k, i) => (
            <li key={`${k.name}-${i}`}>
              <Icon name="child" size={16} />
              <span className="ts-rows__main">{k.name}</span>
              <span className="fam-small fam-muted">
                {gradeText(k.grade, m)} · {fill(m.detail.born, { date: formatDate(k.dob, locale) })} ·{' '}
                {fill(ff.since, { date: formatDate(k.since, locale) })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** An educator application in the queue: shown here, decided on its own tab (M6). */
export function ApplicationPanel({ c, locale, m }: { c: CaseDetail; locale: Locale; m: TrustMessages }) {
  const ap = m.app;
  const a = c.application;
  const region = a ? (locale === 'ru' ? a.regionRu : a.regionUz) : null;
  return (
    <section className="fam-panel" aria-labelledby="ts-app-title">
      <h2 id="ts-app-title" className="fam-panel__title">
        {ap.title}
      </h2>
      {a && (
        <>
          <div className="ts-person">
            <span className="ts-person__icon" aria-hidden="true">
              <Icon name="user" size={20} />
            </span>
            <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              <span className="ts-person__name">
                {a.name}
                <span className="fam-tag">{(ap.status as Record<string, string>)[a.status] ?? a.status}</span>
              </span>
              <span className="fam-small fam-muted">{fill(ap.applied, { date: formatDate(a.appliedAt, locale) })}</span>
            </div>
          </div>
          <dl className="ts-facts">
            <div className="ts-facts__row">
              <dt>{ap.region}</dt>
              <dd>{region ?? ap.none}</dd>
            </div>
            <div className="ts-facts__row">
              <dt>{ap.school}</dt>
              <dd>{a.schoolName ?? ap.none}</dd>
            </div>
            <div className="ts-facts__row">
              <dt>{ap.kindLbl}</dt>
              <dd>{m.app.kind[a.kind as keyof typeof m.app.kind] ?? a.kind}</dd>
            </div>
          </dl>
        </>
      )}
      <p className="fam-note fam-note--brand">
        <Icon name="info" size={18} />
        <span>{ap.decideThere}</span>
      </p>
      <Link href={queueHref(locale, { tab: 'applications' })} className="fam-btn fam-btn--primary ts-start">
        {ap.openTab}
        <Icon name="arrowRight" size={16} />
      </Link>
    </section>
  );
}

/** A closed case, read-only: the outcome in words, when, and by whom. */
export function ResolutionPanel({ c, locale, m }: { c: CaseDetail; locale: Locale; m: TrustMessages }) {
  const chip = statusChip(c.kind, c.status, c.resolution, m);
  const ok = chip.cls.includes('success');
  return (
    <section className="fam-panel" aria-labelledby="ts-res-title">
      <h2 id="ts-res-title" className="fam-panel__title">
        {m.decide.title}
      </h2>
      <div className={`fam-note ${ok ? 'fam-note--ok' : 'fam-note--danger'}`}>
        <Icon name={ok ? 'check' : 'alert'} size={18} />
        <span>
          <strong>{fill(m.resolution.head, { status: chip.label, when: when(c.resolvedAt, locale, true) })}</strong>
          {resolutionText(c.kind, c.resolution, m)}
        </span>
      </div>
    </section>
  );
}
