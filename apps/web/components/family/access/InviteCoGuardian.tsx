'use client';

import { useState } from 'react';
import { FamilyApiError, familyApi } from '@/lib/family-api';
import type { PendingInvite } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { useAction, type Copy } from './live';

/**
 * "Invite a co-guardian" (task.md § 8.2): a phone number, sent by SMS. The
 * API normalises "90 123 45 67" and "+998…" alike, so the field takes either.
 * Sent invitations are listed with their masked phone, never the typed one.
 */
export function InviteCoGuardian({
  copy,
  childId,
  invites,
}: {
  copy: Copy;
  childId: string;
  invites: PendingInvite[];
}) {
  const { m, locale } = copy;
  const { run, busy, errorFor } = useAction(copy);
  const [phone, setPhone] = useState('');
  const sendError = errorFor('invite');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    const ok = await run(
      'invite',
      () =>
        familyApi.inviteCoGuardian(childId, phone.trim()).catch((err: unknown) => {
          // Too short to be a phone at all fails DTO validation before the
          // phone check; to the parent both mean "not a valid number".
          if (err instanceof FamilyApiError && err.code === 'VALIDATION_FAILED') {
            throw new FamilyApiError('PHONE_INVALID', err.status);
          }
          throw err;
        }),
      (sent) => fill(m.done.invited, { phone: sent.phone }),
    );
    if (ok) setPhone('');
  }

  return (
    <div className="ac-invite">
      <hr className="fam-divider" />
      <form className="fam-stack" onSubmit={submit} noValidate>
        <div>
          <h3 className="ac-h3">{m.who.inviteTitle}</h3>
          <p className="fam-panel__sub">{m.who.inviteSub}</p>
        </div>
        <div className="fam-field">
          <label className="fam-label" htmlFor="ac-invite-phone">
            {m.who.phoneLabel}
          </label>
          <div className="ac-invite__row">
            <input
              id="ac-invite-phone"
              className="fam-input"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="90 123 45 67"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={sendError ? true : undefined}
              aria-describedby={sendError ? 'ac-invite-hint ac-invite-err' : 'ac-invite-hint'}
            />
            <button
              type="submit"
              className="fam-btn"
              disabled={busy !== null || !phone.trim()}
              aria-busy={busy === 'invite'}
            >
              {busy === 'invite' && <span className="spinner" aria-hidden="true" />}
              {m.who.inviteBtn}
            </button>
          </div>
          <p id="ac-invite-hint" className="fam-caption">
            {m.who.phoneHint}
          </p>
          {sendError && (
            <p id="ac-invite-err" className="fam-caption fam-caption--bad" role="alert">
              {sendError}
            </p>
          )}
        </div>
      </form>

      {invites.length > 0 && (
        <div className="fam-stack">
          <h4 className="fam-label">{m.who.pendingTitle}</h4>
          <ul className="ac-invites">
            {invites.map((i) => (
              <li key={i.id} className="ac-invites__item">
                <div className="ac-grow">
                  <span className="mono">{i.phone}</span>
                  <span className="fam-small fam-muted">
                    {fill(m.who.pendingMeta, {
                      date: formatDate(i.sentAt, locale, false),
                      expires: formatDate(i.expiresAt, locale, false),
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="fam-btn fam-btn--sm fam-btn--quiet"
                  onClick={() =>
                    run(`cancel:${i.id}`, () => familyApi.cancelInvite(childId, i.id), m.done.inviteCancelled)
                  }
                  disabled={busy !== null}
                  aria-busy={busy === `cancel:${i.id}`}
                >
                  {m.who.cancelInvite}
                </button>
              </li>
            ))}
          </ul>
          {invites.map((i) => errorFor(`cancel:${i.id}`)).find(Boolean) && (
            <p className="fam-alert" role="alert">
              {invites.map((i) => errorFor(`cancel:${i.id}`)).find(Boolean)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
