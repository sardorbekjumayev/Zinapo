'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import { trustApi } from '@/lib/trust-api';
import type { CaseDetail } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { NoteDialog } from './NoteDialog';
import { useCaseAction } from './useCaseAction';

/**
 * Keep or transfer (task.md § 8.5). Both need a reason both people receive;
 * a transfer is the clean handover of note M8-c, spelled out before confirming.
 */
export function DisputeDecision({ c, m }: { c: CaseDetail; m: TrustMessages }) {
  const dp = m.dispute;
  const d = m.decide;
  const { busy, error, setError, run } = useCaseAction(m);
  const [dlg, setDlg] = useState<'keep' | 'transfer' | null>(null);
  const confirmed = c.dispute?.claimantConfirmed ?? false;

  const act = async (decision: 'keep' | 'transfer', note: string) => {
    const done = decision === 'keep' ? d.done.kept : d.done.transferred;
    if (await run(decision, () => trustApi.decideDispute(c.id, decision, note), fill(done, { ref: c.reference }))) setDlg(null);
  };
  const field = { label: dp.reasonLbl, placeholder: dp.reasonPh, required: true, requiredTag: d.required, error: d.noteErr };

  return (
    <section className="fam-panel" aria-labelledby="ts-decide-title">
      <h2 id="ts-decide-title" className="fam-panel__title">
        {d.title}
      </h2>
      {!confirmed && (
        <p className="fam-note fam-note--warn">
          <Icon name="clock" size={18} />
          <span>{dp.notConfirmed}</span>
        </p>
      )}
      <div className="ts-actions">
        <button
          type="button"
          className="fam-btn fam-btn--primary"
          disabled={!confirmed || busy !== null}
          onClick={() => {
            setError(null);
            setDlg('keep');
          }}
        >
          {dp.keep}
        </button>
        <button
          type="button"
          className="fam-btn fam-btn--danger"
          disabled={!confirmed || busy !== null}
          onClick={() => {
            setError(null);
            setDlg('transfer');
          }}
        >
          {dp.transfer}
        </button>
      </div>
      {error && dlg === null && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
      <NoteDialog
        open={dlg === 'keep'}
        title={dp.keepT}
        body={dp.keepB}
        field={field}
        confirmLabel={dp.keepOk}
        cancelLabel={d.cancel}
        icon="check"
        busy={busy === 'keep'}
        error={dlg === 'keep' ? error : null}
        onConfirm={(note) => act('keep', note)}
        onClose={() => setDlg(null)}
      />
      <NoteDialog
        open={dlg === 'transfer'}
        title={dp.transferT}
        body={dp.transferB}
        list={dp.transferList}
        field={field}
        confirmLabel={dp.transferOk}
        cancelLabel={d.cancel}
        danger
        busy={busy === 'transfer'}
        error={dlg === 'transfer' ? error : null}
        onConfirm={(note) => act('transfer', note)}
        onClose={() => setDlg(null)}
      />
    </section>
  );
}
