import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { ChildCard } from '@/components/family/home/ChildCard';
import { IncomingInvites } from '@/components/family/home/IncomingInvites';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { ChildSummary, IncomingInvite } from '@/lib/family-types';
import { fill, getMessages } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/workspace-guard';
import { familyMessages } from '@/messages/family';
import { homeMessages } from '@/messages/home';

export const dynamic = 'force-dynamic';

/**
 * `/family` — the parent's home: the children with the relationship to each
 * (each card opens that child's report, M5), plus any guardian invitations
 * waiting for an answer. task.md § 7 sends it to the first child's report; a
 * list keeps the invitations visible and serves a family with several
 * children, and the rail links each report directly.
 *
 * The empty state is the one that matters most here, because a parent who has
 * just signed in from an educator invite lands on it.
 */
export default async function FamilyHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale } = await requireWorkspace(raw, 'family');
  const t = getMessages(locale);
  const fm = familyMessages(locale);
  const m = homeMessages(locale);

  const [list, inv] = await Promise.all([
    apiGet<ChildSummary[]>('/api/family/children'),
    apiGet<IncomingInvite[]>('/api/family/guardian-invites'),
  ]);
  // Invitations are an extra: if they fail to load, the children still show.
  const invites = inv.ok ? inv.data : [];

  if (!list.ok) {
    return (
      <>
        <IncomingInvites invites={invites} locale={locale} />
        <ErrorState
          title={m.home.loadErrorTitle}
          body={m.home.loadErrorBody}
          retryHref={`/${locale}/family`}
          retryLabel={fm.common.retry}
        />
      </>
    );
  }

  const children = list.data;

  if (children.length === 0) {
    return (
      <>
        <IncomingInvites invites={invites} locale={locale} />
        <section className="state">
          <span className="state__icon state__icon--empty">
            <Icon name="child" size={26} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="card__kicker">{t.onboarding.kicker}</span>
            <h1 className="state__title">{t.onboarding.parentTitle}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {m.home.emptyBody}
            </p>
          </div>
          <Link
            href={`/${locale}/family/children/new`}
            className="onb__cta onb__cta--primary lift"
            style={{ marginTop: 0, textDecoration: 'none' }}
          >
            {t.onboarding.parentCta}
            <Icon name="arrowRight" size={18} />
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="pageHead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
          <span className="card__kicker">{t.workspace.family} · {t.nav.familyChildren}</span>
          <h1 className="pageHead__title">{fill(t.nav.noteChildren, { n: children.length })}</h1>
          <p className="card__body">{t.nav.noteChildrenSub}</p>
        </div>
        <Link href={`/${locale}/family/children/new`} className="fam-btn fam-btn--primary">
          <Icon name="plus" size={18} />
          {t.nav.addChild}
        </Link>
      </div>

      <IncomingInvites invites={invites} locale={locale} />

      <ul className="fp-kids">
        {children.map((c) => (
          <li key={c.id}>
            <ChildCard child={c} locale={locale} />
          </li>
        ))}
      </ul>

    </>
  );
}
