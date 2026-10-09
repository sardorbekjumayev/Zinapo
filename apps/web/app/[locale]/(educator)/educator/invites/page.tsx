import Link from 'next/link';
import { redirect } from 'next/navigation';
import { InviteComposer } from '@/components/educator/invites/InviteComposer';
import { InviteStatus } from '@/components/educator/invites/InviteStatus';
import { MatchCheck } from '@/components/educator/invites/MatchCheck';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { EducatorProfile, InviteList, MatchLimits } from '@/lib/educator-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { invitesMessages } from '@/messages/invites';

export const dynamic = 'force-dynamic';

/**
 * `/educator/invites` — design/10, task.md § 8.4.1–2. Parents own the child's
 * profile, so the educator's only ways in are an SMS invitation or, for a
 * registered child, a request the parent answers.
 */
export default async function InvitesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'educator');
  if (me.educator?.status !== 'approved') redirect(`/${locale}/educator/pending`);
  const m = invitesMessages(locale);
  const t = m.status;
  const self = `/${locale}/educator/invites`;

  const [profile, list, limits] = await Promise.all([
    apiGet<EducatorProfile>('/api/educator/profile'),
    apiGet<InviteList>('/api/educator/invites'),
    apiGet<MatchLimits>('/api/educator/match-check/limits'),
  ]);

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1 className="pageHead__title">{m.page.title}</h1>
          <p className="card__body" style={{ maxWidth: '72ch' }}>
            {m.page.subtitle}
          </p>
        </div>
      </div>

      <div className="iv-top">
        <InviteComposer
          locale={locale}
          m={m}
          educatorName={me.person.fullName}
          publicCode={profile.ok ? (profile.data.publicCode ?? null) : null}
        />
        <MatchCheck locale={locale} m={m} initialLimits={limits.ok ? limits.data : null} />
      </div>

      <section className="fam-panel iv-panel" aria-labelledby="iv-status-title">
        <div>
          <h2 id="iv-status-title" className="fam-panel__title">
            {t.title}
          </h2>
          <p className="fam-panel__sub">{t.sub}</p>
        </div>
        {!list.ok ? (
          <div className="iv-inlineState" role="alert">
            <span className="state__icon state__icon--error">
              <Icon name="alert" size={24} />
            </span>
            <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              <h3 className="iv-inlineState__title">{t.errTitle}</h3>
              <p className="fam-small fam-muted">{t.errBody}</p>
            </div>
            <Link href={self} className="fam-btn fam-btn--primary fam-btn--sm">
              {m.common.retry}
            </Link>
          </div>
        ) : list.data.invites.length === 0 ? (
          <div className="iv-inlineState">
            <span className="state__icon state__icon--empty">
              <Icon name="mail" size={24} />
            </span>
            <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              <h3 className="iv-inlineState__title">{t.emptyT}</h3>
              <p className="fam-small fam-muted">{t.emptyD}</p>
            </div>
            <a href="#iv-phones" className="fam-btn fam-btn--sm">
              {m.bulk.title}
            </a>
          </div>
        ) : (
          <InviteStatus locale={locale} m={m} list={list.data} />
        )}
      </section>
    </div>
  );
}
