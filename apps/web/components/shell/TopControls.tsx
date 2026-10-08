'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMessages, Locale, TRANSLATED_LOCALES } from '@/lib/i18n';

type Theme = 'light' | 'dark';
const THEME_KEY = 'zn_theme';

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — the OS preference still applies */
  }
}

export function TopControls({ locale, themeLabel }: { locale: Locale; themeLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme((document.documentElement.getAttribute('data-theme') as Theme) ?? 'light');
  }, []);

  const toggleTheme = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  const switchLocale = (next: Locale): void => {
    if (next === locale) return;
    const rest = pathname.split('/').slice(2).join('/');
    document.cookie = `zn_locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.push(`/${next}${rest ? `/${rest}` : ''}`);
  };

  return (
    <div className="controls">
      <div className="controls__group" role="group" aria-label="Language">
        {TRANSLATED_LOCALES.map((item) => (
          <button
            key={item}
            type="button"
            className="controls__btn"
            aria-current={item === locale ? 'true' : 'false'}
            onClick={() => switchLocale(item)}
          >
            {getMessages(item).localeName}
          </button>
        ))}
      </div>

      <span className="controls__divider" aria-hidden="true" />

      <button
        type="button"
        className="controls__btn controls__icon"
        onClick={toggleTheme}
        aria-label={themeLabel}
        aria-pressed={theme === 'dark'}
      >
        {theme === 'dark' ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 14.3A8.2 8.2 0 019.7 4a8.5 8.5 0 102 16.6 8.5 8.5 0 008.3-6.3z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
