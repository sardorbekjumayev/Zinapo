import type { CSSProperties } from 'react';
import { Icon, type IconName } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { Report } from '@/lib/report-types';
import { reportMessages } from '@/messages/report';
import { Report02 } from './Report02';
import { Report34 } from './Report34';
import { PracticeCount, WhoCanSee } from './WhoCanSee';

/**
 * The report on /family/children/[id] (task.md § 8.1.3): the template follows
 * the API's `template`, never the grade on the client — the API is what
 * decides whether a percentile may be shown at all (§ 1.9).
 */
export function ParentReport({
  report,
  locale,
  childId,
  owner,
}: {
  report: Report;
  locale: Locale;
  childId: string;
  owner: boolean;
}) {
  if (report.empty) return <ReportEmpty report={report} locale={locale} childId={childId} owner={owner} />;
  return report.template === 'grade_3_4' ? (
    <Report34 r={report} locale={locale} childId={childId} owner={owner} />
  ) : (
    <Report02 r={report} locale={locale} childId={childId} owner={owner} />
  );
}

const TILE_ICONS: Record<'grade_3_4' | 'grade_0_2', IconName[]> = {
  grade_3_4: ['pin', 'trend', 'check'],
  grade_0_2: ['check', 'trend', 'clock'],
};

/** Nothing measured yet: why it's empty, what the report will show, and the next wave (§ 7.1). */
function ReportEmpty({ report, locale, childId, owner }: { report: Report; locale: Locale; childId: string; owner: boolean }) {
  const all = reportMessages(locale);
  const name = report.child.givenName;
  const m = report.template === 'grade_3_4' ? all.empty34 : all.empty02;
  const next = report.next;
  const nextLine = next
    ? fill(next.open ? all.common.nextOpen : all.common.nextUpcoming, {
        n: next.ordinal,
        date: formatDate(next.open ? next.closesAt : next.opensAt, locale),
      })
    : all.common.nextNone;

  return (
    <div className="rp">
      <section className="state rp-empty" aria-labelledby="rp-empty-title">
        <span className="state__icon state__icon--empty">
          <Icon name={report.template === 'grade_3_4' ? 'gauge' : 'child'} size={26} />
        </span>
        <div className="fam-stack" style={{ '--gap': '8px' } as CSSProperties}>
          <h2 id="rp-empty-title" className="state__title">
            {fill(m.title, { name })}
          </h2>
          <p className="card__body rp-body">{fill(m.body, { name })}</p>
        </div>
        <p className="fam-note fam-note--brand">
          <Icon name="calendar" size={18} />
          <span>{nextLine}</span>
        </p>
        <ul className="rp-explain">
          {m.tiles.map((t, i) => (
            <li key={t.title} className="rp-explain__tile">
              <span className="tile__icon" aria-hidden="true">
                <Icon name={TILE_ICONS[report.template][i] ?? 'info'} size={18} />
              </span>
              <strong>{fill(t.title, { name })}</strong>
              <span className="fam-small fam-muted">{t.body}</span>
            </li>
          ))}
        </ul>
        {report.template === 'grade_0_2' && <p className="fam-small fam-muted">{fill(all.empty02.note, { name })}</p>}
        <a href="#wv-title" className="fam-btn">
          {all.common.howCta}
          <Icon name="arrowRight" size={18} />
        </a>
      </section>

      <div className="rp-row">
        <WhoCanSee access={report.access} owner={owner} childId={childId} childName={name} locale={locale} />
        <PracticeCount count={report.practiceCount} locale={locale} template={report.template} />
      </div>
    </div>
  );
}
