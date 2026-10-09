import { DEFAULT_LOCALE, type Locale } from './i18n';

/**
 * A message namespace: one folder under `messages/` with `uz.json`, `ru.json`,
 * `en.json` and an `index.ts` that calls this. Screens import their own
 * namespace directly, so adding one never touches a shared registry.
 *
 * `kaa` (and anything without its own copy) falls back to uz, exactly like
 * `getMessages` (task.md § 7.1, note M1-e).
 */
export function forLocale<T>(dicts: Partial<Record<Locale, T>> & { uz: T }) {
  return (locale: Locale): T => dicts[locale] ?? dicts[DEFAULT_LOCALE as 'uz'];
}
