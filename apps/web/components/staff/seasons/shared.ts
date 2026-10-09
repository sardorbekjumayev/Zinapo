import { formatDate } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { SeasonsMessages } from '@/messages/seasons';

export const GRADES = [0, 1, 2, 3, 4] as const;
export const ORDINALS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const SCHOOL_KINDS = ['general', 'presidential', 'specialised', 'private', 'other'] as const;

// Asia/Tashkent has no DST, so a fixed +05:00 is exact all year — and the
// inputs mean the same moment whatever zone the manager's laptop is in.
const TZ_MS = 5 * 3_600_000;

/** ISO instant → the value of an `<input type="datetime-local">`, in Tashkent time. */
export function toLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + TZ_MS).toISOString().slice(0, 16);
}

/** `2026-11-08T09:00` (Tashkent) → ISO instant; null when the input is empty or broken. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+05:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "8-noyabr, 09:00" — the date plus the Tashkent clock time. */
export function formatWhen(iso: string, locale: Locale, withYear = false): string {
  const t = new Date(new Date(iso).getTime() + TZ_MS);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso, locale, withYear)}, ${hh}:${mm}`;
}

/** API error → copy. Unknown codes fall back by status, then to the generic line. */
export function seasonErrorText(err: unknown, m: SeasonsMessages): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return m.errors.generic;
  const e = err as { code: string; status?: number };
  const known = m.errors as Record<string, string>;
  if (known[e.code]) return known[e.code];
  if (e.status === 403) return m.errors.FORBIDDEN;
  if (e.status === 400) return m.errors.VALIDATION;
  return m.errors.generic;
}
