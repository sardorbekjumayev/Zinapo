'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAnnounce } from '@/components/staff/review/live';
import { AdminApiError } from '@/lib/admin-api';
import type { AdminMessages } from '@/messages/admin';
import { errorText } from './shared';

/**
 * One admin mutation: busy flag, error copy, the result announced, then
 * `router.refresh()` so the server page re-reads. `busy` stays on until the
 * refreshed page arrives, so a second click can't act on the old data.
 */
export function useAdminAction(m: AdminMessages) {
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
        const code = err instanceof AdminApiError ? err.code : 'generic';
        const status = err instanceof AdminApiError ? err.status : 0;
        setError(errorText(code, status, m));
        // The thing acted on changed underneath us: the page on screen is stale.
        if (code === 'NOT_FOUND' || code === 'INVITE_NOT_LIVE') startTransition(() => router.refresh());
        return false;
      } finally {
        setPending(false);
      }
    },
    [announce, router, m],
  );

  return { run, busy: pending || refreshing, error, clearError: () => setError(null) };
}
