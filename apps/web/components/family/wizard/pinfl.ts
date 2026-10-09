/**
 * The PINFL's own date of birth, for the wizard's live check (task.md § 8.1.2).
 * The API checks the same thing again — this only spares the parent a round
 * trip and makes the mismatch visible while they are still typing.
 *
 * Digit 1 is century + sex (1–2 → 1800s, 3–4 → 1900s, 5–6 → 2000s), digits
 * 2–7 are DDMMYY. Returns the ISO date, or null when the number is not a
 * well-formed PINFL with a real date in it.
 */
export function pinflBirthDate(pinfl: string): string | null {
  if (!/^[1-6]\d{13}$/.test(pinfl)) return null;
  const century = 1800 + Math.floor((Number(pinfl[0]) - 1) / 2) * 100;
  const day = Number(pinfl.slice(1, 3));
  const month = Number(pinfl.slice(3, 5));
  const year = century + Number(pinfl.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "2026/27" — the school year the grade refers to; it turns over in July. */
export function currentSchoolYear(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'numeric',
    timeZone: 'Asia/Tashkent',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return month >= 7 ? year : year - 1;
}

export function schoolYearLabel(start: number): string {
  return `${start}/${String(start + 1).slice(2)}`;
}
