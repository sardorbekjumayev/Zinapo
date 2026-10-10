'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { adminApi } from '@/lib/admin-api';
import { fill } from '@/lib/i18n';
import type { AdminMessages } from '@/messages/admin';
import { useAdminAction } from './useAdminAction';

/** "Resend" on a waiting invite (invite.resend). The API throttles it to once per invite per day. */
export function ResendInviteButton({
  m,
  id,
  kind,
  to,
}: {
  m: AdminMessages;
  id: string;
  kind: 'guardian' | 'educator';
  /** Who it goes to, as shown on the row (masked or the searched number). */
  to: string;
}) {
  const action = useAdminAction(m);
  const [note, setNote] = useState<string | null>(null);

  async function resend() {
    setNote(null);
    await action.run(
      () => adminApi.resendInvite(id, kind),
      ({ resent }) => {
        const text = resent ? fill(m.people.resend.doneFmt, { to }) : m.people.resend.already;
        setNote(text);
        return text;
      },
    );
  }

  return (
    <div className="ad-act">
      <button type="button" className="fam-btn fam-btn--sm" onClick={resend} disabled={action.busy} aria-busy={action.busy}>
        {action.busy && <span className="spinner" aria-hidden="true" />}
        {m.people.resend.action}
      </button>
      {note && !action.error && <span className="fam-caption fam-caption--ok">{note}</span>}
      {action.error && (
        <span className="fam-caption fam-caption--bad" role="alert">
          {action.error}
        </span>
      )}
    </div>
  );
}

/** "Cancel this sign-in" (login.reset): the person starts again, and the start limit on the phone is lifted. */
export function CancelLoginButton({ m, id, phone }: { m: AdminMessages; id: string; phone: string }) {
  const action = useAdminAction(m);
  const [open, setOpen] = useState(false);

  async function confirm() {
    const ok = await action.run(() => adminApi.cancelLogin(id, phone), () => m.people.cancelLogin.done);
    if (ok) setOpen(false);
  }

  return (
    <>
      <button type="button" className="fam-btn fam-btn--sm fam-btn--danger" onClick={() => setOpen(true)} disabled={action.busy}>
        {m.people.cancelLogin.action}
      </button>
      <ConfirmDialog
        open={open}
        icon="lock"
        title={m.people.cancelLogin.dlgTitle}
        body={m.people.cancelLogin.dlgBody}
        confirmLabel={m.people.cancelLogin.confirm}
        cancelLabel={m.common.cancel}
        busy={action.busy}
        error={action.error}
        onConfirm={confirm}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
      />
    </>
  );
}
