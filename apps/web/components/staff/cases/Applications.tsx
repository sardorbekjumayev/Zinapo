'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '@/components/educator/invites/shared';
import { Icon } from '@/components/shell/Icon';
import { useAnnounce } from '@/components/staff/review/live';
import { educatorApi } from '@/lib/educator-api';
import type { EducatorApplication } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { CasesMessages } from '@/messages/cases';

/** One application's facts: who, as what, where, which areas. */
function Facts({ a, locale, m }: { a: EducatorApplication; locale: Locale; m: CasesMessages }) {
  const region = (locale === 'ru' ? a.regionRu : a.regionUz) ?? m.apps.noRegion;
  return (
    <div className="iv-app__body">
      <span className="iv-app__name">{a.fullName}</span>
      <span className="mono fam-small">{a.phone}</span>
      <span className="fam-small fam-muted">
        {m.kind[a.kind]} · {region} · {a.schoolName ?? m.apps.noSchool}
      </span>
      {a.subjects && a.subjects.length > 0 && (
        <span className="iv-tags">
          {a.subjects.map((s) => (
            <span key={s} className="fam-tag fam-tag--brand">
              {m.subject[s]}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** The waiting list with Approve / Reject (task.md § 8.5: trust_safety decides). */
export function WaitingApplications({
  locale,
  m,
  list,
}: {
  locale: Locale;
  m: CasesMessages;
  list: EducatorApplication[];
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<EducatorApplication | null>(null);

  const decide = async (a: EducatorApplication, decision: 'approved' | 'rejected', note?: string) => {
    setBusy(a.personId);
    setError(null);
    try {
      await educatorApi.decide(a.personId, decision, note?.trim() || undefined);
      announce(fill(decision === 'approved' ? m.apps.approved : m.apps.rejected, { name: a.fullName }));
      setRejecting(null);
      router.refresh();
    } catch (err) {
      setError(errorText(err, m.errors));
    } finally {
      setBusy(null);
    }
  };

  if (list.length === 0) {
    return (
      <div className="iv-inlineState">
        <span className="state__icon state__icon--empty">
          <Icon name="inbox" size={24} />
        </span>
        <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <h3 className="iv-inlineState__title">{m.apps.emptyT}</h3>
          <p className="fam-small fam-muted">{m.apps.emptyD}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {error && !rejecting && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
      <ul className="iv-apps" aria-label={m.apps.listLabel}>
        {list.map((a) => (
          <li key={a.personId} className="iv-app">
            <Facts a={a} locale={locale} m={m} />
            <span className="fam-small fam-muted">{fill(m.apps.applied, { date: formatDate(a.appliedAt, locale) })}</span>
            <div className="iv-app__actions">
              <button
                type="button"
                className="fam-btn fam-btn--primary fam-btn--sm"
                disabled={busy !== null}
                aria-busy={busy === a.personId}
                onClick={() => decide(a, 'approved')}
              >
                {busy === a.personId && !rejecting && <span className="spinner" aria-hidden="true" />}
                <Icon name="check" size={16} />
                {m.apps.approve}
              </button>
              <button
                type="button"
                className="fam-btn fam-btn--danger fam-btn--sm"
                disabled={busy !== null}
                onClick={() => {
                  setError(null);
                  setRejecting(a);
                }}
              >
                {m.apps.reject}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <RejectDialog
        m={m}
        target={rejecting}
        busy={busy !== null}
        error={rejecting ? error : null}
        onClose={() => setRejecting(null)}
        onConfirm={(note) => rejecting && decide(rejecting, 'rejected', note)}
      />
    </>
  );
}

/**
 * The reject confirmation with an optional reason. ConfirmDialog's look, but
 * with a field — the reason is shown to the applicant.
 */
function RejectDialog({
  m,
  target,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  m: CasesMessages;
  target: EducatorApplication | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (target && !el.open) {
      setNote('');
      el.showModal();
    }
    if (!target && el.open) el.close();
  }, [target]);

  return (
    <dialog
      ref={ref}
      className="fam-dialog"
      aria-labelledby="iv-reject-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <span className="fam-dialog__icon">
        <Icon name="alert" size={22} />
      </span>
      <h2 id="iv-reject-title" className="fam-dialog__title">
        {fill(m.apps.rejectTitle, { name: target?.fullName ?? '' })}
      </h2>
      <p className="fam-dialog__body">{m.apps.rejectBody}</p>
      <div className="fam-field" style={{ marginTop: 16 }}>
        <label htmlFor="iv-reject-note" className="fam-label">
          {m.apps.rejectNote}
        </label>
        <textarea
          id="iv-reject-note"
          className="iv-textarea iv-textarea--plain"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && (
        <p className="fam-alert" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
      <div className="fam-dialog__actions">
        <button type="button" className="fam-btn" onClick={onClose} disabled={busy}>
          {m.apps.cancel}
        </button>
        <button
          type="button"
          className="fam-btn fam-btn--dangerSolid"
          onClick={() => onConfirm(note)}
          disabled={busy}
          aria-busy={busy}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {m.apps.rejectConfirm}
        </button>
      </div>
    </dialog>
  );
}

/** The "Decided" sub-list: read-only. */
export function DecidedApplications({
  locale,
  m,
  list,
}: {
  locale: Locale;
  m: CasesMessages;
  list: EducatorApplication[];
}) {
  if (list.length === 0) return <p className="fam-small fam-muted">{m.apps.decidedEmpty}</p>;
  const tone: Record<string, string> = { approved: 'fam-tag--ok', rejected: 'fam-tag--danger', suspended: 'fam-tag--warn' };
  return (
    <ul className="iv-apps" aria-label={m.apps.decidedT}>
      {list.map((a) => (
        <li key={a.personId} className="iv-app">
          <Facts a={a} locale={locale} m={m} />
          <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
            <span className={`fam-tag ${tone[a.status] ?? ''}`}>{m.apps.status[a.status]}</span>
            <span className="fam-small fam-muted">
              {fill(m.apps.decided, {
                status: m.apps.status[a.status],
                date: formatDate(a.decidedAt, locale),
                by: a.decidedBy ?? '—',
              })}
            </span>
            {a.note && <span className="fam-small">{fill(m.apps.note, { note: a.note })}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
