'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import type { EducatorAccess } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { TrustApiError, trustApi } from '@/lib/trust-api';
import { disputesMessages, type DisputesMessages } from '@/messages/disputes';

/**
 * The reasons the API writes on a suspended link (apps/api trust/queue.service:
 * a fraud check, a confirmed flag, a won ownership dispute), in the reader's
 * language. Anything else is shown as written.
 */
function reasonText(reason: string | null | undefined, m: DisputesMessages): string | null {
  switch (reason) {
    case 'Ishonch va xavfsizlik tekshiruvi':
      return m.access.reasonCheck;
    case 'Ishonch va xavfsizlik qarori':
      return m.access.reasonDecision;
    case 'Egalik oʻzgardi':
      return m.access.reasonOwnership;
    default:
      return reason ?? null;
  }
}

type Result = { linkId: string; text: string; tone: 'ok' | 'info' };

/**
 * task.md § 8.5 / M8-g: trust & safety never ends access silently — it pauses
 * the link and asks the owner. One card per link waiting for an answer, at the
 * top of the child's access board. Only the owner answers; a co-guardian sees
 * the same notice read-only.
 *
 * Results are kept here rather than in the server list: after the answer the
 * link no longer waits, so its card is gone on refresh, but the parent should
 * still read what their answer did.
 */
export function OwnerAnswers({
  childId,
  child,
  links,
  readOnly,
  owner,
  locale,
}: {
  childId: string;
  child: string;
  links: EducatorAccess[];
  readOnly: boolean;
  owner: string | null;
  locale: Locale;
}) {
  const m = disputesMessages(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [ending, setEnding] = useState<EducatorAccess | null>(null);

  const answered = new Set(results.map((r) => r.linkId));
  const waiting = links.filter((l) => !answered.has(l.linkId));
  if (waiting.length === 0 && results.length === 0) return null;

  async function answer(l: EducatorAccess, keep: boolean): Promise<boolean> {
    setBusy(`${l.linkId}:${keep ? 'keep' : 'end'}`);
    setErrors((x) => {
      const next = { ...x };
      delete next[l.linkId];
      return next;
    });
    const vars = { educator: l.educatorName, child, date: formatDate(l.validUntil, locale) };
    try {
      await trustApi.answerLink(childId, l.linkId, keep);
      setResults((r) => [...r, { linkId: l.linkId, text: fill(keep ? m.access.keptResult : m.access.endedResult, vars), tone: 'ok' }]);
      router.refresh();
      return true;
    } catch (err) {
      const e = err instanceof TrustApiError ? err : null;
      if (e?.status === 404) {
        // Answered already (another tab, or the case was closed): show the
        // current state instead of an error.
        setResults((r) => [...r, { linkId: l.linkId, text: m.access.answered, tone: 'info' }]);
        router.refresh();
        return true;
      }
      const text =
        e?.status === 403
          ? m.access.forbidden
          : e?.code === 'NETWORK'
            ? m.errors.NETWORK
            : e?.status === 429
              ? m.errors.RATE_LIMITED
              : m.errors.generic;
      setErrors((x) => ({ ...x, [l.linkId]: text }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dp-answers">
      {waiting.map((l) => {
        const vars = { educator: l.educatorName, child };
        const ownership = l.suspendedReason === 'Egalik oʻzgardi';
        const reason = reasonText(l.suspendedReason, m);
        const headId = `dp-ans-${l.linkId}`;
        return (
          <section key={l.linkId} className="dp-answer" aria-labelledby={headId}>
            <span className="dp-answer__icon" aria-hidden="true">
              <Icon name="shield" size={24} />
            </span>
            <div className="dp-answer__body">
              <span className="card__kicker">{m.access.kicker}</span>
              <h2 id={headId} className="dp-answer__title">
                {fill(ownership ? m.access.titleOwnership : m.access.titleCheck, vars)}
              </h2>
              {reason && (
                <p className="dp-answer__text">
                  <strong>{m.access.reasonLabel}</strong> {reason}
                </p>
              )}
              <p className="dp-answer__text">{fill(m.access.meanwhile, vars)}</p>
              {readOnly ? (
                <p className="fam-note">
                  <Icon name="lock" size={18} />
                  <span>{owner ? fill(m.access.coNote, { owner }) : m.access.coNoteNoOwner}</span>
                </p>
              ) : (
                <div className="dp-actions">
                  <button
                    type="button"
                    className="fam-btn fam-btn--primary"
                    onClick={() => answer(l, true)}
                    disabled={busy !== null}
                    aria-busy={busy === `${l.linkId}:keep`}
                  >
                    {busy === `${l.linkId}:keep` && <span className="spinner" aria-hidden="true" />}
                    {m.access.keep}
                  </button>
                  <button
                    type="button"
                    className="fam-btn fam-btn--danger"
                    onClick={() => setEnding(l)}
                    disabled={busy !== null}
                  >
                    {m.access.end}
                  </button>
                </div>
              )}
              {errors[l.linkId] && (
                <p className="fam-alert" role="alert">
                  {errors[l.linkId]}
                </p>
              )}
            </div>
          </section>
        );
      })}

      <div role="status" aria-live="polite" className="dp-answers__results">
        {results.map((r) => (
          <p key={r.linkId} className={r.tone === 'ok' ? 'fam-alert fam-alert--ok' : 'fam-note'}>
            {r.text}
          </p>
        ))}
      </div>

      {!readOnly && (
        <ConfirmDialog
          open={ending !== null}
          title={ending ? fill(m.access.dlgTitle, { educator: ending.educatorName, child }) : ''}
          body={ending ? fill(m.access.dlgBody, { educator: ending.educatorName, child }) : ''}
          confirmLabel={m.access.dlgOk}
          cancelLabel={m.access.dlgBack}
          danger
          icon="ban"
          busy={ending !== null && busy === `${ending.linkId}:end`}
          error={ending ? errors[ending.linkId] ?? null : null}
          onConfirm={async () => {
            if (ending && (await answer(ending, false))) setEnding(null);
          }}
          onClose={() => setEnding(null)}
        />
      )}
    </div>
  );
}
