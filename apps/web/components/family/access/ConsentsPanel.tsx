'use client';

import { useState } from 'react';
import { Toggle } from '@/components/family/Toggle';
import { Icon } from '@/components/shell/Icon';
import { familyApi } from '@/lib/family-api';
import type { ConsentState, ConsentType } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { useAction, type Copy } from './live';

/**
 * design/06 "Consents": one row per consent, each given or withdrawn
 * separately (task.md § 8.1.2, § 8.1.7). Withdrawing data processing stops
 * measurement, so it asks first, inline, rather than in a modal.
 */
export function ConsentsPanel({
  copy,
  childId,
  child,
  consents,
  readOnly,
  title,
  headExtra,
}: {
  copy: Copy;
  childId: string;
  child: string;
  consents: ConsentState[];
  readOnly: boolean;
  /** The /family/consents page heads each panel with the child's name. */
  title?: string;
  headExtra?: React.ReactNode;
}) {
  const { m, f, locale } = copy;
  const { run, busy, errorFor, clearError } = useAction(copy);
  const [warn, setWarn] = useState(false);
  const headId = `ac-cons-h-${childId}`;

  const set = (type: ConsentType, given: boolean) => {
    const name = f.consent[type].title;
    return run(
      `consent:${type}`,
      () => familyApi.setConsent(childId, type, given),
      fill(given ? m.done.consentOn : m.done.consentOff, { consent: name }),
    ).then((ok) => {
      if (ok) setWarn(false);
    });
  };

  return (
    <section className="fam-panel" aria-labelledby={headId}>
      <div className="fam-panel__head">
        <div>
          <h2 id={headId} className="fam-panel__title">
            {title ?? m.cons.title}
          </h2>
          <p className="fam-panel__sub">{readOnly ? m.cons.subReadOnly : fill(m.cons.sub, { child })}</p>
        </div>
        {headExtra}
      </div>

      <ul className="ac-consents">
        {consents.map((c) => {
          const doc = fill(f.consent.doc, { v: c.documentVersion ?? c.currentDocumentVersion });
          const meta = c.given
            ? fill(f.consent.givenOn, { doc, date: formatDate(c.givenAt, locale) })
            : c.revokedAt
              ? fill(f.consent.revokedOn, { doc, date: formatDate(c.revokedAt, locale) })
              : fill(f.consent.notGiven, { doc });
          const isProc = c.type === 'data_processing';
          const err = errorFor(`consent:${c.type}`);
          const titleId = `ac-c-${childId}-${c.type}`;
          return (
            <li key={c.type} className="ac-consent">
              <div className="ac-consent__row">
                <div className="ac-grow">
                  <span className="fam-inline">
                    <span id={titleId} className="ac-consent__title">
                      {f.consent[c.type].title}
                    </span>
                    <span className={c.required ? 'fam-tag fam-tag--brand' : 'fam-tag'}>
                      {c.required ? f.consent.required : f.consent.optional}
                    </span>
                  </span>
                  <p className="ac-consent__desc">{f.consent[c.type].desc}</p>
                  <p className="ac-consent__meta">{meta}</p>
                </div>
                {readOnly ? (
                  <span className={c.given ? 'fam-tag fam-tag--ok' : 'fam-tag'}>
                    {c.given ? m.cons.on : m.cons.off}
                  </span>
                ) : (
                  <span className="ac-consent__switch">
                    {busy === `consent:${c.type}` && <span className="spinner" aria-hidden="true" />}
                    <Toggle
                      checked={c.given}
                      label={f.consent[c.type].title}
                      disabled={busy !== null}
                      onChange={(next) => {
                        clearError();
                        if (isProc && !next) setWarn(true);
                        else void set(c.type, next);
                      }}
                    />
                  </span>
                )}
              </div>

              {isProc && warn && c.given && !readOnly && (
                <div className="fam-note fam-note--warn" role="alert">
                  <Icon name="alert" size={18} />
                  <div className="ac-grow fam-stack">
                    <div>
                      <strong>{m.cons.warnTitle}</strong>
                      {fill(m.cons.warnBody, { child })}
                    </div>
                    <div className="fam-inline">
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm fam-btn--dangerSolid"
                        onClick={() => set(c.type, false)}
                        disabled={busy !== null}
                        aria-busy={busy === `consent:${c.type}`}
                      >
                        {m.cons.warnOff}
                      </button>
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm"
                        onClick={() => setWarn(false)}
                        disabled={busy !== null}
                      >
                        {m.cons.warnKeep}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {isProc && !c.given && (
                <p className="fam-note fam-note--warn">
                  <Icon name="info" size={18} />
                  <span>{fill(m.cons.paused, { child })}</span>
                </p>
              )}

              {err && (
                <p className="fam-alert" role="alert">
                  {err}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
