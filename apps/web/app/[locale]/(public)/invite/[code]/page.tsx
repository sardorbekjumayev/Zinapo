import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon, type IconName } from '@/components/shell/Icon';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { PublicInvite } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, isLocale } from '@/lib/i18n';
import { fetchMe } from '@/lib/me';
import { invitesMessages } from '@/messages/invites';

export const dynamic = 'force-dynamic';

const CODE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * `/invite/[code]` — where an educator's SMS lands (task.md § 8.4.1). Public:
 * the parent usually has no account yet. It says who invited them and that
 * the parent stays in charge; the child is added after sign-in.
 */
export default async function InviteLanding({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  const t = invitesMessages(locale).landing;

  const [me, res] = await Promise.all([
    fetchMe(),
    CODE.test(code)
      ? apiGet<PublicInvite>(`/api/public/educator-invites/${encodeURIComponent(code)}`)
      : Promise.resolve({ ok: false as const, status: 404 }),
  ]);

  if (!res.ok && res.status !== 404) {
    return (
      <ErrorState
        title={t.errTitle}
        body={t.errBody}
        retryHref={`/${locale}/invite/${encodeURIComponent(code)}`}
        retryLabel={invitesMessages(locale).common.retry}
      />
    );
  }
  if (!res.ok) {
    return (
      <StateBlock
        icon="clock"
        title={t.deadTitle}
        body={t.deadBody}
        links={[
          me
            ? { href: `/${locale}/dashboard`, label: t.deadCtaSignedIn, primary: true }
            : { href: `/${locale}/sign-in`, label: t.deadCta, primary: true },
        ]}
      />
    );
  }

  const invite = res.data;
  const addChild = `/${locale}/family/children/new?invite=${encodeURIComponent(code)}`;
  const href = me ? addChild : `/${locale}/sign-in?next=${encodeURIComponent(addChild)}`;
  const steps: { icon: IconName; title: string; body: string }[] = [
    { icon: 'child', title: t.step1T, body: t.step1D },
    { icon: 'shield', title: t.step2T, body: t.step2D },
    { icon: 'lock', title: t.step3T, body: t.step3D },
  ];

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      <section className="fam-panel iv-landing">
        <span className="card__kicker">{t.kicker}</span>
        <h1 className="pageHead__title">{fill(t.title, { name: invite.educatorName })}</h1>
        <div className="iv-tags">
          <span className="fam-tag fam-tag--brand mono">{fill(t.code, { code: invite.publicCode })}</span>
          <span className="fam-tag">{fill(t.until, { date: formatDate(invite.expiresAt, locale) })}</span>
        </div>
        <h2 className="fam-panel__title">{t.nextTitle}</h2>
        <ol className="iv-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="iv-step">
              <span className="iv-step__icon" aria-hidden="true">
                <Icon name={s.icon} size={20} />
              </span>
              <div>
                <strong>
                  {i + 1}. {s.title}
                </strong>
                <p className="fam-small fam-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="fam-note fam-note--teal">
          <Icon name="lock" size={18} />
          {t.privacy}
        </p>
        <Link href={href} className="fam-btn fam-btn--primary iv-start">
          {me ? t.ctaSignedIn : t.ctaSignIn}
          <Icon name="arrowRight" size={18} />
        </Link>
      </section>
    </div>
  );
}
