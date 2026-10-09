import type { CalibrationRun } from '@/lib/report-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';

export const GRADES = [0, 1, 2, 3, 4];

/** Grades 0–2 get skill states only — no band, no rank (task.md § 1, § 9). */
export function isYoung(grade: number): boolean {
  return grade <= 2;
}

/**
 * "2026-yil 9-oktabr, 16:09": runs of one grade often start minutes apart, so
 * the date alone can't tell them apart. Tashkent time (UTC+5, no DST), done by
 * hand for the same server/client reason as `formatDate`.
 */
export function formatWhen(iso: string, locale: Locale): string {
  const t = new Date(new Date(iso).getTime() + 5 * 3_600_000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso, locale)}, ${hh}:${mm}`;
}

/** Fixed decimals with the locale's decimal mark ("0,56" in uz/ru, "0.56" in en). */
export function formatDec(n: number, digits: number, locale: Locale): string {
  const s = n.toFixed(digits);
  return locale === 'en' ? s : s.replace('.', ',');
}

export function triggerText(run: CalibrationRun, m: CalibrationMessages): string {
  if (run.waveOrdinal !== null) return fill(m.run.waveClose, { n: run.waveOrdinal });
  return run.triggeredBy ? fill(m.run.manualBy, { name: run.triggeredBy }) : m.run.manual;
}

/** API error code → copy; unknown codes fall back to the generic line. */
export function errorText(code: string, m: CalibrationMessages): string {
  const known = m.errors as Record<string, string>;
  return known[code] ?? m.errors.generic;
}
