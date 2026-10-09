'use client';

import { EducatorApiError } from '@/lib/educator-api';
import type { EducatorMessages } from '@/messages/educator';

/** One sentence for any failed mutation: the specific codes first, then connection / validation / generic. */
export function errorText(err: unknown, m: EducatorMessages, specific: Record<string, string> = {}): string {
  if (err instanceof EducatorApiError) {
    if (specific[err.code]) return specific[err.code];
    if (err.code === 'NETWORK') return m.common.networkError;
    if (err.code === 'NOT_FOUND') return m.common.notFoundGroup;
    if (err.code === 'VALIDATION_FAILED' || err.code === 'NAME_REQUIRED') return m.common.validation;
  }
  return m.common.genericError;
}
