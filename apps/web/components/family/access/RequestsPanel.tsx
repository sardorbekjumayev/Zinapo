'use client';

import { useState } from 'react';
import { Avatar } from '@/components/family/Avatar';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { familyApi } from '@/lib/family-api';
import type { EducatorAccess, UntilOptions } from '@/lib/family-types';
import { daysUntil, formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { useAction, type Copy } from './live';

type Done = { kind: 'approved'; name: string; date: string } | { kind: 'declined'; name: string };

/**
 * design/06 "Access requests": a tutor can only ask; the parent approves with
 * an end date (school-year end recommended, or 3 months) or declines, which
 * blocks that educator for the season (task.md § 8.1.5).
 */
export function RequestsPanel({
  copy,
  child,
  requests,
  until,
  readOnly,
}: {
  copy: Copy;
  child: string;
  requests: EducatorAccess[];
  until: UntilOptions;
  readOnly: boolean;
}) {
  const { m, f, locale } = copy;
  const { run, busy, errorFor, clearError } = useAction(copy);
  const [approving, setApproving] = useState<string | null>(null);
  const [choice, setChoice] = useState<'year' | '3m'>('year');
  const [declining, setDeclining] = useState<EducatorAccess | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const dateFor = (c: 'year' | '3m') => (c === 'year' ? until.schoolYearEnd : until.threeMonths);

  async function approve(r: EducatorAccess) {
    const date = dateFor(choice);
    const pretty = formatDate(date, locale);
    const ok = await run(
      `approve:${r.linkId}`,
      () => familyApi.approve(r.linkId, date),
      fill(m.done.approved, { name: r.educatorName, date: pretty }),
    );
    if (ok) {
      setApproving(null);
      setDone({ kind: 'approved', name: r.educatorName, date: pretty });
    }
  }

  async function decline() {
    if (!declining) return;
    const r = declining;
    const ok = await run(
      'decline',
      () => familyApi.decline(r.linkId),
      fill(m.done.declined, { name: r.educatorName }),
    );
    if (ok) {
      setDeclining(null);
      setDone({ kind: 'declined', name: r.educatorName });
    }
  }

  return (
    <section className="fam-panel" aria-labelledby="ac-req-h">
      <div className="fam-panel__head">
        <div>
          <h2 id="ac-req-h" className="fam-panel__title">
            {m.req.title}
          </h2>
          <p className="fam-panel__sub">{m.req.sub}</p>
        </div>
        {requests.length > 0 && (
          <span className="fam-tag fam-tag--brand">{fill(m.req.badge, { n: requests.length })}</span>
        )}
      </div>

      {done?.kind === 'approved' && (
        <div className="ac-result ac-result--ok">
          <span className="ac-result__icon">
            <Icon name="check" size={20} strokeWidth={2} />
          </span>
          <div className="fam-stack" style={{ ['--gap' as string]: '4px' }}>
            <strong className="ac-result__title">{fill(m.req.approvedTitle, { date: done.date })}</strong>
            <span>{fill(m.req.approvedNote, { name: done.name })}</span>
          </div>
        </div>
      )}
      {done?.kind === 'declined' && (
        <div className="ac-result">
          <span className="ac-result__icon">
            <Icon name="ban" size={20} />
          </span>
          <div className="fam-stack" style={{ ['--gap' as string]: '4px' }}>
            <strong className="ac-result__title">{m.req.declinedTitle}</strong>
            <span className="fam-muted">{fill(m.req.declinedNote, { name: done.name, child })}</span>
          </div>
        </div>
      )}

      {requests.length === 0 && !done && <p className="ac-none">{m.req.none}</p>}

      {requests.map((r) => {
        const open = approving === r.linkId;
        const days = r.requestExpiresAt ? daysUntil(r.requestExpiresAt) : null;
        const err = errorFor(`approve:${r.linkId}`);
        return (
          <article key={r.linkId} className="ac-request" aria-labelledby={`ac-rq-${r.linkId}`}>
            <Avatar name={r.educatorName} tone="teal" size="lg" />
            <div className="ac-request__body">
              <div className="fam-inline">
                <h3 id={`ac-rq-${r.linkId}`} className="ac-request__name">
                  {r.educatorName}
                </h3>
                <span className="fam-tag fam-tag--teal">{f.role[r.educatorKind]}</span>
              </div>
              <p className="ac-request__text">{fill(m.req.body, { child })}</p>
              <p className="ac-meta">
                <Icon name="clock" size={16} />
                <span>
                  {fill(m.req.received, { date: formatDate(r.requestedAt, locale, false) })}
                  {days !== null && ` · ${fill(m.req.expiresIn, { n: days })}`}
                </span>
              </p>

              {!readOnly && !open && (
                <div className="ac-request__actions">
                  <button
                    type="button"
                    className="fam-btn fam-btn--primary"
                    onClick={() => {
                      clearError();
                      setChoice('year');
                      setApproving(r.linkId);
                    }}
                  >
                    {m.req.approve}
                  </button>
                  <button
                    type="button"
                    className="fam-btn"
                    onClick={() => {
                      clearError();
                      setDeclining(r);
                    }}
                  >
                    {m.req.decline}
                  </button>
                </div>
              )}

              {!readOnly && open && (
                <div className="ac-approve">
                  <p className="ac-approve__sees">{m.req.sees}</p>
                  <fieldset className="ac-until">
                    <legend className="fam-label">{m.req.untilQ}</legend>
                    <div className="fam-row">
                      {(['year', '3m'] as const).map((c) => (
                        <label key={c} className="fam-check">
                          <input
                            type="radio"
                            name={`until-${r.linkId}`}
                            value={c}
                            checked={choice === c}
                            onChange={() => setChoice(c)}
                          />
                          <span className="fam-stack" style={{ ['--gap' as string]: '2px' }}>
                            <span className="ac-until__label">{c === 'year' ? m.req.optYear : m.req.opt3m}</span>
                            <span className="fam-small fam-muted">
                              {fill(c === 'year' ? m.req.optYearSub : m.req.opt3mSub, {
                                date: formatDate(dateFor(c), locale),
                              })}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {err && (
                    <p className="fam-alert" role="alert">
                      {err}
                    </p>
                  )}
                  <div className="ac-request__actions">
                    <button
                      type="button"
                      className="fam-btn fam-btn--primary"
                      onClick={() => approve(r)}
                      disabled={busy !== null}
                      aria-busy={busy === `approve:${r.linkId}`}
                    >
                      {busy === `approve:${r.linkId}` && <span className="spinner" aria-hidden="true" />}
                      {m.req.grant}
                    </button>
                    <button
                      type="button"
                      className="fam-btn fam-btn--quiet"
                      onClick={() => setApproving(null)}
                      disabled={busy !== null}
                    >
                      {m.req.back}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </article>
        );
      })}

      {!readOnly && (
        <ConfirmDialog
          open={declining !== null}
          title={fill(m.dlg.declineT, { name: declining?.educatorName ?? '' })}
          body={fill(m.dlg.declineD, { child })}
          confirmLabel={m.dlg.declineOk}
          cancelLabel={m.dlg.back}
          icon="ban"
          busy={busy === 'decline'}
          error={errorFor('decline')}
          onConfirm={decline}
          onClose={() => {
            clearError();
            setDeclining(null);
          }}
        />
      )}
    </section>
  );
}
