import type { Locale } from '@/lib/i18n';

/** Bank names come as uz + ru; en (and kaa) read the uz name, like the rest of the bank copy. */
export function bankName(locale: Locale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

export function errorCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : 'UNKNOWN';
}
