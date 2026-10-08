import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon } from '@/components/shell/Icon';
import { fill, getMessages } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/workspace-guard';

export const dynamic = 'force-dynamic';

/**
 * `/educator` — the tutor's home.
 *
 * task.md § 2.2: an educator whose application is still `applied` sees
 * `/educator/pending` instead. That check lives here rather than in the layout
 * so the pending screen itself can keep the educator chrome.
 */
export default async function EducatorHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'educator');
  const t = getMessages(locale);

  if (me.educator?.status === 'applied') redirect(`/${locale}/educator/pending`);

  const linked = me.educator?.activeChildren ?? 0;

  // task.md § 8.4.2: there is no "add pupil" button. An educator gets access by
  // inviting a parent, who then grants it — so the empty state's only action is
  // the invite.
  if (linked === 0) {
    return (
      <section className="state">
        <span className="state__icon state__icon--empty">
          <Icon name="mail" size={26} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card__kicker">{t.nav.educatorGroups}</span>
          <h1 className="state__title">{t.nav.noteAccessSub}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.onboarding.note}
          </p>
        </div>
        <Link
          href={`/${locale}/educator/invites`}
          className="onb__cta onb__cta--primary lift"
          style={{ marginTop: 0, textDecoration: 'none' }}
        >
          {t.nav.invites}
          <Icon name="arrowRight" size={18} />
        </Link>
      </section>
    );
  }

  return (
    <>
      <div className="pageHead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="card__kicker">{t.nav.educatorGroups}</span>
          <h1 className="pageHead__title">{fill(t.nav.noteAccess, { n: linked })}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.nav.noteAccessSub}
          </p>
        </div>
        <Link
          href={`/${locale}/educator/invites`}
          className="onb__cta onb__cta--primary lift"
          style={{ marginTop: 0, textDecoration: 'none', minWidth: 240 }}
        >
          <Icon name="mail" size={18} />
          {t.nav.invites}
        </Link>
      </div>

      <section className="card">
        <span className="card__kicker">{t.soon.kicker}</span>
        <h2 className="card__title">{t.nav.groups}</h2>
        <p className="card__body">{t.soon.body}</p>
        <span className="chip chip--neutral mono" style={{ alignSelf: 'flex-start' }}>
          M6 — Educator workspace
        </span>
      </section>
    </>
  );
}
