import type { GainCategory } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import { familyMessages } from '@/messages/family';
import type { EducatorMessages } from '@/messages/educator';

/** Bank copy (misconceptions, topics) comes in uz and ru only; en and kaa read the uz master. */
export function pick(locale: Locale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

export function gradeName(locale: Locale, grade: number | null, any: string): string {
  if (grade === null) return any;
  const g = familyMessages(locale).grade;
  return g[String(grade) as keyof typeof g] ?? String(grade);
}

export function waveName(m: EducatorMessages, n: number): string {
  return fill(m.common.wave, { n });
}

/** The API's category is all an educator ever sees of a child's result (task.md note M6-a). */
export const PROGRESS_CHIP: Record<GainCategory, string> = {
  up: 'chip chip--success',
  flat: 'chip chip--neutral',
  look: 'chip chip--warning',
  first: 'chip chip--monitoring',
  not_taken: 'chip chip--neutral',
};

export const UUID = /^[0-9a-f-]{36}$/i;
