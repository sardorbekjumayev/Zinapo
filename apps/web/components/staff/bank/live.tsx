'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BankApiError } from '@/lib/bank-api';
import type { BankMessages } from '@/messages/bank';

const Announce = createContext<(text: string) => void>(() => {});

/**
 * One polite live region per page so every mutation's result is read out once
 * (task.md § 7.1), and shown as a short toast because after `router.refresh()`
 * the row acted on may have moved.
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
      <div className="bk-toast" role="status" aria-live="polite" data-shown={text ? 'true' : 'false'}>
        {text}
      </div>
    </Announce.Provider>
  );
}

export function errorText(err: unknown, m: BankMessages): string {
  if (!(err instanceof BankApiError)) return m.common.genericError;
  if (err.code === 'NETWORK') return m.common.networkError;
  if (err.code === 'FORBIDDEN' || err.status === 403) return m.common.forbidden;
  const known = m.tax.errors as Record<string, string>;
  if (err.code === 'TAXONOMY_CONFLICT') {
    const reason = String(err.details.reason ?? '');
    return known[reason] ?? m.common.genericError;
  }
  return known[err.code] ?? m.common.genericError;
}

/**
 * Runs one mutation: busy flag, error copy, then `router.refresh()` so the
 * server page re-reads the truth, and the result announced. Returns whether it
 * succeeded so an inline form can close or stay open with its error.
 */
export function useBankAction(m: BankMessages) {
  const router = useRouter();
  const announce = useContext(Announce);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success: string): Promise<boolean> => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        announce(success);
        router.refresh();
        return true;
      } catch (err) {
        setError({ key, text: errorText(err, m) });
        if (err instanceof BankApiError && err.code === 'NOT_FOUND') router.refresh();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [announce, router, m],
  );

  const errorFor = (key: string) => (error?.key === key ? error.text : null);
  const fail = (key: string, text: string) => setError({ key, text });
  const clearError = () => setError(null);

  return { run, busy, errorFor, fail, clearError };
}
