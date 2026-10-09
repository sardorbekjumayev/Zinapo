'use client';

import { Icon } from '@/components/shell/Icon';
import type { KidMessages } from '@/messages/kid';

/**
 * design/05 "Review": counts, then the unanswered and flagged numbers as
 * buttons back into the test. Lists only — never which answer was chosen.
 */
export function ReviewScreen({
  t,
  answered,
  unanswered,
  flagged,
  headingRef,
  onPick,
  onBack,
  onSubmit,
  sync,
}: {
  t: KidMessages;
  answered: number;
  unanswered: number[];
  flagged: number[];
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onPick: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  sync: React.ReactNode;
}) {
  return (
    <section className="kd-card kd-main" aria-labelledby="kd-rv-title">
      <div className="kd-head">
        <span className="kd-over">{t.rvOver}</span>
        <h1 id="kd-rv-title" className="kd-title" ref={headingRef} tabIndex={-1}>
          {t.rvTitle}
        </h1>
        <p className="kd-sub">{t.rvSub}</p>
      </div>

      <div className="kd-facts">
        <div className="kd-fact">
          <span className="kd-fact__num">{answered}</span>
          <span className="kd-fact__small">{t.rvAnswered}</span>
        </div>
        <div className="kd-fact">
          <span className={unanswered.length ? 'kd-fact__num kd-fact__num--warn' : 'kd-fact__num'}>{unanswered.length}</span>
          <span className="kd-fact__small">{t.rvUnanswered}</span>
        </div>
        <div className="kd-fact">
          <span className="kd-fact__num">{flagged.length}</span>
          <span className="kd-fact__small">{t.rvFlagged}</span>
        </div>
      </div>

      <div className="kd-rvList">
        <h2 className="kd-label">{t.rvUnanswered}</h2>
        {unanswered.length ? (
          <ul className="kd-chips">
            {unanswered.map((i) => (
              <li key={i}>
                <button type="button" className="kd-num" aria-label={`${t.qWord} ${i + 1}`} onClick={() => onPick(i)}>
                  {i + 1}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="kd-muted">{t.rvNoneUn}</p>
        )}
      </div>

      <div className="kd-rvList">
        <h2 className="kd-label">{t.rvFlagged}</h2>
        {flagged.length ? (
          <ul className="kd-chips">
            {flagged.map((i) => (
              <li key={i}>
                <button
                  type="button"
                  className="kd-num kd-num--flag"
                  aria-label={`${t.qWord} ${i + 1}, ${t.lgFlagged}`}
                  onClick={() => onPick(i)}
                >
                  <Icon name="flag" size={14} strokeWidth={2} />
                  {i + 1}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="kd-muted">{t.rvNoneFl}</p>
        )}
      </div>

      {sync}

      <div className="kd-rvActions">
        <button type="button" className="fam-btn kd-btn" onClick={onBack}>
          <Icon name="arrowLeft" size={20} />
          {t.rvBack}
        </button>
        <button type="button" className="fam-btn fam-btn--primary kd-btn" onClick={onSubmit}>
          {t.rvSubmit}
        </button>
      </div>
    </section>
  );
}
