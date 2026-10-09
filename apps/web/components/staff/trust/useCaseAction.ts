'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAnnounce } from '@/components/staff/review/live';
import { TrustApiError } from '@/lib/trust-api';
import type { TrustMessages } from '@/messages/trust';

export function trustErrorText(err: unknown, m: TrustMessages): string {
  const errors = m.errors as Record<string, string>;
  if (err instanceof TrustApiError) {
    if (errors[err.code]) return errors[err.code];
    if (err.status === 403) return errors.FORBIDDEN;
    if (err.status === 404) return errors.NOT_FOUND;
  }
  return errors.UNKNOWN;
}

/**
 * One mutation on a case: busy flag, the error in words, the result read out
 * through the page's live region, then a server refresh so every panel shows
 * the case as the API now has it.
 */
export function useCaseAction(m: TrustMessages) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, call: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      await call();
      announce(done);
      router.refresh();
      return true;
    } catch (err) {
      setError(trustErrorText(err, m));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, setError, run };
}
