import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Icon } from '@/components/shell/Icon';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { fill, getMessages, isLocale } from '@/lib/i18n';
import { fetchMe, homeFor } from '@/lib/me';

export const dynamic = 'force-dynamic';

/**
 * task.md § 2.2 / § 7: a verified phone with nothing attached to it yet.
 *
 * Two doors, and the wording matters — these are not "account types". A person
 * who picks "I'm a parent" and later also tutors keeps the same account and
 * gains a second workspace (INV-01).
 *
 * No nav rail: there is nothing to navigate to yet.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const me = await fetchMe();
  if (!me) redirect(`/${locale}/sign-in?next=/${locale}/onboarding`);

  // Someone who already has a workspace does not belong here. Without this a
  // bookmark would strand a parent on a screen asking who they are.
  const home = homeFor(me);
  if (home) redirect(`/${locale}/${home}`);

  const t = getMessages(locale);
  const firstName = me.person.fullName.trim().split(/\s+/)[0] ?? '';

  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 880, margin: '0 auto' }}>
        <header className="ws__header">
          <Link href={`/${locale}/dashboard`} className="ws__brand" aria-label={t.brand}>
            <span className="ws__brandMark">
              <Icon name="logo" size={22} strokeWidth={2} />
            </span>
            <span className="ws__brandName">{t.brand}</span>
          </Link>
          <div className="ws__crumb" />
          <LocaleSwitcher locale={locale} label={t.nav.langLabel} />
          <ThemeToggle label={t.themeToggle} />
        </header>

        <div className="pageHead">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="card__kicker">{t.onboarding.kicker}</span>
            <h1 className="pageHead__title">{fill(t.onboarding.title, { name: firstName })}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {t.onboarding.subtitle}
            </p>
          </div>
        </div>

        <div className="onb">
          <OnboardingChoice
            href={`/${locale}/family/children/new`}
            icon="child"
            title={t.onboarding.parentTitle}
            body={t.onboarding.parentBody}
            cta={t.onboarding.parentCta}
            primary
          />
          <OnboardingChoice
            href={`/${locale}/educator/apply`}
            icon="users"
            title={t.onboarding.educatorTitle}
            body={t.onboarding.educatorBody}
            cta={t.onboarding.educatorCta}
          />
        </div>

        <div className="card" style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--ink-600)', flex: 'none' }}>
            <Icon name="lock" />
          </span>
          <p className="card__body">{t.onboarding.note}</p>
        </div>
      </main>
    </div>
  );
}

function OnboardingChoice({
  href,
  icon,
  title,
  body,
  cta,
  primary = false,
}: {
  href: string;
  icon: 'child' | 'users';
  title: string;
  body: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <Link href={href} className="onb__card lift">
      <span className="onb__icon">
        <Icon name={icon} size={26} />
      </span>
      <span className="onb__title">{title}</span>
      <span className="card__body">{body}</span>
      <span className={primary ? 'onb__cta onb__cta--primary' : 'onb__cta'}>
        {cta}
        <Icon name="arrowRight" size={18} />
      </span>
    </Link>
  );
}
