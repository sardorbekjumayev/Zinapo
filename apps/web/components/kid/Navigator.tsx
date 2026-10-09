'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { KidMessages } from '@/messages/kid';

export type CellState = 'answered' | 'skipped' | 'current' | 'notYet';

/**
 * design/05's question grid: answered / skipped / flagged / current / not
 * opened. On a phone it folds away behind a toggle so the question keeps the
 * screen; from 900px up it is always open (kid.css).
 */
export function Navigator({
  t,
  cells,
  answeredCount,
  showReview,
  onPick,
  onReview,
}: {
  t: KidMessages;
  cells: { state: CellState; flagged: boolean }[];
  answeredCount: number;
  showReview: boolean;
  onPick: (index: number) => void;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label: Record<CellState, string> = {
    answered: t.lgAnswered,
    skipped: t.lgSkipped,
    current: t.lgCurrent,
    notYet: t.lgNotYet,
  };

  return (
    <aside className={open ? 'kd-card kd-nav kd-nav--open' : 'kd-card kd-nav'} aria-labelledby="kd-nav-title">
      <div className="kd-nav__head">
        <h2 id="kd-nav-title" className="kd-h2">
          {t.navTitle}
        </h2>
        <span className="kd-nav__count">{fill(t.answeredLabel, { n: answeredCount })}</span>
      </div>
      <button
        type="button"
        className="fam-btn kd-nav__toggle"
        aria-expanded={open}
        aria-controls="kd-nav-body"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t.navHide : t.navShow}
        <Icon name="chevronDown" size={18} />
      </button>
      <div id="kd-nav-body" className="kd-nav__body">
        <span className="kd-nav__hint">{t.navHint}</span>
        <ol className="kd-grid">
          {cells.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                className={`kd-cell kd-cell--${c.state}`}
                aria-current={c.state === 'current' ? 'step' : undefined}
                aria-label={`${t.qWord} ${i + 1}: ${label[c.state]}${c.flagged ? `, ${t.lgFlagged}` : ''}`}
                onClick={() => onPick(i)}
              >
                {i + 1}
                {c.flagged && (
                  <span className="kd-cell__flag" aria-hidden="true">
                    <Icon name="flag" size={10} strokeWidth={2.4} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
        <ul className="kd-legend" aria-hidden="true">
          <li><span className="kd-sw kd-sw--answered" />{t.lgAnswered}</li>
          <li><span className="kd-sw kd-sw--skipped" />{t.lgSkipped}</li>
          <li><span className="kd-sw kd-sw--flag"><Icon name="flag" size={9} strokeWidth={2.4} /></span>{t.lgFlagged}</li>
          <li><span className="kd-sw kd-sw--current" />{t.lgCurrent}</li>
          <li><span className="kd-sw kd-sw--notYet" />{t.lgNotYet}</li>
        </ul>
        {showReview && (
          <button type="button" className="fam-btn kd-btn kd-nav__review" onClick={onReview}>
            {t.reviewBtn}
          </button>
        )}
      </div>
    </aside>
  );
}
