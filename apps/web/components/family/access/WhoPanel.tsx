'use client';

import { useState } from 'react';
import { Avatar } from '@/components/family/Avatar';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { familyApi } from '@/lib/family-api';
import type { EducatorAccess, GuardianView, PendingInvite } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { disputesMessages } from '@/messages/disputes';
import { InviteCoGuardian } from './InviteCoGuardian';
import { useAction, type Copy } from './live';

type Dialog =
  | { kind: 'transfer'; person: GuardianView }
  | { kind: 'remove'; person: GuardianView }
  | { kind: 'revoke'; link: EducatorAccess };

/**
 * design/06 "Who can see": guardians (owner first) and educators whose link
 * is active, suspended or switched off. Owner-only controls: transfer
 * ownership, remove a co-guardian, switch an educator off / restore, invite a
 * co-guardian (task.md § 8.1.5).
 */
export function WhoPanel({
  copy,
  childId,
  child,
  guardians,
  pending,
  educators,
  readOnly,
}: {
  copy: Copy;
  childId: string;
  child: string;
  guardians: GuardianView[];
  pending: PendingInvite[];
  educators: EducatorAccess[];
  readOnly: boolean;
}) {
  const { m, f, locale } = copy;
  const { run, busy, errorFor, clearError } = useAction(copy);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const people = [...guardians].sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1));
  const offer = pending.find((p) => p.kind === 'ownership_transfer') ?? null;
  // The offer names the invitee only when they already have an account; a
  // transfer from this page always goes to a current co-guardian, so match
  // by name and fall back to a row of its own.
  const offeredTo = offer
    ? people.find((g) => g.role === 'co_guardian' && g.fullName === offer.inviteeName) ?? null
    : null;
  const invites = pending.filter((p) => p.kind === 'co_guardian');

  async function confirm() {
    if (!dialog) return;
    let ok = false;
    if (dialog.kind === 'transfer') {
      const name = dialog.person.fullName;
      ok = await run(
        'dialog',
        () => familyApi.offerTransfer(childId, { personId: dialog.person.personId }),
        fill(m.done.transferOffered, { name }),
      );
    } else if (dialog.kind === 'remove') {
      const name = dialog.person.fullName;
      ok = await run(
        'dialog',
        () => familyApi.removeGuardian(childId, dialog.person.personId),
        fill(m.done.removed, { name }),
      );
    } else {
      const name = dialog.link.educatorName;
      ok = await run(
        'dialog',
        () => familyApi.revoke(childId, dialog.link.linkId),
        fill(m.done.revoked, { name }),
      );
    }
    if (ok) setDialog(null);
  }

  const cancelOffer = () =>
    run('cancelOffer', () => familyApi.cancelTransfer(childId), m.done.transferCancelled);

  const restore = (l: EducatorAccess) =>
    run(`restore:${l.linkId}`, () => familyApi.restore(childId, l.linkId), fill(m.done.restored, { name: l.educatorName }));

  const inlineError = errorFor('cancelOffer') ?? educators.map((l) => errorFor(`restore:${l.linkId}`)).find(Boolean);

  const dlgCopy = dialog
    ? dialog.kind === 'transfer'
      ? {
          title: fill(m.dlg.transferT, { name: dialog.person.fullName }),
          body: m.dlg.transferD,
          list: [fill(m.dlg.transferL1, { name: dialog.person.fullName }), m.dlg.transferL2, m.dlg.transferL3],
          ok: m.dlg.transferOk,
          danger: false,
        }
      : dialog.kind === 'remove'
        ? {
            title: fill(m.dlg.removeT, { name: dialog.person.fullName }),
            body: fill(m.dlg.removeD, { child }),
            ok: m.dlg.removeOk,
            danger: true,
          }
        : {
            title: fill(m.dlg.revokeT, { name: dialog.link.educatorName }),
            body: fill(m.dlg.revokeD, { name: dialog.link.educatorName, child }),
            ok: m.dlg.revokeOk,
            danger: true,
          }
    : null;

  return (
    <section className="fam-panel" aria-labelledby="ac-who-h">
      <div>
        <h2 id="ac-who-h" className="fam-panel__title">
          {m.who.title}
        </h2>
        <p className="fam-panel__sub">{fill(m.who.sub, { child })}</p>
      </div>

      <ul className="fam-people ac-list">
        {people.map((g) => {
          const isOwner = g.role === 'owner';
          const offered = offeredTo?.personId === g.personId;
          return (
            <li key={g.personId} className="fam-person">
              <Avatar name={g.fullName} tone={isOwner ? 'brand' : 'blue'} />
              <div className="fam-person__body">
                <span className="fam-person__name">
                  {g.fullName}
                  {g.isMe && <span className="fam-tag">{f.role.me}</span>}
                  <span className={isOwner ? 'fam-tag fam-tag--brand' : 'fam-tag fam-tag--blue'}>
                    {f.role[g.role]}
                  </span>
                  {offered && <span className="fam-tag fam-tag--warn">{m.who.transferPending}</span>}
                </span>
                <p className="fam-person__desc">
                  {offered
                    ? fill(m.who.transferPendingDesc, { name: g.fullName.split(' ')[0] })
                    : isOwner
                      ? m.who.ownerDesc
                      : m.who.coDesc}
                </p>
              </div>
              {!readOnly && !isOwner && (
                <div className="ac-person__actions">
                  {offered ? (
                    <button
                      type="button"
                      className="fam-btn fam-btn--sm"
                      onClick={cancelOffer}
                      disabled={busy !== null}
                      aria-busy={busy === 'cancelOffer'}
                    >
                      {busy === 'cancelOffer' && <span className="spinner" aria-hidden="true" />}
                      {m.who.cancelOffer}
                    </button>
                  ) : (
                    !offer && (
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm"
                        onClick={() => {
                          clearError();
                          setDialog({ kind: 'transfer', person: g });
                        }}
                      >
                        {m.who.transfer}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm fam-btn--quiet"
                    onClick={() => {
                      clearError();
                      setDialog({ kind: 'remove', person: g });
                    }}
                  >
                    {m.who.remove}
                  </button>
                </div>
              )}
            </li>
          );
        })}

        {educators.map((l) => {
          const off = l.status === 'revoked';
          const paused = l.status === 'suspended';
          return (
            <li key={l.linkId} className="fam-person">
              <Avatar name={l.educatorName} tone="teal" />
              <div className="fam-person__body">
                <span className="fam-person__name">
                  {l.educatorName}
                  <span className="fam-tag fam-tag--teal">{f.role[l.educatorKind]}</span>
                  {off && <span className="fam-tag fam-tag--danger">{m.who.revokedTag}</span>}
                  {paused && <span className="fam-tag fam-tag--warn">{m.who.suspendedTag}</span>}
                </span>
                <p className="fam-person__desc">
                  {off
                    ? fill(m.who.revokedDesc, { child, name: l.educatorName })
                    : paused && l.awaitingOwnerAnswer && !readOnly
                      ? disputesMessages(locale).access.awaitingDesc
                      : fill(paused ? m.who.suspendedDesc : m.who.scope, {
                          date: formatDate(l.validUntil, locale),
                        })}
                </p>
              </div>
              {!readOnly && l.status === 'active' && (
                <div className="ac-person__actions">
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm fam-btn--danger"
                    onClick={() => {
                      clearError();
                      setDialog({ kind: 'revoke', link: l });
                    }}
                  >
                    {m.who.switchOff}
                  </button>
                </div>
              )}
              {!readOnly && off && l.canRestore && (
                <div className="ac-person__actions">
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm"
                    onClick={() => restore(l)}
                    disabled={busy !== null}
                    aria-busy={busy === `restore:${l.linkId}`}
                  >
                    {busy === `restore:${l.linkId}` && <span className="spinner" aria-hidden="true" />}
                    {m.who.restore}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {offer && !offeredTo && (
        <div className="fam-note fam-note--warn">
          <Icon name="users" size={18} />
          <div className="ac-grow">
            <strong>{m.who.transferPending}</strong>
            {fill(m.who.transferPendingRow, { phone: offer.phone, date: formatDate(offer.expiresAt, locale) })}
          </div>
          {!readOnly && (
            <button
              type="button"
              className="fam-btn fam-btn--sm"
              onClick={cancelOffer}
              disabled={busy !== null}
            >
              {m.who.cancelOffer}
            </button>
          )}
        </div>
      )}

      {inlineError && (
        <p className="fam-alert" role="alert">
          {inlineError}
        </p>
      )}

      <p className="fam-note">
        <Icon name="clock" size={18} />
        <span>{educators.length > 0 ? m.who.foot : fill(m.who.noEducators, { child })}</span>
      </p>

      {!readOnly && <InviteCoGuardian copy={copy} childId={childId} invites={invites} />}

      {/* Always mounted, so the native dialog closes (and hands focus back)
          rather than being torn out of the page. */}
      {!readOnly && (
        <ConfirmDialog
          open={dlgCopy !== null}
          title={dlgCopy?.title ?? ''}
          body={dlgCopy?.body ?? ''}
          list={dlgCopy && 'list' in dlgCopy ? dlgCopy.list : undefined}
          confirmLabel={dlgCopy?.ok ?? ''}
          cancelLabel={m.dlg.back}
          danger={dlgCopy?.danger ?? true}
          icon={dialog?.kind === 'transfer' ? 'users' : dialog?.kind === 'remove' ? 'user' : 'ban'}
          busy={busy === 'dialog'}
          error={errorFor('dialog')}
          onConfirm={confirm}
          onClose={() => {
            clearError();
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}
