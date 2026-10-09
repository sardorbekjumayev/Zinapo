'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAnnounce } from '@/components/staff/review/live';
import type { CalibrationMessages } from '@/messages/calibration';
import { CalibrationApiError } from './api';
import { errorText } from './shared';

/**
 * One calibration mutation: busy flag, error copy, the result announced, then
 * `router.refresh()` so the server page re-reads which run is current.
 * `busy` stays on until the refreshed page arrives, so a second click can't act
 * on the old list.
 */
export function useCalibrationAction(m: CalibrationMessages) {
  const router = useRouter();
  const announce = useAnnounce();
  const [refreshing, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success: (result: T) => string): Promise<boolean> => {
      setPending(true);
      setError(null);
      try {
        const result = await fn();
        announce(success(result));
        startTransition(() => router.refresh());
        return true;
      } catch (err) {
        const code = err instanceof CalibrationApiError ? err.code : 'generic';
        setError(errorText(code, m));
        // The run vanished or is unfinished: the list on screen is stale.
        if (code === 'NOT_FOUND') startTransition(() => router.refresh());
        return false;
      } finally {
        setPending(false);
      }
    },
    [announce, router, m],
  );

  return { run, busy: pending || refreshing, error, clearError: () => setError(null) };
}
