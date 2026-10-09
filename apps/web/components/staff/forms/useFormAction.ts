'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAnnounce } from '@/components/staff/review/live';
import { BankApiError } from '@/lib/bank-api';
import type { FormsMessages } from '@/messages/forms';
import { formErrorText } from './shared';

/** Errors meaning the screen is out of date: re-read it so the editor sees why. */
const STALE = new Set(['frozen', 'no_such_position', 'NOT_FOUND']);

/**
 * Runs one form-builder mutation: busy flag, error copy, the result announced,
 * then `router.refresh()` so the server page re-reads the form (plan, slots and
 * rule checks all come from the API, never patched locally).
 *
 * `busy` stays set until the refreshed page has arrived, so a second click
 * can't act on the old state.
 */
export function useFormAction(m: FormsMessages) {
  const router = useRouter();
  const announce = useAnnounce();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success: (result: T) => string): Promise<T | null> => {
      setBusy(key);
      setError(null);
      try {
        const result = await fn();
        announce(success(result));
        startTransition(() => router.refresh());
        return result;
      } catch (err) {
        setError({ key, text: formErrorText(err, m) });
        if (err instanceof BankApiError) {
          const reason = typeof err.details.reason === 'string' ? err.details.reason : err.code;
          if (STALE.has(reason)) startTransition(() => router.refresh());
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [announce, router, m],
  );

  return {
    run,
    busy: busy ?? (refreshing ? 'refresh' : null),
    errorFor: (key: string) => (error?.key === key ? error.text : null),
    clearError: () => setError(null),
  };
}
