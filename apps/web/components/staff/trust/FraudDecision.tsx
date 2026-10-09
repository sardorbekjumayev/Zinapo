'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import { trustApi } from '@/lib/trust-api';
import type { CaseDetail } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { NoteDialog } from './NoteDialog';
import { useCaseAction } from './useCaseAction';

type Dlg = 'suspend' | 'dismiss' | 'escalate' | 'close' | null;

/**
 * The decision panel for a fraud flag (design/15, task.md § 8.5). Nothing here
 * is silent: suspending links tells the owners, who decide per child; even
 * "confirm and escalate" leaves each link's fate to its owner (note M8-b).
 */
export function FraudDecision({ c, m }: { c: CaseDetail; m: TrustMessages }) {
  const f = c.fraud!;
  const d = m.decide;
  const { busy, error, setError, run } = useCaseAction(m);
  const [dlg, setDlg] = useState<Dlg>(null);
  const waiting = c.status === 'waiting_owner';
  const ref = c.reference;

  const open = (next: Dlg) => {
    setError(null);
    setDlg(next);
  };
  const act = async (key: Exclude<Dlg, null>, note: string) => {
    const calls = {
      suspend: () => trustApi.suspendLinks(c.id, note || undefined),
      dismiss: () => trustApi.dismiss(c.id, note),
      escalate: () => trustApi.confirm(c.id, note),
      close: () => trustApi.close(c.id, note || undefined),
    };
    const done = {
      suspend: d.done.suspended,
      dismiss: d.done.dismissed,
      escalate: d.done.escalated,
      close: d.done.closed,
    };
    if (await run(key, calls[key], fill(done[key], { ref }))) setDlg(null);
  };

  const noteField = (label: string, placeholder?: string) => ({
    label,
    placeholder,
    required: true,
    requiredTag: d.required,
    error: d.noteErr,
  });
  const optional = { label: d.noteOpt, error: d.noteErr };

  return (
    <section className="fam-panel" aria-labelledby="ts-decide-title">
      <h2 id="ts-decide-title" className="fam-panel__title">
        {d.title}
      </h2>

      {waiting ? (
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <button type="button" className="fam-btn fam-btn--primary ts-wide" onClick={() => open('close')} disabled={busy !== null}>
            <Icon name="check" size={18} />
            {d.close}
          </button>
          <p className="fam-caption">{d.closeHint}</p>
        </div>
      ) : (
        f.canSuspendLinks && (
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <button type="button" className="fam-btn fam-btn--primary ts-wide ts-btnTall" onClick={() => open('suspend')} disabled={busy !== null}>
              <Icon name="pin" size={18} />
              {d.suspend}
            </button>
            <p className="fam-caption">{d.suspendHint}</p>
          </div>
        )
      )}

      <div className="ts-actions">
        <button type="button" className="fam-btn" onClick={() => open('dismiss')} disabled={busy !== null}>
          {d.dismiss}
        </button>
        <button type="button" className="fam-btn fam-btn--danger" onClick={() => open('escalate')} disabled={busy !== null}>
          {d.escalate}
        </button>
      </div>

      {error && dlg === null && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      {f.canSuspendLinks && !waiting && (
        <NoteDialog
          open={dlg === 'suspend'}
          title={d.suspendT}
          body={fill(d.suspendB, {
            teacher: f.educator?.name ?? '',
            n: f.educator?.activeLinks ?? 0,
          })}
          field={optional}
          confirmLabel={d.suspendOk}
          cancelLabel={d.cancel}
          icon="pin"
          busy={busy === 'suspend'}
          error={dlg === 'suspend' ? error : null}
          onConfirm={(note) => act('suspend', note)}
          onClose={() => setDlg(null)}
        />
      )}
      <NoteDialog
        open={dlg === 'dismiss'}
        title={d.dismissT}
        body={d.dismissB}
        field={noteField(d.dismissLbl, d.dismissPh)}
        confirmLabel={d.dismissOk}
        cancelLabel={d.cancel}
        icon="check"
        busy={busy === 'dismiss'}
        error={dlg === 'dismiss' ? error : null}
        onConfirm={(note) => act('dismiss', note)}
        onClose={() => setDlg(null)}
      />
      <NoteDialog
        open={dlg === 'escalate'}
        title={d.escalateT}
        body={f.educator ? d.escalateB : d.escalateNoEdu}
        field={noteField(d.escalateLbl, d.escalatePh)}
        confirmLabel={d.escalateOk}
        cancelLabel={d.cancel}
        danger
        busy={busy === 'escalate'}
        error={dlg === 'escalate' ? error : null}
        onConfirm={(note) => act('escalate', note)}
        onClose={() => setDlg(null)}
      />
      {waiting && (
        <NoteDialog
          open={dlg === 'close'}
          title={d.closeT}
          body={d.closeB}
          field={optional}
          confirmLabel={d.closeOk}
          cancelLabel={d.cancel}
          icon="check"
          busy={busy === 'close'}
          error={dlg === 'close' ? error : null}
          onConfirm={(note) => act('close', note)}
          onClose={() => setDlg(null)}
        />
      )}
    </section>
  );
}
