import { randomBytes } from 'crypto';

/** Unambiguous characters for codes a parent may have to type (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * The educator's public code, printed on every invite (design/10: "AR4821"):
 * initials from the name plus four digits. Latin letters only, so it can be
 * read out over the phone; a name with none gets "ZN".
 */
export function publicCodeFor(fullName: string): string {
  const latin = fullName
    .normalize('NFKD')
    .replace(/[^A-Za-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = (latin.map((w) => w[0]).join('').slice(0, 2) || 'ZN').toUpperCase().padEnd(2, 'Z');
  const digits = String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
  return `${initials}${digits}`;
}

/**
 * design/10 match result: "KARIMOVA M***A". Enough to confirm the right child
 * was typed, never enough to learn a name that was not already known.
 */
export function maskedName(familyName: string, givenName: string): string {
  const g = givenName.trim();
  const masked = g.length <= 2 ? `${g[0] ?? ''}***` : `${g[0]}***${g[g.length - 1]}`;
  return `${familyName.trim().toUpperCase()} ${masked.toUpperCase()}`;
}

/**
 * Family-name comparison for the match-check: case, spacing and the four
 * apostrophes Uzbek Latin is typed with (ʻ ' ` ’) do not matter.
 */
export function normaliseFamilyName(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/\s+/g, ' ');
}

/** Today in Tashkent as YYYY-MM-DD — the match-check's daily limit resets at local midnight. */
export function tashkentDay(at = new Date()): string {
  return new Date(at.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

/** The next Tashkent midnight, as an ISO instant. */
export function nextTashkentMidnight(at = new Date()): string {
  const day = tashkentDay(at);
  return new Date(Date.parse(`${day}T00:00:00+05:00`) + 24 * 3600_000).toISOString();
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
