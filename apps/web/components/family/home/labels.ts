import { regionName } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';

/** "110-maktab, Toshkent · Toshkent shahri", or the "not listed" copy for the school. */
export function schoolLine(
  e: { schoolName: string | null; regionNameUz: string | null; regionNameRu: string | null },
  locale: Locale,
  notListed: string,
): string {
  const region =
    e.regionNameUz && e.regionNameRu ? regionName({ nameUz: e.regionNameUz, nameRu: e.regionNameRu }, locale) : '';
  return [e.schoolName ?? notListed, region].filter(Boolean).join(' · ');
}

/** 2026 → "2026/27 …" through the namespace template. */
export function schoolYearLabel(year: number, template: string): string {
  return fill(template, { a: year, b: String((year + 1) % 100).padStart(2, '0') });
}

/** Same rule as the API's `currentSchoolYear`: a school year starts in July (UTC). */
export function currentSchoolYear(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
