import type { Locale } from './i18n';
import type { Region } from './family-types';

const TAG: Record<Locale, string> = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-GB', kaa: 'uz-Latn-UZ' };

/**
 * "31-may, 2027" / "31 мая 2027 г." / "31 May 2027", always in Tashkent time —
 * an access that ends "on 31 May" must read 31 May whatever the device's zone.
 */
const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

export function formatDate(iso: string | null | undefined, locale: Locale, withYear = true): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00+05:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;

  // Uzbek is spelled out by hand: browsers ship uneven ICU data for uz-Latn
  // (Chrome renders "2026 M10 9"), and a server/client difference here is a
  // hydration error, not just ugly copy. Format: "9-oktabr, 2026" (design/06).
  if (locale === 'uz' || locale === 'kaa') {
    const t = new Date(d.getTime() + 5 * 3_600_000); // Asia/Tashkent, no DST
    const day = `${t.getUTCDate()}-${UZ_MONTHS[t.getUTCMonth()]}`;
    return withYear ? `${t.getUTCFullYear()}-yil ${day}` : day;
  }

  return new Intl.DateTimeFormat(TAG[locale], {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Asia/Tashkent',
  }).format(d);
}

/** Whole days from now until `iso`, never negative. */
export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function regionName(r: Pick<Region, 'nameUz' | 'nameRu'>, locale: Locale): string {
  return locale === 'ru' ? r.nameRu : r.nameUz;
}

/** "Madina Karimova" → "MK"; the avatar on every person and child row. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Madina Karimova" from the stored upper-case family name. */
export function childDisplayName(c: { givenName: string; familyName: string }): string {
  const family = c.familyName.charAt(0) + c.familyName.slice(1).toLowerCase();
  return `${c.givenName} ${family}`;
}
