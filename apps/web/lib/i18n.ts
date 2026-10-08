import uz from '@/messages/uz.json';
import ru from '@/messages/ru.json';
import en from '@/messages/en.json';

/**
 * task.md § 7.1: uz-Latn and ru for all copy, and "keep the `kaa` locale wired
 * but empty".
 *
 * `kaa` is therefore a real, routable locale with no dictionary of its own: it
 * falls back to uz rather than rendering blank strings. Dropping a
 * `messages/kaa.json` in and adding it to DICTS is then the only change needed
 * when the Karakalpak copy exists (open question 4).
 */
export const LOCALES = ['uz', 'ru', 'en', 'kaa'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz';

/** The locales that have their own copy — what the language switcher offers. */
export const TRANSLATED_LOCALES = ['uz', 'ru', 'en'] as const;

export type Messages = typeof uz;

const DICTS: Partial<Record<Locale, Messages>> = {
  uz,
  ru: ru as Messages,
  en: en as Messages,
  // kaa: intentionally absent — see above.
};

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function getMessages(locale: Locale): Messages {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE]!;
}

/** Replaces `{name}` placeholders. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
