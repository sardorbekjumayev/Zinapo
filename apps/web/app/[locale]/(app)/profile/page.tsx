import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Icon } from '@/components/shell/Icon';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { LogoutButton } from '@/components/shell/LogoutButton';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { getMessages, isLocale } from '@/lib/i18n';
import { fetchMe, initialsOf } from '@/lib/me';

export const dynamic = 'force-dynamic';

/**
 * `/profile` — name, language, theme, Telegram link status, sign out
 * (task.md § 7).
 *
 * Outside the workspace layouts on purpose: it belongs to the person, not to
 * one of their roles, and it has to be reachable from all of them.
 *
 * The phone is shown exactly as the API returns it — masked (`+99890•••4567`).
 * There is nowhere in the product that needs the full number back.
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const me = await fetchMe();
  if (!me) redirect(`/${locale}/sign-in?next=/${locale}/profile`);

  const t = getMessages(locale);

  return (
    <div className="ws">
      <main className="ws__main" style={{ maxWidth: 760, margin: '0 auto' }}>
        <header className="ws__header">
          <Link href={`/${locale}/dashboard`} className="ws__brand" aria-label={t.brand}>
            <span className="ws__brandMark">
              <Icon name="logo" size={22} strokeWidth={2} />
            </span>
            <span className="ws__brandName">{t.brand}</span>
          </Link>
          <div className="ws__crumb" />
          <ThemeToggle label={t.themeToggle} />
        </header>

        <section className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="ws__avatar" aria-hidden="true">
              {initialsOf(me.person.fullName)}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <h1 className="card__title">{me.person.fullName}</h1>
              <span className="card__body mono">{me.person.phone}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {me.workspaces.map((workspace) => (
              <span key={workspace} className="chip chip--monitoring">
                {t.workspace[workspace]}
              </span>
            ))}
            {me.workspaces.length === 0 && (
              <span className="chip chip--neutral">{t.onboarding.kicker}</span>
            )}
          </div>

          {/* Every signed-in person reached us through Telegram, so the link is
              a fact rather than a setting (sign-in spec § 1). */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: '16px 20px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-200)',
            }}
          >
            <span style={{ color: 'var(--success)', flex: 'none' }}>
              <Icon name="check" />
            </span>
            <span className="card__body">{t.profile.telegramLinked}</span>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">{t.nav.langLabel}</h2>
          <LocaleSwitcher locale={locale} label={t.nav.langLabel} />
        </section>

        <section className="card">
          <h2 className="card__title">{t.nav.profile}</h2>
          <p className="card__body">{t.profile.profileNote}</p>
          <div style={{ alignSelf: 'flex-start' }}>
            <LogoutButton locale={locale} label={t.dashboard.logout} />
          </div>
        </section>
      </main>
    </div>
  );
}
