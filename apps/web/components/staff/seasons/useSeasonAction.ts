'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAnnounce } from '@/components/staff/review/live';
import type { SeasonsMessages } from '@/messages/seasons';
import { seasonErrorText } from './shared';

/**
 * One season-manager mutation: busy flag, error copy, the result announced,
 * then `router.refresh()` so the server page re-reads seasons, waves and
 * schools — counts and states come from the API, never patched locally.
 */
export function useSeasonAction(m: SeasonsMessages) {
  const router = useRouter();
  const announce = useAnnounce();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success: (result: T) => string): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        announce(success(result));
        startTransition(() => router.refresh());
        return result;
      } catch (err) {
        setError(seasonErrorText(err, m));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [announce, router, m],
  );

  return { run, busy: busy || refreshing, error, setError };
}
