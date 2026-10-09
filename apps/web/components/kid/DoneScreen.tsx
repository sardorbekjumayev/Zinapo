'use client';

import Link from 'next/link';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { SessionResult } from '@/lib/session-types';
import type { KidMessages } from '@/messages/kid';
import { WifiOff, WifiOn } from './ReadyScreen';

export type SubmitState = 'sending' | 'sent' | 'waiting';

/**
 * design/05 "Done". Monitoring: thanks, whether the answers reached us, why
 * there is no score and how feedback arrives — never a score or a key
 * (task.md § 1.10, § 8.3). Practice (teal): "you solved n of m" only (§ 1.11).
 */
export function DoneScreen({
  t,
  practice,
  name,
  wave,
  closesOn,
  submit,
  timeUp,
  result,
  warning,
  homeHref,
  headingRef,
  onRetry,
}: {
  t: KidMessages;
  practice: boolean;
  name: string;
  wave: string;
  closesOn: string | null;
  submit: SubmitState;
  timeUp: boolean;
  result: SessionResult | null;
  warning: string | null;
  homeHref: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onRetry: () => void;
}) {
  const solved = practice && submit === 'sent' && typeof result?.solved === 'number' && typeof result.total === 'number';

  return (
    <div className="kd-split">
      <section className={practice ? 'kd-card kd-main kd-main--practice' : 'kd-card kd-main'} aria-labelledby="kd-dn-title">
        <div className="kd-doneHead">
          <span className={practice ? 'kd-doneMark kd-doneMark--practice' : 'kd-doneMark'} aria-hidden="true">
            <Icon name="check" size={30} strokeWidth={2.2} />
          </span>
          <div className="kd-head">
            <span className="kd-over">{practice ? t.dnOverPractice : fill(t.dnOver, { wave })}</span>
            <h1 id="kd-dn-title" className="kd-title" ref={headingRef} tabIndex={-1}>
              {fill(t.dnTitle, { name })}
            </h1>
            <p className="kd-sub">{t.dnSub}</p>
            {timeUp && <p className="kd-sub kd-sub--strong">{t.dnTimeUp}</p>}
          </div>
        </div>

        <div aria-live="polite">
          {submit === 'sending' && (
            <div className="kd-banner kd-banner--neutral" role="status">
              <span className="spinner" aria-hidden="true" />
              <div className="kd-banner__text">
                <span className="kd-banner__title">{t.dnSendingTitle}</span>
                <span>{t.dnSendingBody}</span>
              </div>
            </div>
          )}
          {submit === 'sent' && (
            <div className="kd-banner kd-banner--ok" role="status">
              <span className="kd-banner__icon" aria-hidden="true">
                <WifiOn />
              </span>
              <div className="kd-banner__text">
                <span className="kd-banner__title">{t.dnSentTitle}</span>
                <span>{t.dnSentBody}</span>
              </div>
            </div>
          )}
          {submit === 'waiting' && (
            <div className="kd-banner kd-banner--warn" role="status">
              <span className="kd-banner__icon" aria-hidden="true">
                <WifiOff />
              </span>
              <div className="kd-banner__text">
                <span className="kd-banner__title">{t.dnQTitle}</span>
                <span>{t.dnQBody}</span>
                {warning && <span className="kd-banner__extra">{warning}</span>}
              </div>
              <button type="button" className="fam-btn kd-btn kd-banner__btn" onClick={onRetry}>
                {t.dnRetry}
              </button>
            </div>
          )}
        </div>

        {practice ? (
          <div className="kd-solved">
            <span className="kd-solved__big">
              {solved ? fill(t.prSolved, { solved: result!.solved!, total: result!.total! }) : t.prPending}
            </span>
            {solved && <span className="kd-muted">{t.prSolvedSub}</span>}
          </div>
        ) : (
          <div className="kd-facts kd-facts--two">
            <div className="kd-fact kd-fact--text">
              <span className="kd-fact__title">{t.whyTitle}</span>
              <span className="kd-muted">{t.whyBody}</span>
            </div>
            <div className="kd-fact kd-fact--text">
              <span className="kd-fact__title">{t.fbTitle}</span>
              <span className="kd-muted">{closesOn ? fill(t.fbBody, { date: closesOn }) : t.fbBodyNoDate}</span>
            </div>
          </div>
        )}

        <div>
          <Link href={homeHref} className="fam-btn fam-btn--primary kd-btn--xl">
            {t.dnHome}
            <Icon name="arrowRight" size={20} />
          </Link>
        </div>
      </section>

      {!practice && (
        <aside className="kd-card kd-side" aria-labelledby="kd-rp-title">
          <span className="kd-over">{t.rpOver}</span>
          <h2 id="kd-rp-title" className="kd-h2">
            {t.rpTitle}
          </h2>
          <ul className="kd-rules">
            <li>
              <span className="kd-rule kd-rule--yes" aria-hidden="true">
                <Icon name="check" size={16} strokeWidth={2} />
              </span>
              {t.rp1}
            </li>
            <li>
              <span className="kd-rule kd-rule--yes" aria-hidden="true">
                <Icon name="check" size={16} strokeWidth={2} />
              </span>
              {t.rp2}
            </li>
            <li className="kd-muted">
              <span className="kd-rule kd-rule--no" aria-hidden="true">
                <Icon name="x" size={16} strokeWidth={2} />
              </span>
              {t.rpNo}
            </li>
          </ul>
        </aside>
      )}
    </div>
  );
}
