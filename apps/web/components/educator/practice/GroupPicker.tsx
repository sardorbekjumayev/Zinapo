import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import type { GroupList } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';
import { SourceSwitch, type BuilderSource } from './SourceSwitch';

/**
 * Step zero of the builder: a set is built for one group's grade and goes to
 * that group's children, so without a group there is nothing to build for.
 */
export function GroupPicker({
  locale,
  m,
  source,
  groups,
  notice,
}: {
  locale: Locale;
  m: PracticeMessages;
  source: BuilderSource;
  groups: GroupList['groups'];
  notice: string | null;
}) {
  const b = m.builder;
  const base = `/${locale}/educator/practice/new?source=${source}`;

  return (
    <>
      <div className="pageHead">
        <div className="pr-head">
          <span className="card__kicker">{b.kicker}</span>
          <h1 className="pageHead__title">{b.titleDefault}</h1>
          <p className="card__body">{source === 'topic' ? b.subTopic : b.mistakesSub}</p>
        </div>
        <SourceSwitch locale={locale} m={b} source={source} />
      </div>

      {notice && (
        <p className="fam-note fam-note--warn" role="alert">
          <Icon name="alert" size={18} />
          <span>{notice}</span>
        </p>
      )}

      {groups.length === 0 ? (
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="users" size={26} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className="state__title">{b.noGroupsTitle}</h2>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {b.noGroupsBody}
            </p>
          </div>
          <Link href={`/${locale}/educator`} className="fam-btn fam-btn--primary">
            {b.noGroupsCta}
          </Link>
        </section>
      ) : (
        <section className="fam-panel" aria-labelledby="pr-groups-title">
          <div>
            <h2 id="pr-groups-title" className="fam-panel__title">
              {b.groupTitle}
            </h2>
            <p className="fam-panel__sub">{b.groupSub}</p>
          </div>
          <ul className="pr-groups">
            {groups.map((g) => {
              const reason = g.grade === null ? b.groupNoGrade : g.memberCount === 0 ? b.groupNoChildren : null;
              const body = (
                <>
                  <span className="pr-groups__icon" aria-hidden="true">
                    <Icon name="users" size={20} />
                  </span>
                  <span className="pr-groups__body">
                    <span className="pr-groups__name">{g.name}</span>
                    <span className="fam-small fam-muted">{reason ?? fill(b.groupMembers, { n: g.memberCount })}</span>
                  </span>
                  {!reason && <Icon name="arrowRight" size={18} />}
                </>
              );
              return (
                <li key={g.id}>
                  {reason ? (
                    <div className="pr-groups__item pr-groups__item--off" aria-disabled="true">
                      {body}
                    </div>
                  ) : (
                    <Link href={`${base}&group=${g.id}`} className="pr-groups__item lift">
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
