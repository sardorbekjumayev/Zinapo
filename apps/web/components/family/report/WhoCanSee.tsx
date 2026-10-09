import Link from 'next/link';
import { Avatar } from '@/components/family/Avatar';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { ReportBase } from '@/lib/report-types';
import { plural } from './util';
import { reportMessages } from '@/messages/report';

/**
 * "Who can see" (design/03). Read-only here: switching access off is on
 * /family/access, where the confirm dialog and the audit trail live. Only the
 * owner gets the link (task.md § 8.2).
 */
export function WhoCanSee({
  access,
  owner,
  childId,
  childName,
  locale,
}: {
  access: ReportBase['access'];
  owner: boolean;
  childId: string;
  childName: string;
  locale: Locale;
}) {
  const m = reportMessages(locale).access;

  return (
    <section className="fam-panel" aria-labelledby="rp-access-title">
      <div className="fam-panel__head">
        <h2 id="rp-access-title" className="fam-panel__title rp-h3">
          {fill(m.title, { name: childName })}
        </h2>
        {owner && (
          <Link href={`/${locale}/family/access?child=${childId}`} className="rp-link">
            {m.manage}
            <Icon name="arrowRight" size={16} />
          </Link>
        )}
      </div>
      <ul className="rp-people">
        {access.guardians.map((g) => (
          <li key={`${g.role}-${g.name}`} className="rp-person">
            <Avatar name={g.name} tone={g.role === 'owner' ? 'brand' : 'blue'} />
            <div className="rp-person__body">
              <strong>
                {g.name} · <span className="rp-person__role">{m.role[g.role]}</span>
              </strong>
              <span className="fam-small fam-muted">{g.role === 'owner' ? m.ownerLine : m.coLine}</span>
            </div>
          </li>
        ))}
        {access.educators.map((e) => (
          <li key={`ed-${e.name}-${e.validUntil}`} className="rp-person">
            <Avatar name={e.name} tone="teal" />
            <div className="rp-person__body">
              <strong>
                {e.name} · <span className="rp-person__role">{m.role.educator}</span>
              </strong>
              <span className="fam-small fam-muted">{fill(m.educatorLine, { date: formatDate(e.validUntil, locale) })}</span>
            </div>
          </li>
        ))}
      </ul>
      {access.educators.length === 0 && <p className="fam-small fam-muted">{m.noEducators}</p>}
      {!owner && (
        <p className="fam-caption">
          <Icon name="lock" size={14} />
          {m.readOnly}
        </p>
      )}
    </section>
  );
}

/** § 1.11: practice shows "how many", never a result, and never moves the report. */
export function PracticeCount({ count, locale, template }: { count: number; locale: Locale; template: 'grade_3_4' | 'grade_0_2' }) {
  const m = reportMessages(locale).practice;
  return (
    <section className="fam-panel rp-practice" aria-labelledby="rp-practice-title">
      <div className="fam-panel__head">
        <h2 id="rp-practice-title" className="fam-panel__title rp-h3">
          {m.title}
        </h2>
        <span className="chip chip--practice">{m.chip}</span>
      </div>
      <p className="rp-practice__count">
        <span className="rp-practice__n">{count}</span> {plural(locale, count, m.unit)}
      </p>
      <p className="fam-small fam-muted">{template === 'grade_3_4' ? m.note34 : m.note02}</p>
    </section>
  );
}
