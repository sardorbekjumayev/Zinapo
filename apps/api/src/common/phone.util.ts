import parsePhoneNumberFromString from 'libphonenumber-js';

/**
 * Normalise to E.164, Uzbekistan only. Telegram sends contact numbers with or
 * without a leading `+`, so both forms have to land on the same string.
 * Returns null when the number is not a valid UZ mobile/landline number.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/^00/, '')}`;

  const parsed =
    parsePhoneNumberFromString(withPlus) ?? parsePhoneNumberFromString(trimmed, 'UZ');

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
