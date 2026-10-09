import { notFound, redirect } from 'next/navigation';
import { ApplyForm } from '@/components/educator/apply/ApplyForm';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { PublicHeader } from '@/components/public/PublicHeader';
import { apiGet } from '@/lib/api-server';
import type { EducatorProfile } from '@/lib/educator-types';
import type { Region } from '@/lib/family-types';
import { fill, isLocale } from '@/lib/i18n';
import { fetchMe, homeFor } from '@/lib/me';
import { invitesMessages } from '@/messages/invites';

export const dynamic = 'force-dynamic';

/**
 * `/educator/apply` — becoming an educator (task.md § 8.4, § 2.2). Lives in
 * the `(app)` group, not `(educator)`: the applicant does not hold the
 * educator workspace yet (a parent, someone fresh from /onboarding, or a
 * rejected applicant), and that layout would send them away.
 */
export default async function ApplyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const me = await fetchMe();
  if (!me) redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/educator/apply`)}`);
  if (me.educator?.status === 'approved') redirect(`/${locale}/educator`);
  if (me.educator?.status === 'applied') redirect(`/${locale}/educator/pending`);

  const m = invitesMessages(locale);
  const t = m.apply;
  const home = homeFor(me);
  const back = home ? `/${locale}/${home}` : `/${locale}/onboarding`;

  const [profile, regions] = await Promise.all([
    apiGet<EducatorProfile>('/api/educator/profile'),
    apiGet<Region[]>('/api/reference/regions'),
  ]);
  // `me` can be up to a request old; the profile is the live answer.
  if (profile.ok && profile.data.status === 'approved') redirect(`/${locale}/educator`);
  if (profile.ok && profile.data.status === 'applied') redirect(`/${locale}/educator/pending`);
  const rejected = profile.ok && profile.data.status === 'rejected' ? profile.data : null;

  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 880, margin: '0 auto' }}>
        <PublicHeader locale={locale} home={back} />
        {!regions.ok ? (
          <ErrorState
            title={t.regionsErrTitle}
            body={t.regionsErrBody}
            retryHref={`/${locale}/educator/apply`}
            retryLabel={m.common.retry}
          />
        ) : (
          <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            <div className="pageHead">
              <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                <span className="card__kicker">{t.kicker}</span>
                <h1 className="pageHead__title">{t.title}</h1>
                <p className="card__body" style={{ maxWidth: '62ch' }}>
                  {t.subtitle}
                </p>
              </div>
            </div>
            {rejected && (
              <div className="fam-note fam-note--warn" role="note">
                <Icon name="info" size={18} />
                <div>
                  <strong>{t.rejectedT}</strong>
                  {rejected.note ? fill(t.rejectedNote, { note: rejected.note }) + ' ' : ''}
                  {t.rejectedD}
                </div>
              </div>
            )}
            <ApplyForm
              locale={locale}
              m={{ apply: t, common: m.common }}
              regions={regions.data}
              back={back}
              initial={
                rejected
                  ? {
                      kind: rejected.kind ?? null,
                      regionId: rejected.region?.id ?? null,
                      subjects: rejected.subjects ?? [],
                    }
                  : null
              }
            />
          </div>
        )}
      </main>
    </div>
  );
}
