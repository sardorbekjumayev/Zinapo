'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/shell/Icon';

/**
 * design/03 "We'll start this week": a private note-to-self, kept in this
 * browser only. Nothing is sent — the next wave is what shows whether it
 * helped, not a checkbox.
 */
export function ActionStart({
  storageKey,
  copy,
}: {
  storageKey: string;
  copy: { start: string; started: string; note: string; noteDone: string };
}) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    try {
      setStarted(window.localStorage.getItem(storageKey) === '1');
    } catch {
      // Storage blocked (private mode): the button still works for this visit.
    }
  }, [storageKey]);

  const toggle = () => {
    const next = !started;
    setStarted(next);
    try {
      if (next) window.localStorage.setItem(storageKey, '1');
      else window.localStorage.removeItem(storageKey);
    } catch {
      // As above.
    }
  };

  return (
    <div className="rp-act__foot">
      <button
        type="button"
        className={started ? 'fam-btn rp-act__done' : 'fam-btn fam-btn--primary'}
        aria-pressed={started}
        onClick={toggle}
      >
        {started && <Icon name="check" size={18} />}
        {started ? copy.started : copy.start}
      </button>
      <p className="fam-small fam-muted" aria-live="polite">
        {started ? copy.noteDone : copy.note}
      </p>
    </div>
  );
}
