'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { useAnnounce } from '@/components/staff/review/live';
import { fill } from '@/lib/i18n';
import { OlympiadApiError, olympiadApi } from '@/lib/olympiad-api';
import type { FinalsMessages } from '@/messages/finals';
import { timeOf } from './shared';

/**
 * One child's check-in at the door. Two equal buttons rather than a yes/no
 * gate: whether the adult is the profile owner is recorded for trust & safety
 * (task.md § 8.5), and the child sits the final either way. Calling again
 * corrects the record; undo works only until a session exists.
 */
export function CheckIn({
  m,
  venueId,
  entryId,
  name,
  checkedInAt,
  adultMatchesOwner,
  started,
}: {
  m: FinalsMessages;
  venueId: string;
  entryId: string;
  name: string;
  checkedInAt: string | null;
  adultMatchesOwner: boolean | null;
  started: boolean;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);

  const errorText = (e: unknown) => {
    const code = e instanceof OlympiadApiError ? e.code : 'UNKNOWN';
    const errs = m.roster.errors as Record<string, string>;
    return errs[code] ?? errs.UNKNOWN;
  };

  const record = async (matches: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await olympiadApi.checkIn(venueId, entryId, matches);
      announce(fill(checkedInAt ? m.roster.announceFixed : m.roster.announceIn, { name }));
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await olympiadApi.undoCheckIn(venueId, entryId);
      setUndoOpen(false);
      announce(fill(m.roster.announceUndo, { name }));
      router.refresh();
    } catch (e) {
      setError(errorText(e));
      setUndoOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const err = error && (
    <p className="fam-caption fam-caption--bad" role="alert">
      {error}
    </p>
  );

  if (!checkedInAt) {
    return (
      <div className="fn-checkin">
        <button type="button" className="fam-btn fam-btn--primary fam-btn--sm" disabled={busy} onClick={() => record(true)}>
          <Icon name="check" size={16} />
          {m.roster.inMatch}
        </button>
        <button type="button" className="fam-btn fam-btn--sm" disabled={busy} onClick={() => record(false)}>
          <Icon name="user" size={16} />
          {m.roster.inOther}
        </button>
        {err}
      </div>
    );
  }

  return (
    <div className="fn-checkin">
      <span className="fn-checkin__done">
        <span className="fam-tag fam-tag--ok">{fill(m.roster.checkedAtFmt, { time: timeOf(checkedInAt) })}</span>
        <span className={adultMatchesOwner === false ? 'fam-tag fam-tag--warn' : 'fam-tag'}>
          {adultMatchesOwner === false ? m.roster.adultOther : m.roster.adultOwner}
        </span>
      </span>
      <div className="fn-checkin__row">
        <button
          type="button"
          className="fam-btn fam-btn--quiet fam-btn--sm"
          disabled={busy}
          onClick={() => record(adultMatchesOwner === false)}
        >
          {adultMatchesOwner === false ? m.roster.toOwner : m.roster.toOther}
        </button>
        {!started && (
          <button type="button" className="fam-btn fam-btn--quiet fam-btn--sm" disabled={busy} onClick={() => setUndoOpen(true)}>
            {m.roster.undo}
          </button>
        )}
      </div>
      {started && <span className="fam-small fam-muted">{m.roster.startedNote}</span>}
      {err}
      {!started && (
        <ConfirmDialog
          open={undoOpen}
        title={fill(m.roster.undoTitle, { name })}
        body={m.roster.undoBody}
        confirmLabel={m.roster.undoYes}
        cancelLabel={m.roster.undoNo}
        busy={busy}
          onConfirm={undo}
          onClose={() => setUndoOpen(false)}
        />
      )}
    </div>
  );
}
