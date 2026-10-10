import type { V1Params } from '@/lib/admin-types';
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

/** "+1,76" / "−0,40": a shift reads as a direction, so the sign is always shown. */
export function formatSigned(n: number, digits: number, locale: Locale): string {
  const s = formatDec(Math.abs(n), digits, locale);
  if (Number(s.replace(',', '.')) === 0) return s;
  return `${n > 0 ? '+' : '−'}${s}`;
}

/** The final's inflation is applied only with at least this many pairs (task.md note M9-c). */
export const INFLATION_MIN_PAIRS = 30;

/** A v1 run's params, or null for v0 (or a v1 run that wrote nothing yet). */
export function v1Params(run: Pick<CalibrationRun, 'method' | 'params'>): V1Params | null {
  const p = run.params as unknown as Partial<V1Params>;
  return run.method === 'rasch_anchor_equating_v1' && typeof p.persons === 'number' ? (p as V1Params) : null;
}

/** regionId → its name in the page's language (uz for uz/kaa/en, like the rest of the staff console). */
export type RegionNames = Record<number, string>;

export function regionName(id: number, names: RegionNames, m: CalibrationMessages): string {
  return names[id] ?? fill(m.v1.regionFmt, { id });
}

/** "v1 · Rasch · 10-oktabr, 20:54 · current" — the label of a run in the compare pickers. */
export function runLabel(run: CalibrationRun, m: CalibrationMessages, locale: Locale): string {
  // Seconds too: test and back-to-back runs often share the minute.
  const ss = String(new Date(run.startedAt).getUTCSeconds()).padStart(2, '0');
  const parts = [m.run.method[run.method], `${formatWhen(run.startedAt, locale)}:${ss}`];
  if (run.isCurrent) parts.push(m.compare.currentMark);
  return parts.join(' · ');
}

export interface PickerRun {
  id: string;
  grade: number;
  isCurrent: boolean;
  /** Built on the server, so dates are formatted once (no hydration drift). */
  label: string;
}

/** The current run against the newest other one — the question after a v1 run. */
export function defaultPair(runs: PickerRun[], grade: number): { a: string; b: string } {
  const ofGrade = runs.filter((r) => r.grade === grade);
  const a = ofGrade.find((r) => r.isCurrent) ?? ofGrade[0];
  const b = ofGrade.find((r) => r !== a);
  return { a: a?.id ?? '', b: b?.id ?? '' };
}
