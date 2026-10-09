'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { familyApi } from '@/lib/family-api';
import type { AnonymisationRequest } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { useAction, type Copy } from './live';

/**
 * design/06 "Delete data" (task.md § 8.1.7): what goes, what stays
 * anonymously, then the request. While it waits it can be cancelled; the
 * deadline is whatever the API's `executeAfter` says, not a fixed "30 days".
 */
export function DeletePanel({
  copy,
  childId,
  child,
  childFullName,
  request,
  readOnly,
  title,
}: {
  copy: Copy;
  childId: string;
  /** Given name, for "Madina's profile". */
  child: string;
  /** Full name, for the irreversible confirm. */
  childFullName: string;
  request: AnonymisationRequest | null;
  readOnly: boolean;
  title?: string;
}) {
  const { m, locale } = copy;
  const { run, busy, errorFor, clearError } = useAction(copy);
  const [asking, setAsking] = useState(false);
  const headId = `ac-del-h-${childId}`;

  async function confirm() {
    const ok = await run('request', () => familyApi.requestDeletion(childId), m.done.delRequested);
    if (ok) setAsking(false);
  }

  return (
    <section className="fam-panel" aria-labelledby={headId}>
      <div>
        <h2 id={headId} className="fam-panel__title">
          {title ?? m.del.title}
        </h2>
        <p className="fam-panel__sub">{fill(m.del.sub, { child })}</p>
      </div>

      {request ? (
        <div className="ac-result ac-result--ok">
          <span className="ac-result__icon">
            <Icon name="check" size={20} strokeWidth={2} />
          </span>
          <div className="fam-stack" style={{ ['--gap' as string]: '6px' }}>
            <strong className="ac-result__title">{m.del.doneT}</strong>
            <span>
              {fill(readOnly ? m.del.doneDReadOnly : m.del.doneD, {
                date: formatDate(request.executeAfter, locale),
              })}
            </span>
            <span className="fam-small fam-muted">
              {m.del.refNo} · <span className="mono">{request.reference}</span>
            </span>
            {!readOnly && (
              <button
                type="button"
                className="fam-btn fam-btn--sm"
                style={{ alignSelf: 'flex-start', marginTop: 6 }}
                onClick={() => run('cancel', () => familyApi.cancelDeletion(childId), m.done.delCancelled)}
                disabled={busy !== null}
                aria-busy={busy === 'cancel'}
              >
                {busy === 'cancel' && <span className="spinner" aria-hidden="true" />}
                {m.del.cancel}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="ac-del ac-del--gone">
            <span className="ac-del__head">
              <Icon name="trash" size={18} />
              {m.del.goneT}
            </span>
            <ul className="ac-del__list">
              <li>{m.del.gone1}</li>
              <li>{m.del.gone2}</li>
              <li>{m.del.gone3}</li>
              <li>{m.del.gone4}</li>
            </ul>
          </div>
          <div className="ac-del">
            <span className="ac-del__head">
              <Icon name="shield" size={18} />
              {m.del.keptT}
            </span>
            <p className="ac-del__text">{m.del.keptD}</p>
          </div>
          {readOnly ? (
            <p className="fam-note">
              <Icon name="lock" size={18} />
              <span>{m.del.readOnly}</span>
            </p>
          ) : (
            <button
              type="button"
              className="fam-btn fam-btn--danger"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                clearError();
                setAsking(true);
              }}
            >
              {m.del.btn}
            </button>
          )}
        </>
      )}

      {errorFor('cancel') && (
        <p className="fam-alert" role="alert">
          {errorFor('cancel')}
        </p>
      )}

      {!readOnly && (
        <ConfirmDialog
          open={asking}
          title={fill(m.dlg.delT, { child: childFullName })}
          body={m.dlg.delD}
          confirmLabel={m.dlg.delOk}
          cancelLabel={m.dlg.back}
          icon="trash"
          busy={busy === 'request'}
          error={errorFor('request')}
          onConfirm={confirm}
          onClose={() => {
            clearError();
            setAsking(false);
          }}
        />
      )}
    </section>
  );
}
