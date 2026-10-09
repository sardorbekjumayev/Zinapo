'use client';

import { useState } from 'react';
import { fill } from '@/lib/i18n';
import { trustApi } from '@/lib/trust-api';
import type { CaseDetail } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { NoteDialog } from './NoteDialog';
import { useCaseAction } from './useCaseAction';

/** Approve one more child, or reject with an optional reason the parent sees. */
export function FifthDecision({ c, m }: { c: CaseDetail; m: TrustMessages }) {
  const ff = m.fifth;
  const d = m.decide;
  const { busy, error, setError, run } = useCaseAction(m);
  const [dlg, setDlg] = useState<'approved' | 'rejected' | null>(null);

  const act = async (decision: 'approved' | 'rejected', note: string) => {
    const done = decision === 'approved' ? d.done.approved : d.done.rejected;
    if (await run(decision, () => trustApi.decideFifth(c.id, decision, note || undefined), fill(done, { ref: c.reference }))) setDlg(null);
  };
  const pick = (next: 'approved' | 'rejected') => {
    setError(null);
    setDlg(next);
  };

  return (
    <section className="fam-panel" aria-labelledby="ts-decide-title">
      <h2 id="ts-decide-title" className="fam-panel__title">
        {d.title}
      </h2>
      <div className="ts-actions">
        <button type="button" className="fam-btn fam-btn--primary" disabled={busy !== null} onClick={() => pick('approved')}>
          {ff.approve}
        </button>
        <button type="button" className="fam-btn fam-btn--danger" disabled={busy !== null} onClick={() => pick('rejected')}>
          {ff.reject}
        </button>
      </div>
      {error && dlg === null && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
      <NoteDialog
        open={dlg === 'approved'}
        title={ff.approveT}
        body={ff.approveB}
        confirmLabel={ff.approveOk}
        cancelLabel={d.cancel}
        icon="child"
        busy={busy === 'approved'}
        error={dlg === 'approved' ? error : null}
        onConfirm={(note) => act('approved', note)}
        onClose={() => setDlg(null)}
      />
      <NoteDialog
        open={dlg === 'rejected'}
        title={ff.rejectT}
        body={ff.rejectB}
        field={{ label: ff.rejectLbl, error: d.noteErr }}
        confirmLabel={ff.rejectOk}
        cancelLabel={d.cancel}
        danger
        busy={busy === 'rejected'}
        error={dlg === 'rejected' ? error : null}
        onConfirm={(note) => act('rejected', note)}
        onClose={() => setDlg(null)}
      />
    </section>
  );
}
