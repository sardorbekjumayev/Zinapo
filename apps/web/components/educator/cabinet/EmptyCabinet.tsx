import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { CreateGroupForm } from './CreateGroupForm';

/**
 * `/educator` with no groups (design/08 "empty"). task.md § 8.4.2: there is
 * no "add pupil" — access comes from a parent, so the main action is the
 * invitation. Groups can be made ahead of time; with children already linked
 * the copy leads with grouping them instead.
 */
export function EmptyCabinet({ locale, ungrouped }: { locale: Locale; ungrouped: number }) {
  const m = educatorMessages(locale);
  const h = m.home;
  const hasChildren = ungrouped > 0;

  return (
    <div className="fam-grid">
      <section className="state ed-empty" aria-labelledby="ed-empty-title">
        <span className="state__icon state__icon--empty">
          <Icon name={hasChildren ? 'users' : 'mail'} size={26} />
        </span>
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1 id="ed-empty-title" className="state__title">
            {hasChildren ? h.groupsTitle : h.emptyTitle}
          </h1>
          <p className="card__body ed-measure">{hasChildren ? h.groupsBody : h.emptyBody}</p>
        </div>
        {hasChildren ? (
          <p className="fam-tag fam-tag--brand">{fill(h.ungrouped, { n: ungrouped })}</p>
        ) : (
          <ol className="ed-steps">
            {[h.e1, h.e2, h.e3].map((text, i) => (
              <li key={text} className="ed-steps__item">
                <span className="ed-steps__n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        )}
        <Link href={`/${locale}/educator/invites`} className="fam-btn fam-btn--primary">
          <Icon name="mail" size={18} />
          {h.emptyCta}
        </Link>
        <p className="fam-caption">
          <Icon name="shield" size={14} />
          {h.emptyNote}
        </p>
      </section>

      <section className="fam-panel" aria-labelledby="ed-create-title">
        <div>
          <h2 id="ed-create-title" className="fam-panel__title">
            {m.create.title}
          </h2>
          <p className="fam-panel__sub">{m.create.sub}</p>
        </div>
        <CreateGroupForm locale={locale} />
      </section>
    </div>
  );
}
