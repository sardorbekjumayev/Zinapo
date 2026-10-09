'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { BundleItem } from '@/lib/session-types';
import type { KidMessages } from '@/messages/kid';
import type { LocalAnswer } from './storage';
import { audioOf, labelOf, LETTERS, stemOf, type StemLang } from './util';

/**
 * design/05 "Mid-test": one question, large type, big option cards. Options are
 * a radiogroup of real buttons; ↑ ↓ move focus between them (← → are kept for
 * moving between questions, handled by the player).
 *
 * Mounted with `key={item.itemVersionId}`, so audio stops on every move.
 */
export function QuestionCard({
  t,
  item,
  index,
  total,
  answer,
  answeredCount,
  stemLang,
  media,
  locked,
  headingRef,
  onChoose,
  onFlag,
  onPrev,
  onNext,
  onSkip,
  sync,
}: {
  t: KidMessages;
  item: BundleItem;
  index: number;
  total: number;
  answer: LocalAnswer | undefined;
  answeredCount: number;
  stemLang: StemLang;
  media: (url: string) => string;
  locked: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onChoose: (optionId: string) => void;
  onFlag: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  sync: React.ReactNode;
}) {
  const flagged = !!answer?.flagged;
  const chosen = answer?.chosenOptionId ?? null;
  const isLast = index >= total - 1;
  const audioUrl = audioOf(item, stemLang);
  const stemId = `kd-stem-${item.itemVersionId}`;
  const optsRef = useRef<HTMLDivElement>(null);

  const onOptionsKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(optsRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const to = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[to]?.focus();
  };

  // Roving tabindex: Tab lands on the chosen option (or the first), not on all four.
  const tabStop = chosen ?? item.options[0]?.id;

  return (
    <section className="kd-card kd-q" aria-labelledby={`kd-qh-${item.itemVersionId}`}>
      <div className="kd-q__top">
        <h1 id={`kd-qh-${item.itemVersionId}`} className="kd-q__label" ref={headingRef} tabIndex={-1}>
          {fill(t.qLabel, { n: index + 1, m: total })}
        </h1>
        {flagged && (
          <span className="kd-pill kd-pill--flag">
            <Icon name="flag" size={14} strokeWidth={2} />
            {t.flagged}
          </span>
        )}
        <span className="kd-q__count">{fill(t.answeredLabel, { n: answeredCount })}</span>
      </div>
      <div
        className="kd-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answeredCount}
        aria-label={fill(t.answeredLabel, { n: answeredCount })}
      >
        <span style={{ width: `${total ? Math.round((answeredCount / total) * 100) : 0}%` }} />
      </div>

      <div className="kd-q__stemRow">
        <p id={stemId} className="kd-q__stem" lang={stemLang === 'ru' ? 'ru' : 'uz-Latn'}>
          {stemOf(item, stemLang)}
        </p>
        {audioUrl && <ReadAloud t={t} src={media(audioUrl)} />}
      </div>

      {item.imageUrl && (
        <img className="kd-q__img" src={media(item.imageUrl)} alt={t.stemPicture} />
      )}

      <div
        ref={optsRef}
        role="radiogroup"
        aria-label={t.optsLabel}
        aria-describedby={stemId}
        className="kd-opts"
        onKeyDown={onOptionsKey}
      >
        {item.options.map((o, k) => {
          const on = chosen === o.id;
          const letter = LETTERS[k] ?? String(k + 1);
          const label = labelOf(o, stemLang);
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={locked || undefined}
              tabIndex={o.id === tabStop ? 0 : -1}
              className={on ? 'kd-opt kd-opt--on' : 'kd-opt'}
              onClick={() => !locked && onChoose(o.id)}
              lang={stemLang === 'ru' ? 'ru' : 'uz-Latn'}
            >
              <span className="kd-opt__letter" aria-hidden="true">
                {letter}
              </span>
              <span className="visually-hidden">{letter}. </span>
              {o.imageUrl && (
                <img className="kd-opt__img" src={media(o.imageUrl)} alt={fill(t.optionPicture, { letter })} />
              )}
              {label && <span className="kd-opt__label">{label}</span>}
            </button>
          );
        })}
      </div>

      <div className="kd-q__actions">
        <button type="button" className="fam-btn kd-btn" onClick={onPrev} disabled={index === 0}>
          <Icon name="arrowLeft" size={20} />
          {t.prev}
        </button>
        <button
          type="button"
          className={flagged ? 'fam-btn kd-btn kd-btn--flagOn' : 'fam-btn kd-btn'}
          aria-pressed={flagged}
          onClick={onFlag}
          disabled={locked}
        >
          <Icon name="flag" size={20} />
          {flagged ? t.flagged : t.flag}
        </button>
        <span className="kd-q__spacer" />
        {!chosen && (
          <button type="button" className="fam-btn fam-btn--quiet kd-btn" onClick={onSkip}>
            {t.skip}
          </button>
        )}
        <button type="button" className="fam-btn fam-btn--primary kd-btn" onClick={onNext}>
          {isLast ? t.toReview : t.next}
          <Icon name="arrowRight" size={20} />
        </button>
      </div>
      <p className="kd-keys">{t.keysHint}</p>
      {sync}
    </section>
  );
}

function ReadAloud({ t, src }: { t: KidMessages; src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => ref.current?.pause(), []);

  const toggle = async () => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      el.currentTime = 0;
      return;
    }
    try {
      setFailed(false);
      await el.play();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="kd-listen">
      <button
        type="button"
        className={playing ? 'kd-listen__btn kd-listen__btn--on' : 'kd-listen__btn'}
        aria-pressed={playing}
        onClick={toggle}
      >
        <Icon name="play" size={26} strokeWidth={2} />
        <span>{playing ? t.listenStop : t.listen}</span>
      </button>
      <audio
        ref={ref}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      {failed && (
        <span className="kd-listen__err" role="status">
          {t.listenError}
        </span>
      )}
    </div>
  );
}
