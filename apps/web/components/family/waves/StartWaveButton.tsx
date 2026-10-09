'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import type { Locale } from '@/lib/i18n';
import { sessionApi, SessionApiError } from '@/lib/session-api';

/**
 * Start (or resume — the API hands back the same session) a wave, then hand
 * the device to the child: kid mode at `/play/[sessionId]`. On a refusal the
 * card is re-read, since the reason (closed, taken, consent) is usually that
 * the page is out of date.
 */
export function StartWaveButton({
  childId,
  waveId,
  locale,
  label,
  errors,
}: {
  childId: string;
  waveId: string;
  locale: Locale;
  label: string;
  /** Error code → copy, already filled with the child's name. */
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await sessionApi.start(childId, waveId);
      router.push(`/${locale}/play/${sessionId}`);
    } catch (err) {
      const code = err instanceof SessionApiError ? err.code : 'generic';
      setError(errors[code] ?? errors.generic);
      setBusy(false);
      if (code !== 'NETWORK') router.refresh();
    }
  }

  return (
    <div className="wv-start">
      <button
        type="button"
        className="fam-btn fam-btn--primary wv-start__btn"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={20} />}
        {label}
      </button>
      <p className="fam-alert" role="alert" hidden={!error}>
        {error}
      </p>
    </div>
  );
}
