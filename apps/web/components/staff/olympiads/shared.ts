import { fill, type Locale } from '@/lib/i18n';
import type { StageKind } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';

export { formatWhen, fromLocalInput, toLocalInput } from '@/components/staff/seasons/shared';

/** The order a season runs in (apps/api/src/olympiad/olympiad.common.ts STAGE_ORDER). */
export const STAGE_KINDS: readonly StageKind[] = ['autumn_online', 'mini_final', 'spring_online', 'spring_final'];
export const IN_PERSON: readonly StageKind[] = ['mini_final', 'spring_final'];

/** gradeMin..gradeMax inclusive. */
export function gradeRange(min: number, max: number): number[] {
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
}

export function titleOf(o: { titleUz: string; titleRu: string }, locale: Locale): string {
  return locale === 'ru' ? o.titleRu : o.titleUz;
}

export function gradeName(g: number, m: OlympiadsMessages): string {
  return (m.grade as Record<string, string>)[String(g)] ?? fill(m.gradeOneFmt, { n: g });
}

export function gradesText(min: number, max: number, m: OlympiadsMessages): string {
  return min === max ? fill(m.gradeOneFmt, { n: min }) : fill(m.gradesFmt, { from: min, to: max });
}

/**
 * "1 250 000" with a no-break space — by hand, not Intl, so the server and the
 * browser render the same string (a mismatch here is a hydration error).
 */
export function formatNum(n: number): string {
  const [int, frac] = String(Math.round(n * 100) / 100).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped},${frac}` : grouped;
}

/** API error → copy. Unknown codes fall back by status, then to the generic line. */
export function olympiadErrorText(err: unknown, m: OlympiadsMessages): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return m.errors.generic;
  const e = err as { code: string; status?: number; details?: Record<string, unknown> };
  const known = m.errors as Record<string, string>;
  if (known[e.code]) {
    const seated = e.details?.seated;
    return fill(known[e.code], { seated: typeof seated === 'number' ? seated : '' });
  }
  if (e.status === 403) return m.errors.FORBIDDEN;
  if (e.status === 404) return m.errors.NOT_FOUND;
  if (e.status === 400) return m.errors.VALIDATION;
  return m.errors.generic;
}
