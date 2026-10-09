import parsePhoneNumberFromString from 'libphonenumber-js';

/**
 * Normalise to E.164, Uzbekistan only. Telegram sends contact numbers with or
 * without a leading `+`, so both forms have to land on the same string.
 * Returns null when the number is not a valid UZ mobile/landline number.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');

  // Three shapes reach here: "+998 90 …" (typed), "998901234567" (Telegram
  // contacts drop the plus) and "90 123 45 67" (a parent typing the local
  // form). Reading the last one as international would make it "+90…",
  // Turkey — so only a number that already carries a country code is parsed
  // internationally, and everything else as Uzbek.
  const international =
    trimmed.startsWith('+') || trimmed.startsWith('00') || (digits.startsWith('998') && digits.length === 12);
  const parsed = international
    ? parsePhoneNumberFromString(`+${digits.replace(/^00/, '')}`)
    : parsePhoneNumberFromString(digits, 'UZ');

  if (!parsed || !parsed.isValid() || parsed.country !== 'UZ') return null;
  return parsed.number;
}

/** Masked form for logs and audit rows — never store the full number there. */
export function maskPhone(e164: string): string {
  return e164.length <= 6 ? '***' : `${e164.slice(0, 5)}***${e164.slice(-2)}`;
}

/**
 * Masked form shown back to the signed-in person: `+99890•••4567`
 * (task.md § 2.2). Keeps the operator code and the last four digits — enough
 * to recognise your own number, not enough to be copied off a screenshot.
 */
export function maskPhoneForDisplay(e164: string): string {
  if (e164.length < 10) return '•••';
  return `${e164.slice(0, 6)}•••${e164.slice(-4)}`;
}
