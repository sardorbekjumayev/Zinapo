import Link from 'next/link';
import { Avatar } from '@/components/family/Avatar';
import { Icon } from '@/components/shell/Icon';
import type { ChildSummary } from '@/lib/family-types';
import { childDisplayName, formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { familyMessages } from '@/messages/family';
import type { AccessMessages } from '@/messages/access';

/** design/06 child pills: links, so the choice lives in the URL (`?child=`). */
export function ChildPicker({
  kids,
  selected,
  href,
  label,
  locale,
}: {
  kids: ChildSummary[];
  selected: string;
  href: (id: string) => string;
  label: string;
  locale: Locale;
}) {
  const f = familyMessages(locale);
  return (
    <nav className="fam-kids" aria-label={label}>
      {kids.map((k) => (
        <Link
          key={k.id}
          href={href(k.id)}
          className="fam-kid"
          aria-current={k.id === selected ? 'page' : undefined}
        >
          <Avatar name={childDisplayName(k)} tone={k.id === selected ? 'brand' : 'teal'} />
          <span>
            {k.givenName}
            {k.grade !== null && (
              <span className="fam-kid__grade">{fill(f.gradeShort, { n: k.grade })}</span>
            )}
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** Co-guardians see everything read-only (task.md § 8.2) — and are told why. */
export function ReadOnlyNote({ m, owner }: { m: AccessMessages; owner: string | null }) {
  return (
    <p className="fam-note fam-note--brand">
      <Icon name="lock" size={18} />
      <span>
        <strong>{m.page.coTitle}</strong>
        {owner ? fill(m.page.coNote, { owner }) : m.page.coNoteNoOwner}
      </span>
    </p>
  );
}

/** design/06 empty state: nobody but the family can see this child yet. */
export function AccessEmpty({
  m,
  schoolYearEnd,
  reportHref,
  locale,
}: {
  m: AccessMessages;
  schoolYearEnd: string;
  reportHref: string;
  locale: Locale;
}) {
  const steps = [
    [m.empty.s1T, m.empty.s1D],
    [m.empty.s2T, m.empty.s2D],
    [m.empty.s3T, fill(m.empty.s3D, { date: formatDate(schoolYearEnd, locale) })],
  ];
  return (
    <section className="fam-panel ac-empty" aria-labelledby="ac-empty-h">
      <span className="ac-empty__icon">
        <Icon name="shield" size={28} />
      </span>
      <h2 id="ac-empty-h" className="fam-panel__title">
        {m.empty.title}
      </h2>
      <p className="ac-empty__body">{m.empty.body}</p>
      <ol className="ac-steps">
        {steps.map(([t, d], i) => (
          <li key={t} className="ac-step">
            <span className="ac-step__n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="ac-step__title">{t}</span>
            <span className="ac-step__desc">{d}</span>
          </li>
        ))}
      </ol>
      <Link href={reportHref} className="fam-btn fam-btn--primary">
        {m.empty.cta}
      </Link>
    </section>
  );
}

/** Empty / not-found shell in the house `.state` style. */
export function StateBlock({
  title,
  body,
  href,
  cta,
  icon = 'child',
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  icon?: 'child' | 'alert';
}) {
  return (
    <section className="state">
      <span className={icon === 'alert' ? 'state__icon state__icon--error' : 'state__icon state__icon--empty'}>
        <Icon name={icon} size={26} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="state__title">{title}</h1>
        <p className="card__body" style={{ maxWidth: '62ch' }}>
          {body}
        </p>
      </div>
      <Link href={href} className="fam-btn fam-btn--primary">
        {cta}
      </Link>
    </section>
  );
}

/** Skeleton shaped like a panel: heading, sub-line, then `rows` rows. */
export function SkelPanel({ rows = 3 }: { rows?: number }) {
  return (
    <div className="fam-panel" aria-hidden="true">
      <div className="skel" style={{ width: '40%', height: 24 }} />
      <div className="skel" style={{ width: '75%', height: 14 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ac-skelRow">
          <div className="skel" style={{ width: 40, height: 40, borderRadius: '50%', flex: 'none' }} />
          <div className="fam-stack ac-grow">
            <div className="skel" style={{ width: '55%', height: 16 }} />
            <div className="skel" style={{ width: '85%', height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkelHead({ picker = true }: { picker?: boolean }) {
  return (
    <div className="pageHead" aria-hidden="true">
      <div className="fam-stack" style={{ flex: 1 }}>
        <div className="skel" style={{ width: 320, maxWidth: '80%', height: 34 }} />
        <div className="skel" style={{ width: 520, maxWidth: '95%', height: 16 }} />
      </div>
      {picker && <div className="skel" style={{ width: 260, height: 60, borderRadius: 999 }} />}
    </div>
  );
}
