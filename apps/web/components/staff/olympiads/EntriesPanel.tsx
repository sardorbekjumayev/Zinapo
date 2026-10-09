import { regionName } from '@/lib/format';
import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import type { OlympiadDetail, StaffEntry } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { formatWhen, STAGE_KINDS } from './shared';

type Stage = OlympiadDetail['stages'][number];

/**
 * Entries of one stage (task.md § 8.5): names, grades, regions and — once
 * computed — scores and ranks. The API never sends PINFL or phones, and this
 * table shows nothing it is not given. The stage lives in `?stage=`.
 */
export function EntriesPanel({
  stages,
  shown,
  entries,
  hrefFor,
  retryHref,
  locale,
  m,
}: {
  stages: Stage[];
  shown: Stage | null;
  /** null = the request failed. */
  entries: StaffEntry[] | null;
  hrefFor: Record<string, string>;
  retryHref: string;
  locale: Locale;
  m: OlympiadsMessages;
}) {
  const ordered = [...stages].sort((a, b) => STAGE_KINDS.indexOf(a.kind) - STAGE_KINDS.indexOf(b.kind));
  const withResults = !!shown?.resultsComputedAt;
  const t = m.entries.th;
  const dash = m.entries.none;

  return (
    <section className="fam-panel" id="oa-entries" aria-labelledby="oa-entries-title">
      <div>
        <h2 id="oa-entries-title" className="fam-panel__title">
          {m.entries.title}
        </h2>
        <p className="fam-panel__sub">{m.entries.sub}</p>
      </div>

      {!shown ? (
        <p className="fam-note">
          <Icon name="users" size={18} />
          <span>{m.entries.noStages}</span>
        </p>
      ) : (
        <>
          <nav aria-label={m.entries.tabsAria}>
            <ul className="oa-tabs">
              {ordered.map((s) => (
                <li key={s.id}>
                  <Link href={hrefFor[s.id]} scroll={false} className="oa-tab" aria-current={s.id === shown.id ? 'page' : undefined}>
                    {m.stage[s.kind]}
                    <span className="oa-tab__n">{s.entries}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {entries === null ? (
            <div className="fam-note fam-note--danger" role="alert">
              <Icon name="alert" size={18} />
              <span>
                <strong>{m.states.partErrTitle}</strong> {m.states.partErrBody}{' '}
                <Link href={retryHref} className="oa-link">
                  {m.states.retry}
                </Link>
              </span>
            </div>
          ) : entries.length === 0 ? (
            <p className="fam-note">
              <Icon name="inbox" size={18} />
              <span>
                <strong>{m.entries.emptyTitle}</strong> {m.entries.emptyBody}
              </span>
            </p>
          ) : (
            <>
              <span className="fam-small fam-muted">{fill(m.entries.countFmt, { n: entries.length })}</span>
              <div className="oa-tableWrap">
                <table className="oa-table">
                  <caption className="visually-hidden">
                    {m.entries.title} · {m.stage[shown.kind]}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t.name}</th>
                      <th scope="col" className="oa-num">
                        {t.grade}
                      </th>
                      <th scope="col">{t.region}</th>
                      <th scope="col">{t.via}</th>
                      <th scope="col">{t.source}</th>
                      {shown.inPerson && <th scope="col">{t.venue}</th>}
                      {shown.inPerson && <th scope="col">{t.checkIn}</th>}
                      <th scope="col">{t.session}</th>
                      {withResults && (
                        <>
                          <th scope="col" className="oa-num">
                            {t.score}
                          </th>
                          <th scope="col" className="oa-num">
                            {t.rank}
                          </th>
                          <th scope="col" className="oa-num">
                            {t.percentile}
                          </th>
                          <th scope="col">{t.certificate}</th>
                          <th scope="col">{t.qualified}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <th scope="row">
                          <span className="oa-entryName">
                            {e.name}
                            {e.flaggedAt && (
                              <span className="fam-tag fam-tag--danger" title={m.entries.flagged}>
                                <Icon name="flag" size={14} />
                                {m.entries.flagged}
                              </span>
                            )}
                          </span>
                        </th>
                        <td className="oa-num">{e.grade}</td>
                        <td>{regionName({ nameUz: e.regionUz, nameRu: e.regionRu ?? e.regionUz }, locale)}</td>
                        <td>{e.entryVia ? ((m.entries.via as Record<string, string>)[e.entryVia] ?? e.entryVia) : dash}</td>
                        <td>{e.source ? <span className="mono">{e.source}</span> : dash}</td>
                        {shown.inPerson && <td>{e.venue ?? dash}</td>}
                        {shown.inPerson && (
                          <td>
                            {e.checkedInAt ? (
                              <span className="fam-stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                                <span>{fill(m.entries.checkedFmt, { time: formatWhen(e.checkedInAt, locale) })}</span>
                                {e.adultMatchesOwner !== null && (
                                  <span className={e.adultMatchesOwner ? 'fam-small fam-muted' : 'fam-small oa-warnText'}>
                                    {e.adultMatchesOwner ? m.entries.adultYes : m.entries.adultNo}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="fam-muted">{m.entries.notChecked}</span>
                            )}
                          </td>
                        )}
                        <td>
                          {e.sessionStatus ? ((m.entries.session as Record<string, string>)[e.sessionStatus] ?? e.sessionStatus) : dash}
                        </td>
                        {withResults && (
                          <>
                            <td className="oa-num">{e.score ?? dash}</td>
                            <td className="oa-num">{e.rank ?? dash}</td>
                            <td className="oa-num">{e.percentile ?? dash}</td>
                            <td>{e.certificate ? <YesMark label={m.entries.yes} /> : <span className="fam-muted">{m.entries.no}</span>}</td>
                            <td>{e.qualified ? <YesMark label={m.entries.yes} /> : <span className="fam-muted">{m.entries.no}</span>}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function YesMark({ label }: { label: string }) {
  return (
    <span className="oa-yes">
      <Icon name="check" size={16} />
      {label}
    </span>
  );
}
