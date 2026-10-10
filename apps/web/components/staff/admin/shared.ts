import { formatDate } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { NATIONAL_LENGTH } from '@/lib/phone';
import type { AdminMessages } from '@/messages/admin';

/**
 * The 9 national digits of whatever was typed or pasted: "+998 90 111 00 01",
 * "998901110001" and "90 111 00 01" all give "901110001". Without dropping the
 * country code first, a pasted full number would keep "998901110".
 */
export function nationalDigits(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const national = d.length > NATIONAL_LENGTH && d.startsWith('998') ? d.slice(3) : d;
  return national.slice(0, NATIONAL_LENGTH);
}

/** "+998901110001" when the input holds exactly a national number, else null (the API has the last word). */
export function toE164(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  const national = d.length === 12 && d.startsWith('998') ? d.slice(3) : d;
  return national.length === NATIONAL_LENGTH ? `+998${national}` : null;
}

/** "2026-yil 10-oktabr, 16:09:21": Tashkent time (UTC+5, no DST), by hand like `formatDate`. */
export function formatStamp(iso: string, locale: Locale, seconds = false): string {
  const t = new Date(new Date(iso).getTime() + 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}${seconds ? `:${p(t.getUTCSeconds())}` : ''}`;
  return `${formatDate(iso, locale)}, ${time}`;
}

/** API error code → copy; unknown codes fall back to the generic line. */
export function errorText(code: string, status: number, m: AdminMessages): string {
  const known = m.errors as Record<string, string>;
  if (known[code]) return known[code];
  if (status === 403) return m.errors.FORBIDDEN;
  return m.errors.generic;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** "Chrome 141 · Windows" from a user agent; the full string stays in a tooltip. Order matters: Edge also says Chrome. */
export function shortAgent(ua: string): string {
  const b = BROWSERS.map(([re, name]) => [re.exec(ua), name] as const).find(([hit]) => hit);
  if (!b) return ua.length > 32 ? `${ua.slice(0, 32)}…` : ua;
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  const browser = `${b[1]} ${b[0]![1]}`;
  return os ? `${browser} · ${os}` : browser;
}
