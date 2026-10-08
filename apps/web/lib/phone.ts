export const UZ_PREFIX = '+998';
export const NATIONAL_LENGTH = 9;

/** Keeps at most 9 digits. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, NATIONAL_LENGTH);
}

/** "90 312 45 67" — the mask used in the design. */
export function formatNational(digits: string): string {
  const d = digitsOnly(digits);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(' ');
}

export function isComplete(digits: string): boolean {
  return digitsOnly(digits).length === NATIONAL_LENGTH;
}

export function toE164(digits: string): string {
  return `${UZ_PREFIX}${digitsOnly(digits)}`;
}

/** "+998 90 312 45 67" for display in the code step. */
export function formatFull(digits: string): string {
  return `${UZ_PREFIX} ${formatNational(digits)}`;
}

/** Caret-stable position after re-masking. */
export function digitsBefore(value: string, caret: number): number {
  return (value.slice(0, caret).match(/\d/g) ?? []).length;
}

export function caretForDigit(formatted: string, digitIndex: number): number {
  if (digitIndex <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen === digitIndex) return i + 1;
    }
  }
  return formatted.length;
}
