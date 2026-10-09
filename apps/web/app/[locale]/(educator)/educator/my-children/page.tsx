import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Avatar } from '@/components/family/Avatar';
import { ErrorState } from '@/components/family/ErrorState';
import { ViewTabs } from '@/components/educator/cabinet/ViewTabs';
import { gradeName } from '@/components/educator/cabinet/labels';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { GroupList, MyChild } from '@/lib/educator-types';
import { fill, isLocale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';

export const dynamic = 'force-dynamic';

/**
 * `/educator/my-children` — design/08 "My children" (task.md § 8.4.7). The
 * educator's own kids, opened as a parent (full report, position included),
 * kept apart from the pupils: they are left out of group statistics and the
 * bonus, and their parent cannot invigilate their final.
 */
export default async function MyChildrenPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = educatorMessages(locale);
  const k = m.kids;

  const [res, groupsRes] = await Promise.all([
    apiGet<MyChild[]>('/api/educator/my-children'),
    apiGet<GroupList>('/api/educator/groups'),
  ]);
  if (!res.ok) {
    if (res.status === 403) redirect(`/${locale}/educator`);
    return (
      <ErrorState
        title={k.loadErrorTitle}
        body={k.loadErrorBody}
        retryHref={`/${locale}/educator/my-children`}
        retryLabel={m.common.retry}
      />
    );
  }

  const kids = res.data;
  const firstGroup = groupsRes.ok ? groupsRes.data.groups[0] : undefined;
  const one = kids.length === 1 ? kids[0].givenName : null;
  const coi = one
    ? [fill(k.coi1, { name: one }), fill(k.coi2, { name: one }), fill(k.coi3, { name: one }), k.coi4]
    : [k.coi1Many, k.coi2Many, k.coi3Many, k.coi4];

  return (
    <>
      <header className="ed-head">
        <div className="ed-head__text">
          <h1 className="pageHead__title">{k.title}</h1>
          <p className="card__body">{k.sub}</p>
        </div>
        <ViewTabs
          locale={locale}
          current="kids"
          pupilsHref={firstGroup ? `/${locale}/educator/groups/${firstGroup.id}` : `/${locale}/educator`}
        />
      </header>

      {kids.length === 0 ? (
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="child" size={26} />
          </span>
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h2 className="state__title">{k.emptyTitle}</h2>
            <p className="card__body ed-measure">{k.emptyBody}</p>
          </div>
          <Link href={`/${locale}/educator`} className="fam-btn">
            <Icon name="arrowLeft" size={18} />
            {m.common.toCabinet}
          </Link>
        </section>
      ) : (
        <div className="fam-grid">
          <div className="fam-col">
            {kids.map((c) => (
              <article key={c.id} className="fam-panel ed-kid" aria-labelledby={`ed-kid-${c.id}`}>
                <div className="ed-kid__head">
                  <Avatar name={c.name} size="lg" />
                  <div className="ed-kid__who">
                    <h2 id={`ed-kid-${c.id}`} className="fam-panel__title">
                      {c.name}
                    </h2>
                    <span className="fam-muted fam-small">
                      {fill(c.role === 'owner' ? k.metaOwner : k.metaCo, {
                        grade: gradeName(locale, c.grade, m.common.gradeAny),
                      })}
                    </span>
                  </div>
                  <span className="fam-tag fam-tag--brand">{k.chip}</span>
                </div>
                <p className="card__body">{fill(k.body, { name: c.givenName })}</p>
                <p className="fam-caption">
                  <Icon name="shield" size={14} />
                  {k.note}
                </p>
                <Link href={`/${locale}/family/children/${c.id}`} className="fam-btn ed-selfStart">
                  {k.openReport}
                  <Icon name="arrowRight" size={18} />
                </Link>
              </article>
            ))}
          </div>

          <section className="fam-panel" aria-labelledby="ed-coi-title">
            <div>
              <h2 id="ed-coi-title" className="fam-panel__title">
                {k.coiTitle}
              </h2>
              <p className="fam-panel__sub">{k.coiSub}</p>
            </div>
            <ul className="ed-coi">
              {coi.map((text, i) => (
                <li key={text} className={i === 2 ? 'ed-coi__item ed-coi__item--warn' : 'ed-coi__item'}>
                  <Icon name={i === 2 ? 'alert' : 'check'} size={18} />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
