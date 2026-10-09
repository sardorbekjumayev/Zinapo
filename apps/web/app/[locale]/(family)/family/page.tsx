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
 * `/family` — the parent's home. task.md § 7 says it goes to the first child's
 * report; until M5 builds that report this lists the children with the
 * relationship to each, plus any guardian invitations waiting for an answer.
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

      {/* The report itself is M5. Saying so beats an empty card that looks
          like a bug. */}
      <section className="card">
        <span className="card__kicker">{t.soon.kicker}</span>
        <h2 className="card__title">{t.nav.reports}</h2>
        <p className="card__body">{t.soon.body}</p>
        <span className="chip chip--neutral mono" style={{ alignSelf: 'flex-start' }}>
          M5 — Measurement v0 &amp; parent reports
        </span>
      </section>
    </>
  );
}
