import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { StageKind } from '@/lib/olympiad-types';
import type { FinalsMessages } from '@/messages/finals';

/** "09:30" in Asia/Tashkent (UTC+5, no DST) — by hand, so server and client agree. */
export function timeOf(iso: string): string {
  const d = new Date(Date.parse(iso) + 5 * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** A venue start: the date with the time, because the time is the point. */
export function whenOf(iso: string, locale: Locale, m: FinalsMessages): string {
  return fill(m.common.whenFmt, { date: formatDate(iso, locale), time: timeOf(iso) });
}

export function olympiadTitle(v: { olympiadUz: string; olympiadRu: string }, locale: Locale): string {
  return locale === 'ru' ? v.olympiadRu || v.olympiadUz : v.olympiadUz || v.olympiadRu;
}

export function stageLabel(kind: StageKind | null, m: FinalsMessages): string | null {
  return kind ? m.common.stage[kind] : null;
}
