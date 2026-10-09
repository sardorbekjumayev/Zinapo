'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { EducatorApiError, educatorApi } from '@/lib/educator-api';
import type { Locale } from '@/lib/i18n';

/**
 * Start (or resume — the API hands back the same session) an assigned set
 * and hand the device to the child in kid mode. Owner and co-guardian alike
 * (task.md § 3: "launch a practice session").
 */
export function StartPracticeButton({
  childId,
  assignmentId,
  locale,
  label,
  errors,
}: {
  childId: string;
  assignmentId: string;
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
      const { sessionId } = await educatorApi.startPractice(childId, assignmentId);
      router.push(`/${locale}/play/${sessionId}`);
    } catch (err) {
      const code = err instanceof EducatorApiError ? err.code : 'generic';
      setError(errors[code] ?? errors.generic);
      setBusy(false);
      // A refusal usually means the card is out of date (done elsewhere, unassigned).
      if (code !== 'NETWORK') router.refresh();
    }
  }

  return (
    <div className="pr-fam__action">
      <button type="button" className="fam-btn fam-btn--sm pr-fam__btn" onClick={start} disabled={busy} aria-busy={busy}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={16} />}
        {label}
      </button>
      <p className="fam-alert" role="alert" hidden={!error}>
        {error}
      </p>
    </div>
  );
}
