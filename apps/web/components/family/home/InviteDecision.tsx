'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { familyApi, FamilyApiError } from '@/lib/family-api';

export interface InviteDecisionCopy {
  accept: string;
  decline: string;
  declineTitle: string;
  declineBody: string;
  cancel: string;
  accepting: string;
  declinedTitle: string;
  declinedBody: string;
  toDashboard: string;
  expired: string;
  used: string;
  notFound: string;
  already: string;
  networkError: string;
  genericError: string;
}

/**
 * Accept or decline a guardian invitation. Accepting changes which workspaces
 * the person holds, so the session is refreshed before navigating — otherwise
 * the middleware's 15-minute `ws` claim would bounce them off `/family`.
 */
export function InviteDecision({
  code,
  locale,
  copy,
}: {
  code: string;
  locale: string;
  copy: InviteDecisionCopy;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function message(err: unknown): string {
    if (!(err instanceof FamilyApiError)) return copy.genericError;
    if (err.code === 'NETWORK') return copy.networkError;
    if (err.code === 'ALREADY_GUARDIAN') return copy.already;
    if (err.code === 'INVITE_INVALID') {
      const reason = err.details.reason;
      return reason === 'expired' ? copy.expired : reason === 'used' ? copy.used : copy.notFound;
    }
    return copy.genericError;
  }

  async function accept() {
    setBusy('accept');
    setError(null);
    try {
      const { childId } = await familyApi.acceptInvite(code);
      setAccepted(true);
      // The relationship exists now; a failed refresh only means the next
      // navigation re-checks the token the slow way.
      await familyApi.refreshSession().catch(() => undefined);
      router.push(`/${locale}/family/children/${childId}`);
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(null);
    }
  }

  async function decline() {
    setBusy('decline');
    setError(null);
    try {
      await familyApi.declineInvite(code);
      setConfirm(false);
      setDeclined(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  if (declined) {
    return (
      <div className="fam-stack" role="status">
        <p className="fam-note">
          <Icon name="check" size={18} />
          <span>
            <strong>{copy.declinedTitle}</strong>
            {copy.declinedBody}
          </span>
        </p>
        <Link href={`/${locale}/dashboard`} className="fam-btn" style={{ alignSelf: 'flex-start' }}>
          {copy.toDashboard}
        </Link>
      </div>
    );
  }

  return (
    <>
      <div aria-live="polite">
        {accepted && (
          <p className="fam-alert fam-alert--ok" role="status">
            {copy.accepting}
          </p>
        )}
        {error && !confirm && (
          <p className="fam-alert" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="fam-actions">
        <button
          type="button"
          className="fam-btn fam-btn--quiet"
          disabled={busy !== null || accepted}
          onClick={() => {
            setError(null);
            setConfirm(true);
          }}
        >
          {copy.decline}
        </button>
        <button
          type="button"
          className="fam-btn fam-btn--primary"
          disabled={busy !== null || accepted}
          aria-busy={busy === 'accept'}
          onClick={accept}
        >
          {busy === 'accept' && <span className="spinner" aria-hidden="true" />}
          <Icon name="check" size={18} />
          {copy.accept}
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={copy.declineTitle}
        body={copy.declineBody}
        confirmLabel={copy.decline}
        cancelLabel={copy.cancel}
        busy={busy === 'decline'}
        error={confirm ? error : null}
        onConfirm={decline}
        onClose={() => {
          setConfirm(false);
          setError(null);
        }}
      />
    </>
  );
}
