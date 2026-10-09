'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FamilyApiError } from '@/lib/family-api';
import type { FamilyMessages } from '@/messages/family';
import type { AccessMessages } from '@/messages/access';
import type { Locale } from '@/lib/i18n';

/** The copy every access/consents/privacy client component gets as a prop. */
export interface Copy {
  m: AccessMessages;
  f: FamilyMessages;
  locale: Locale;
}

const Announce = createContext<(text: string) => void>(() => {});

/**
 * One polite live region per page, so the result of every mutation — made in
 * whichever panel — is read out once (task.md § 7.1: async results announced).
 * It is also shown as a short-lived toast for sighted users, because after
 * `router.refresh()` the row that was acted on has often moved or gone.
 */
export function LiveRegion({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    // Clear first so the same sentence twice in a row is still announced.
    setText('');
    requestAnimationFrame(() => setText(next));
    timer.current = setTimeout(() => setText(''), 6000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Announce.Provider value={announce}>
      {children}
      <div className="ac-toast" role="status" aria-live="polite" data-shown={text ? 'true' : 'false'}>
        {text}
      </div>
    </Announce.Provider>
  );
}

export function errorText(err: unknown, { m, f }: Pick<Copy, 'm' | 'f'>): string {
  if (!(err instanceof FamilyApiError)) return f.common.genericError;
  if (err.code === 'NETWORK') return f.common.networkError;
  if (err.code === 'RATE_LIMITED') return f.common.rateLimited;
  const known = m.errors as Record<string, string>;
  return known[err.code] ?? f.common.genericError;
}

/** Codes meaning the page is out of date: re-read it so the parent sees why. */
const STALE = new Set(['LINK_STATE', 'NOT_FOUND', 'TRANSFER_PENDING', 'ANONYMISATION_PENDING']);

/**
 * Runs one mutation: busy flag, error copy, then `router.refresh()` so the
 * server components re-fetch the truth, and the result announced.
 *
 * Returns whether it succeeded, so a dialog can stay open with the error.
 */
export function useAction(copy: Copy) {
  const router = useRouter();
  const announce = useContext(Announce);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success: string | ((result: T) => string)): Promise<boolean> => {
      setBusy(key);
      setError(null);
      try {
        const result = await fn();
        announce(typeof success === 'function' ? success(result) : success);
        router.refresh();
        return true;
      } catch (err) {
        setError({ key, text: errorText(err, copy) });
        if (err instanceof FamilyApiError && STALE.has(err.code)) router.refresh();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [announce, router, copy],
  );

  const errorFor = (key: string) => (error?.key === key ? error.text : null);
  const clearError = () => setError(null);

  return { run, busy, errorFor, clearError };
}
