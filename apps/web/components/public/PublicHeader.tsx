import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * The bare header of pages outside every workspace (like /onboarding): logo,
 * language, theme. No rail — there is nothing to navigate to yet.
 */
export function PublicHeader({ locale, home }: { locale: Locale; home: string }) {
  const t = getMessages(locale);
  return (
    <header className="ws__header">
      <Link href={home} className="ws__brand" aria-label={t.brand}>
        <span className="ws__brandMark">
          <Icon name="logo" size={22} strokeWidth={2} />
        </span>
        <span className="ws__brandName">{t.brand}</span>
      </Link>
      <div className="ws__crumb" />
      <LocaleSwitcher locale={locale} label={t.nav.langLabel} />
      <ThemeToggle label={t.themeToggle} />
    </header>
  );
}
