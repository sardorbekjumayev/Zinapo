'use client';

import { useState } from 'react';
import { displayPhone } from '@/components/educator/invites/shared';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { adminApi } from '@/lib/admin-api';
import { fill } from '@/lib/i18n';
import { isComplete, toE164 } from '@/lib/phone';
import type { AdminMessages } from '@/messages/admin';
import { PhoneField } from './PhoneField';
import { useAdminAction } from './useAdminAction';

/** "Revoke" on one role assignment. The API refuses to remove the last super admin (LAST_SUPER_ADMIN). */
export function RevokeRoleButton({
  m,
  assignmentId,
  name,
  roleLabel,
}: {
  m: AdminMessages;
  assignmentId: string;
  name: string;
  roleLabel: string;
}) {
  const action = useAdminAction(m);
  const [open, setOpen] = useState(false);
  const r = m.roles;

  async function confirm() {
    const ok = await action.run(() => adminApi.revokeRole(assignmentId), () => fill(r.revokedFmt, { name, role: roleLabel }));
    if (ok) setOpen(false);
  }

  return (
    <>
      <button type="button" className="fam-btn fam-btn--sm fam-btn--danger" onClick={() => setOpen(true)} disabled={action.busy}>
        {r.revoke}
        <span className="visually-hidden">
          {' '}
          {roleLabel} — {name}
        </span>
      </button>
      <ConfirmDialog
        open={open}
        icon="shield"
        title={r.revokeTitle}
        body={fill(r.revokeBodyFmt, { name, role: roleLabel })}
        confirmLabel={r.revokeConfirm}
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

/** "Grant a role": a phone of someone who signed in once, and one of the ten roles (task.md § 2.1). */
export function GrantRoleForm({ m, roles, roleNames }: { m: AdminMessages; roles: string[]; roleNames: Record<string, string> }) {
  const action = useAdminAction(m);
  const [digits, setDigits] = useState('');
  const [role, setRole] = useState('');
  const [tried, setTried] = useState(false);
  const r = m.roles;
  const desc = r.desc as Record<string, string>;
  const phoneBad = tried && !isComplete(digits);
  const roleBad = tried && !role;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!isComplete(digits) || !role) return;
    const phone = toE164(digits);
    const ok = await action.run(
      () => adminApi.grantRole(phone, role),
      () => fill(r.grantedDoneFmt, { role: roleNames[role] ?? role, phone: displayPhone(phone) }),
    );
    if (ok) {
      setDigits('');
      setRole('');
      setTried(false);
    }
  }

  return (
    <form className="fam-stack" style={{ '--gap': '18px' } as React.CSSProperties} onSubmit={submit} noValidate>
      <div>
        <PhoneField id="ad-grant-phone" label={m.common.phoneLabel} value={digits} onChange={setDigits} invalid={phoneBad} errorId="ad-grant-phone-err" />
        {phoneBad && (
          <p id="ad-grant-phone-err" className="fam-caption fam-caption--bad">
            {m.common.phoneInvalid}
          </p>
        )}
      </div>

      <fieldset className="ad-roles" aria-invalid={roleBad ? 'true' : 'false'} aria-describedby={roleBad ? 'ad-grant-role-err' : undefined}>
        <legend className="fam-label">{r.roleLabel}</legend>
        {roles.map((key) => (
          <label key={key} className="ad-role" data-checked={role === key ? 'true' : 'false'}>
            <input type="radio" name="ad-grant-role" value={key} checked={role === key} onChange={() => setRole(key)} />
            <span className="ad-role__text">
              <span className="ad-role__name">{roleNames[key] ?? key}</span>
              <span className="ad-role__desc">{desc[key] ?? ''}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {roleBad && (
        <p id="ad-grant-role-err" className="fam-caption fam-caption--bad">
          {r.roleRequired}
        </p>
      )}

      {action.error && (
        <p className="fam-alert" role="alert">
          {action.error}
        </p>
      )}
      <div>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={action.busy} aria-busy={action.busy}>
          {action.busy && <span className="spinner" aria-hidden="true" />}
          {r.grant}
        </button>
      </div>
    </form>
  );
}
