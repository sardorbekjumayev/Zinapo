'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { useAnnounce } from '@/components/staff/review/live';
import { adminApi, AdminApiError } from '@/lib/admin-api';
import type { OutcomeCandidate, PendingOutcome } from '@/lib/admin-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { OutcomesMessages } from '@/messages/outcomes';
import { errorText } from './shared';

/** Codes after which the row on screen is stale — re-read the queue. */
const STALE = new Set(['ALREADY_REVIEWED', 'NOT_FOUND']);

/**
 * Rows the PINFL hash did not match (task.md § 8.5 "reviews unmatched rows").
 * A person looks at children with the same date of birth and a similar family
 * name — shown masked — and links one, or marks the row as not a Zinapo child.
 * Both write `admission_outcome` for good, so both go through a confirm.
 */
export function ReviewQueue({ m, locale, rows }: { m: OutcomesMessages; locale: Locale; rows: PendingOutcome[] }) {
  return (
    <ul className="ad-oc-queue">
      {rows.map((r) => (
        <ReviewRow key={r.id} m={m} locale={locale} row={r} />
      ))}
    </ul>
  );
}

type Confirm = { kind: 'match'; child: OutcomeCandidate } | { kind: 'not' };

function ReviewRow({ m, locale, row }: { m: OutcomesMessages; locale: Locale; row: PendingOutcome }) {
  const t = m.review;
  const router = useRouter();
  const announce = useAnnounce();
  const [candidates, setCandidates] = useState<OutcomeCandidate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const who = `${row.familyName} ${row.givenName}`;
  const rowName = `${fill(t.lineFmt, { n: row.line })} (${who})`;
  const listId = `ad-oc-cands-${row.id}`;

  async function find() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      setCandidates(await adminApi.outcomeCandidates(row.id));
    } catch (err) {
      setCandidates(null);
      setError(errorText(err, m));
      if (err instanceof AdminApiError && STALE.has(err.code)) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function decide() {
    if (!confirm) return;
    setBusy(true);
    setDialogError(null);
    try {
      if (confirm.kind === 'match') {
        await adminApi.matchOutcome(row.id, confirm.child.childId);
        announce(fill(t.matchedFmt, { row: rowName }));
      } else {
        await adminApi.notZinapo(row.id);
        announce(fill(t.notDoneFmt, { row: rowName }));
      }
      setConfirm(null);
      router.refresh();
    } catch (err) {
      setDialogError(errorText(err, m));
      if (err instanceof AdminApiError && STALE.has(err.code)) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="ad-oc-row">
      <div className="ad-oc-row__main">
        <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <span className="ad-oc-row__name">{who}</span>
          <span className="fam-small fam-muted">
            {fill(t.dobFmt, { d: formatDate(row.dob, locale) })} · {row.school ?? t.noSchool}
          </span>
          <span className="fam-inline" style={{ '--gap': '6px' } as React.CSSProperties}>
            <span className={row.admitted ? 'fam-tag fam-tag--ok' : 'fam-tag'}>{row.admitted ? t.admittedYes : t.admittedNo}</span>
            <span className="fam-tag">{fill(t.yearFmt, { y: row.admitYear })}</span>
            <span className="fam-tag">{fill(t.lineFmt, { n: row.line })}</span>
          </span>
        </div>
        <span className="ad-oc-row__actions">
          <button
            type="button"
            className="fam-btn fam-btn--sm"
            aria-expanded={open}
            aria-controls={listId}
            disabled={loading}
            aria-busy={loading}
            onClick={find}
          >
            {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="users" size={16} />}
            {loading ? t.finding : open ? t.hide : t.find}
          </button>
          <button type="button" className="fam-btn fam-btn--sm fam-btn--quiet" onClick={() => setConfirm({ kind: 'not' })}>
            <Icon name="ban" size={16} />
            {t.notZinapo}
          </button>
        </span>
      </div>

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      <div id={listId} hidden={!open || loading || candidates === null} aria-live="polite">
        {candidates && (
          <div className="ad-oc-cands">
            <h3 className="ad-oc-sub">{t.candidatesTitle}</h3>
            {candidates.length === 0 ? (
              <p className="fam-small fam-muted">{t.noCandidates}</p>
            ) : (
              <ul className="ad-oc-cands__list">
                {candidates.map((c) => {
                  const region = locale === 'ru' ? c.regionRu : c.regionUz;
                  return (
                    <li key={c.childId} className="ad-oc-cand">
                      <div className="fam-stack" style={{ '--gap': '2px' } as React.CSSProperties}>
                        <span className="ad-oc-cand__name">
                          {c.name}
                          {c.sameFamilyName && <span className="fam-tag fam-tag--blue">{t.sameFamily}</span>}
                        </span>
                        <span className="fam-small fam-muted">
                          {formatDate(c.dob, locale)} · {c.grade === null ? t.noGrade : fill(t.gradeFmt, { g: c.grade })} ·{' '}
                          {region ?? t.noRegion}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm fam-btn--primary"
                        onClick={() => setConfirm({ kind: 'match', child: c })}
                      >
                        <Icon name="check" size={16} />
                        {t.thisIsTheChild}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        icon={confirm?.kind === 'match' ? 'child' : 'ban'}
        danger={confirm?.kind === 'not'}
        title={confirm?.kind === 'match' ? t.matchTitle : t.notTitle}
        body={
          confirm?.kind === 'match'
            ? fill(t.matchBodyFmt, { row: rowName, child: confirm.child.name })
            : fill(t.notBodyFmt, { row: rowName })
        }
        confirmLabel={confirm?.kind === 'match' ? t.matchConfirm : t.notConfirm}
        cancelLabel={t.cancel}
        busy={busy}
        error={dialogError}
        onConfirm={decide}
        onClose={() => {
          setConfirm(null);
          setDialogError(null);
        }}
      />
    </li>
  );
}
