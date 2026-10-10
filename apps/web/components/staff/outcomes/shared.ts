import { AdminApiError } from '@/lib/admin-api';
import { fill } from '@/lib/i18n';
import type { OutcomesMessages } from '@/messages/outcomes';

/** API error → copy, with the details CSV_COLUMNS / CSV_TOO_LARGE carry filled in. */
export function errorText(err: unknown, m: OutcomesMessages): string {
  if (!(err instanceof AdminApiError)) return m.errors.generic;
  if (err.status === 403) return m.errors.FORBIDDEN;
  const known = m.errors as Record<string, string>;
  const text = known[err.code];
  if (!text) return m.errors.generic;
  const missing = Array.isArray(err.details.missing) ? err.details.missing.join(', ') : '';
  return fill(text, { missing, max: Number(err.details.max ?? MAX_ROWS).toLocaleString('en').replace(/,/g, ' ') });
}

/** Mirrors the API's limits (outcomes.service MAX_ROWS, the 20 M-character body) so a big file fails before upload. */
export const MAX_ROWS = 50_000;
export const MAX_CHARS = 20_000_000;
