import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { StageKind, StageState } from '@/lib/olympiad-types';
import type { OlympiadMessages } from '@/messages/olympiad';

/** The season's order (task.md § 8.1.6), whatever order the API lists them in. */
export const STAGE_ORDER: StageKind[] = ['autumn_online', 'mini_final', 'spring_online', 'spring_final'];

export function byStageOrder<T extends { kind: StageKind }>(stages: T[]): T[] {
  return [...stages].sort((a, b) => STAGE_ORDER.indexOf(a.kind) - STAGE_ORDER.indexOf(b.kind));
}

/** Olympiad titles and bank copy come in uz and ru only; en (and kaa) read uz. */
export function pick(locale: Locale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

/** "14:30" in Tashkent time — hand-formatted for the same hydration reason as `formatDate`. */
export function timeOf(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 5 * 3_600_000);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

export function startsLabel(iso: string, locale: Locale, t: OlympiadMessages): string {
  return fill(t.venue.starts, { date: formatDate(iso, locale), time: timeOf(iso) });
}

export function stageDates(stage: { opensAt: string; closesAt: string }, locale: Locale) {
  return { from: formatDate(stage.opensAt, locale, false), to: formatDate(stage.closesAt, locale, false) };
}

/** "21-oktabr – 23-oktabr · onlayn"; a one-day stage shows one date. */
export function whenLine(
  stage: { kind: StageKind; opensAt: string; closesAt: string },
  locale: Locale,
  t: OlympiadMessages,
): string {
  const { from, to } = stageDates(stage, locale);
  const where = t.stage.where[stage.kind];
  return from === to ? fill(t.stage.whenOne, { date: from, where }) : fill(t.stage.when, { from, to, where });
}

export const STATE_CHIP: Record<StageState, string> = {
  closed: 'chip chip--success',
  open: 'chip chip--monitoring',
  upcoming: 'chip chip--neutral',
};

/** "2026/27": the API's season follows the school year, which starts in July. */
export function seasonLabel(now = new Date()): string {
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

export function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
