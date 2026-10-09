'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAnnounce } from '@/components/staff/review/live';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { olympiadErrorText } from './shared';

/**
 * One operator mutation: busy flag, error copy, the result announced, then
 * `router.refresh()` so the server page re-reads the olympiad — counts and
 * states always come from the API, never patched locally.
 */
export function useOlympiadAction(m: OlympiadsMessages) {
  const router = useRouter();
  const announce = useAnnounce();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>, success: (result: T) => string): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        announce(success(result));
        startTransition(() => router.refresh());
        return result;
      } catch (err) {
        setError(olympiadErrorText(err, m));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [announce, router, m],
  );

  return { run, busy: busy || refreshing, error, setError };
}
