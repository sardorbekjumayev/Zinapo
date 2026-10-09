import { EducatorApiError } from '@/lib/educator-api';

/**
 * One pasted line, judged the way the API's `toE164` judges it
 * (apps/api/src/common/phone.util.ts): a number with a country code is read
 * internationally, anything else as Uzbek national digits. The server stays
 * the authority — it also checks operator codes — so this only explains the
 * obvious mistakes before sending.
 */
export type LineCheck =
  | { ok: true; e164: string }
  | { ok: false; why: 'short' | 'long' | 'country' | 'chars'; digits: number };

export function checkLine(raw: string): LineCheck {
  const trimmed = raw.trim();
  if (/[^\d\s+().-]/.test(trimmed)) return { ok: false, why: 'chars', digits: 0 };
  const digits = trimmed.replace(/\D/g, '');
  const international =
    trimmed.startsWith('+') || trimmed.startsWith('00') || (digits.startsWith('998') && digits.length === 12);
  let national = digits;
  if (international) {
    const full = digits.replace(/^00/, '');
    if (!full.startsWith('998')) return { ok: false, why: 'country', digits: 0 };
    national = full.slice(3);
  }
  if (national.length < 9) return { ok: false, why: 'short', digits: national.length };
  if (national.length > 9) return { ok: false, why: 'long', digits: national.length };
  return { ok: true, e164: `+998${national}` };
}

/** "+998901234567" → "+998 90 123 45 67". */
export function displayPhone(e164: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

/** "14:52" in Tashkent time — the same string on the server and in the browser. */
export function tashkentTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tashkent',
  }).format(new Date(iso));
}

/** The API's error code mapped through one or more copy tables, most specific first. */
export function errorText(err: unknown, ...tables: Record<string, string>[]): string {
  const code = err instanceof EducatorApiError ? err.code : 'UNKNOWN';
  const status = err instanceof EducatorApiError ? err.status : 0;
  for (const table of tables) {
    if (table[code]) return table[code];
  }
  const last = tables[tables.length - 1] ?? {};
  if (status === 403 && last.FORBIDDEN) return last.FORBIDDEN;
  return last.UNKNOWN ?? code;
}
