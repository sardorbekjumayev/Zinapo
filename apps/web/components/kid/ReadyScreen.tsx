'use client';

import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { KidMessages } from '@/messages/kid';
import type { StemLang } from './util';

/**
 * design/05 "Ready": what the test is, that it is fully downloaded and works
 * offline, how it works, and a card for the adult nearby. Monitoring and
 * practice differ in wording, not only colour (task.md § 7.1).
 */
export function ReadyScreen({
  t,
  practice,
  name,
  wave,
  questions,
  answered,
  minutesLeft,
  resumed,
  stemLang,
  onStemLang,
  onStart,
}: {
  t: KidMessages;
  practice: boolean;
  name: string;
  wave: string;
  questions: number;
  answered: number;
  /** null = the form has no time limit. */
  minutesLeft: number | null;
  resumed: boolean;
  stemLang: StemLang;
  onStemLang: (l: StemLang) => void;
  onStart: () => void;
}) {
  const how = [t.how1, t.how2, t.how3];
  return (
    <div className="kd-split">
      <section className="kd-card kd-main" aria-labelledby="kd-ready-title">
        <div className="kd-head">
          <span className="kd-over">{resumed ? t.readyOverResume : t.readyOver}</span>
          <h1 id="kd-ready-title" className="kd-title" tabIndex={-1}>
            {practice ? t.readyTitlePractice : fill(t.readyTitle, { wave })}
          </h1>
          <p className="kd-sub">{fill(practice ? t.readySubPractice : t.readySub, { name })}</p>
          {resumed && <p className="kd-sub kd-sub--strong">{fill(t.resumeNote, { n: answered, m: questions })}</p>}
        </div>

        <div className="kd-facts">
          <div className="kd-fact">
            <span className="kd-fact__big">{fill(t.fQ, { n: questions })}</span>
            <span className="kd-fact__small">{t.fQs}</span>
          </div>
          <div className="kd-fact">
            <span className="kd-fact__big">{minutesLeft === null ? t.fTnone : fill(t.fT, { n: minutesLeft })}</span>
            <span className="kd-fact__small">{minutesLeft === null ? t.fTnoneSub : t.fTs}</span>
          </div>
          <div className="kd-fact">
            <span className="kd-fact__big">
              <span className="kd-tick" aria-hidden="true">
                <Icon name="check" size={16} strokeWidth={2.2} />
              </span>
              {t.fD}
            </span>
            <span className="kd-fact__small">{t.fDs}</span>
          </div>
        </div>

        <div className="kd-banner kd-banner--ok">
          <span className="kd-banner__icon" aria-hidden="true">
            <WifiOff />
          </span>
          <div className="kd-banner__text">
            <span className="kd-banner__title">{t.offTitle}</span>
            <span>{t.offBody}</span>
          </div>
        </div>

        <div className="kd-how">
          <h2 className="kd-h2">{t.howTitle}</h2>
          <ol className="kd-how__list">
            {how.map((line, i) => (
              <li key={i}>
                <span className="kd-how__n" aria-hidden="true">
                  {i + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
        </div>

        <div className="kd-lang" role="radiogroup" aria-label={t.stemLang}>
          <span className="kd-lang__label" aria-hidden="true">
            {t.stemLang}
          </span>
          {(['uz', 'ru'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={stemLang === l}
              className="kd-lang__opt"
              lang={l === 'uz' ? 'uz-Latn' : 'ru'}
              onClick={() => onStemLang(l)}
            >
              {l === 'uz' ? t.stemLangUz : t.stemLangRu}
            </button>
          ))}
        </div>

        <div className="kd-startRow">
          <button type="button" className="fam-btn fam-btn--primary kd-btn--xl" onClick={onStart}>
            {resumed ? t.resume : t.start}
            <Icon name="arrowRight" size={20} />
          </button>
          <span className="kd-note">{t.startNote}</span>
        </div>
      </section>

      {!practice && (
        <aside className="kd-card kd-side" aria-labelledby="kd-adult-title">
          <span className="kd-over">{t.adOver}</span>
          <h2 id="kd-adult-title" className="kd-h2">
            {t.adTitle}
          </h2>
          <p className="kd-muted">{fill(t.adBody, { name })}</p>
          <ul className="kd-rules">
            <li>
              <span className="kd-rule kd-rule--yes" aria-hidden="true">
                <Icon name="check" size={16} strokeWidth={2} />
              </span>
              {t.adR1}
            </li>
            <li>
              <span className="kd-rule kd-rule--no" aria-hidden="true">
                <Icon name="x" size={16} strokeWidth={2} />
              </span>
              {t.adR2}
            </li>
            <li>
              <span className="kd-rule kd-rule--no" aria-hidden="true">
                <Icon name="x" size={16} strokeWidth={2} />
              </span>
              {t.adR3}
            </li>
          </ul>
          <p className="kd-why">{t.adWhy}</p>
        </aside>
      )}
    </div>
  );
}

/** design/05's wifi glyphs — not in the shared icon set. */
export function WifiOff() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <path d="M12 19.5h.01" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function WifiOn() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <path d="M12 19.5h.01" />
    </svg>
  );
}
