import { regionName } from '@/lib/format';
import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { StaffAward } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { formatNum, gradeName } from './shared';

const KINDS = ['place', 'certificate', 'season_cup', 'teacher_bonus'] as const;

/**
 * Awards of one olympiad grouped by kind (task.md § 8.5, notes M7-b/M7-c):
 * final places, certificates, season cups and teacher bonuses.
 */
export function AwardsPanel({
  awards,
  retryHref,
  locale,
  m,
}: {
  /** null = the request failed. */
  awards: StaffAward[] | null;
  retryHref: string;
  locale: Locale;
  m: OlympiadsMessages;
}) {
  const t = m.awards.th;
  const dash = m.entries.none;

  return (
    <section className="fam-panel" id="oa-awards" aria-labelledby="oa-awards-title">
      <div>
        <h2 id="oa-awards-title" className="fam-panel__title">
          {m.awards.title}
        </h2>
        <p className="fam-panel__sub">{m.awards.rules}</p>
      </div>

      {awards === null ? (
        <div className="fam-note fam-note--danger" role="alert">
          <Icon name="alert" size={18} />
          <span>
            <strong>{m.states.partErrTitle}</strong> {m.states.partErrBody}{' '}
            <Link href={retryHref} className="oa-link">
              {m.states.retry}
            </Link>
          </span>
        </div>
      ) : awards.length === 0 ? (
        <p className="fam-note">
          <Icon name="trophy" size={18} />
          <span>
            <strong>{m.awards.emptyTitle}</strong> {m.awards.emptyBody}
          </span>
        </p>
      ) : (
        KINDS.map((kind) => {
          const rows = awards.filter((a) => a.kind === kind);
          if (rows.length === 0) return null;
          const bonus = kind === 'teacher_bonus';
          const placed = kind === 'place' || kind === 'season_cup';
          return (
            <details key={kind} className="oa-awards" open={kind !== 'certificate'}>
              <summary className="oa-awards__summary">
                <span className="oa-stage__title">{m.awards.kind[kind]}</span>
                <span className="chip chip--neutral">{fill(m.awards.countFmt, { n: rows.length })}</span>
                <Icon name="chevronDown" size={18} />
              </summary>
              <div className="oa-tableWrap">
                <table className="oa-table">
                  <thead>
                    <tr>
                      <th scope="col">{bonus ? t.educator : t.who}</th>
                      {placed && (
                        <th scope="col" className="oa-num">
                          {t.place}
                        </th>
                      )}
                      {bonus && (
                        <th scope="col" className="oa-num">
                          {t.amount}
                        </th>
                      )}
                      {bonus && <th scope="col">{t.note}</th>}
                      {!bonus && <th scope="col">{t.stage}</th>}
                      <th scope="col">{t.region}</th>
                      {!bonus && <th scope="col">{t.grade}</th>}
                      <th scope="col">{t.issued}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <th scope="row">{(bonus ? a.educatorName : a.childName) ?? dash}</th>
                        {placed && <td className="oa-num">{a.place ? fill(m.awards.placeFmt, { n: a.place }) : dash}</td>}
                        {bonus && (
                          <td className="oa-num">{a.amount !== null ? fill(m.awards.amountFmt, { n: formatNum(a.amount) }) : dash}</td>
                        )}
                        {bonus && <td className="oa-wrap">{a.note ?? dash}</td>}
                        {!bonus && <td>{a.stageKind ? m.stage[a.stageKind] : dash}</td>}
                        <td>{a.regionUz ? regionName({ nameUz: a.regionUz, nameRu: a.regionRu ?? a.regionUz }, locale) : dash}</td>
                        {!bonus && <td>{a.grade !== null ? gradeName(a.grade, m) : dash}</td>}
                        <td>{formatDate(a.issuedAt, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })
      )}
    </section>
  );
}
