'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { AssignResult } from '@/lib/educator-types';
import { fill } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';
import { errorCode } from './util';

/** design/09 "Repeat for the K who struggled" — the same set again, with the builder's short undo. */
export function RepeatButton({
  assignmentId,
  childIds,
  m,
  undoCopy,
  common,
}: {
  assignmentId: string;
  childIds: string[];
  m: PracticeMessages['list'];
  undoCopy: Pick<PracticeMessages['builder'], 'undo' | 'undoing' | 'undone' | 'undoErrors'>;
  common: PracticeMessages['common'];
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'undoing' | 'undone'>('idle');
  const [result, setResult] = useState<AssignResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = (c: string, known: Record<string, string>) =>
    known[c] ?? (c === 'NETWORK' ? common.networkError : common.genericError);

  async function repeat() {
    setState('sending');
    setError(null);
    try {
      setResult(await educatorApi.repeat(assignmentId, childIds));
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(message(errorCode(err), m.repeatErrors));
    }
  }

  async function undo() {
    if (!result) return;
    setState('undoing');
    setError(null);
    try {
      await educatorApi.undo(result.id);
      setState('undone');
      router.refresh();
    } catch (err) {
      setState('sent');
      setError(message(errorCode(err), undoCopy.undoErrors));
    }
  }

  const undoOpen = result !== null && new Date(result.undoUntil).getTime() > Date.now();

  return (
    <div className="pr-repeat">
      {state === 'sent' || state === 'undoing' ? (
        <div className="fam-stack" role="status" style={{ '--gap': '10px' } as React.CSSProperties}>
          <p className="pr-sent__title">
            <Icon name="check" size={18} />
            {fill(m.repeated, { k: result?.assigned ?? childIds.length })}
          </p>
          {undoOpen && (
            <button
              type="button"
              className="fam-btn fam-btn--sm"
              onClick={undo}
              disabled={state === 'undoing'}
              aria-busy={state === 'undoing'}
            >
              {state === 'undoing' ? undoCopy.undoing : undoCopy.undo}
            </button>
          )}
        </div>
      ) : (
        <>
          {state === 'undone' && (
            <p className="fam-caption fam-caption--ok" role="status">
              {undoCopy.undone}
            </p>
          )}
          <button
            type="button"
            className="fam-btn fam-btn--primary pr-repeat__btn"
            onClick={repeat}
            disabled={state === 'sending'}
            aria-busy={state === 'sending'}
          >
            {state === 'sending' ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={18} />}
            {state === 'sending' ? m.repeating : fill(m.repeat, { k: childIds.length })}
          </button>
        </>
      )}
      <p className="fam-alert" role="alert" hidden={!error}>
        {error}
      </p>
    </div>
  );
}
