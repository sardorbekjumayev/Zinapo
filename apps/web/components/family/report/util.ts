import type { Locale } from '@/lib/i18n';
import type { TopRange } from '@/lib/report-types';

/** Bank copy comes in uz and ru only; en (and kaa) read the uz master, like `regionName`. */
export function pick(locale: Locale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

const PLURAL_TAG: Record<Locale, string> = { uz: 'uz', ru: 'ru', en: 'en', kaa: 'uz' };

export function plural(locale: Locale, n: number, forms: { one: string; few: string; many: string; other: string }): string {
  const cat = new Intl.PluralRules(PLURAL_TAG[locale]).select(n) as keyof typeof forms;
  return forms[cat] ?? forms.other;
}

/**
 * The chart axes run from the strongest end to "top 50%", as on design/03.
 * A band can reach past 50 (a wide range in a small cohort), and clipping it
 * would make the range look narrower than it is — so the axis widens to 100.
 */
export function axisMax(ranges: (TopRange | null | undefined)[]): 50 | 100 {
  return ranges.some((r) => r && r.to > 50) ? 100 : 50;
}

export type Direction = 'up' | 'steady' | 'down';

/**
 * Two bands compared honestly: only a range wholly above (or below) the
 * previous one is a move; any overlap is "steady" — the difference is
 * inside the test's error.
 */
export function direction(prev: TopRange, cur: TopRange): Direction {
  if (cur.to < prev.from) return 'up';
  if (cur.from > prev.to) return 'down';
  return 'steady';
}
