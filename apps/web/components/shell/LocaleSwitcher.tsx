'use client';

import { usePathname, useRouter } from 'next/navigation';
import { getMessages, TRANSLATED_LOCALES, type Locale } from '@/lib/i18n';

/**
 * uz-Latn, ru and en, as a segmented control (design/08-teacher-cabinet.html).
 *
 * The choice is stored in `zn_locale` so `middleware.ts` can honour it on the
 * next bare-path visit, and the current path is rewritten in place rather than
 * sending the person back to a landing page.
 */
export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const pick = (next: Locale): void => {
    if (next === locale) return;
    const rest = pathname.split('/').slice(2).join('/');
    document.cookie = `zn_locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.push(`/${next}${rest ? `/${rest}` : ''}`);
  };

  return (
    <div className="ws__switch" role="group" aria-label={label}>
      {TRANSLATED_LOCALES.map((item) => (
        <button
          key={item}
          type="button"
          className="ws__switchBtn"
          aria-pressed={item === locale}
          onClick={() => pick(item)}
        >
          {getMessages(item).localeName}
        </button>
      ))}
    </div>
  );
}
