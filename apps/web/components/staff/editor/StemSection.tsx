'use client';

import { useId } from 'react';
import { Icon } from '@/components/shell/Icon';
import type { MediaRef, StemFormat } from '@/lib/bank-types';
import type { EditorMessages } from '@/messages/editor';
import { MediaSlot } from './MediaSlot';
import { isYoung } from './shared';

export interface StemValue {
  stemFormat: StemFormat;
  stemUz: string;
  stemRu: string;
  image: MediaRef | null;
  audioUz: MediaRef | null;
  audioRu: MediaRef | null;
}

/**
 * design/12 "Stem": format cards, the picture and read-aloud audio slots, and
 * one textarea per language behind uz/ru tabs. Grades 0–1 accept only
 * "Picture + read-aloud audio" (task.md § 8.3: `audio_ref` required).
 */
export function StemSection({
  value,
  onChange,
  grade,
  m,
  readOnly,
  errors,
  tab,
  onTab,
}: {
  value: StemValue;
  onChange: (patch: Partial<StemValue>) => void;
  grade: number;
  m: EditorMessages;
  readOnly: boolean;
  errors: Set<string>;
  tab: 'uz' | 'ru';
  onTab: (t: 'uz' | 'ru') => void;
}) {
  const base = useId();
  const young = isYoung(grade);
  const formats: [StemFormat, string, string][] = [
    ['text', m.stem.fmtText, m.stem.fmtTextSub],
    ['image', m.stem.fmtImage, m.stem.fmtImageSub],
    ['image_audio', m.stem.fmtAudio, m.stem.fmtAudioSub],
  ];
  const fmtErr = errors.has('stemFormat');

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tab === 'uz' ? 'ru' : 'uz';
    onTab(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  }

  return (
    <section className="fam-panel" aria-labelledby={`${base}-h`}>
      <h2 id={`${base}-h`} className="fam-panel__title">
        {m.stem.title}
      </h2>

      <fieldset className="ie-fieldset" aria-describedby={fmtErr ? `${base}-fmt-err` : undefined}>
        <legend className="fam-label">{m.stem.format}</legend>
        <div className="ie-fmts">
          {formats.map(([f, title, sub]) => {
            // A young grade can still *show* a saved text format, but not pick it.
            const blocked = young && f !== 'image_audio' && value.stemFormat !== f;
            return (
              <label key={f} className="ie-fmt" data-invalid={fmtErr ? 'true' : undefined}>
                <input
                  type="radio"
                  name={`${base}-fmt`}
                  checked={value.stemFormat === f}
                  disabled={readOnly || blocked}
                  onChange={() => onChange({ stemFormat: f })}
                />
                <span className="ie-fmt__text">
                  <span className="ie-fmt__title">{title}</span>
                  <span className="ie-fmt__sub">{sub}</span>
                </span>
              </label>
            );
          })}
        </div>
        {young && value.stemFormat !== 'image_audio' && (
          <p id={`${base}-fmt-err`} className="fam-note fam-note--warn" style={{ marginTop: 12 }}>
            <Icon name="alert" size={18} />
            <span>{m.stem.youngWarn}</span>
          </p>
        )}
      </fieldset>

      {value.stemFormat !== 'text' && (
        <div className="ie-mediaGrid">
          <MediaSlot
            kind="image"
            title={m.media.img}
            sub={m.media.imgSub}
            value={value.image}
            onChange={(image) => onChange({ image })}
            m={m}
            readOnly={readOnly}
            invalid={errors.has('image')}
            invalidText={m.media.eImg}
            alt={m.media.imgAlt}
          />
          {value.stemFormat === 'image_audio' && (
            <>
              <MediaSlot
                kind="audio"
                title={m.media.audUz}
                sub={m.media.audSub}
                value={value.audioUz}
                onChange={(audioUz) => onChange({ audioUz })}
                m={m}
                readOnly={readOnly}
                invalid={errors.has('audioUz')}
                invalidText={m.media.eAud}
                alt=""
              />
              <MediaSlot
                kind="audio"
                title={m.media.audRu}
                sub={m.media.audSub}
                value={value.audioRu}
                onChange={(audioRu) => onChange({ audioRu })}
                m={m}
                readOnly={readOnly}
                invalid={errors.has('audioRu')}
                invalidText={m.media.eAud}
                alt=""
              />
            </>
          )}
        </div>
      )}

      <div>
        <div className="ie-tabs" role="tablist" aria-label={m.stem.tabsLabel}>
          {(['uz', 'ru'] as const).map((l) => {
            const text = l === 'uz' ? value.stemUz : value.stemRu;
            const bad = errors.has(l === 'uz' ? 'stemUz' : 'stemRu');
            return (
              <button
                key={l}
                id={`${base}-tab-${l}`}
                type="button"
                role="tab"
                className="ie-tab"
                aria-selected={tab === l}
                aria-controls={`${base}-panel-${l}`}
                tabIndex={tab === l ? 0 : -1}
                onClick={() => onTab(l)}
                onKeyDown={onTabKey}
                data-invalid={bad ? 'true' : undefined}
              >
                {l === 'uz' ? m.stem.tabUz : m.stem.tabRu}
                <span className={bad ? 'ie-tab__st ie-tab__st--bad' : text.trim() ? 'ie-tab__st ie-tab__st--ok' : 'ie-tab__st'}>
                  {text.trim() ? m.stem.tabFilled : m.stem.tabEmpty}
                </span>
              </button>
            );
          })}
        </div>
        {(['uz', 'ru'] as const).map((l) => {
          const key = l === 'uz' ? 'stemUz' : 'stemRu';
          const bad = errors.has(key);
          return (
            <div
              key={l}
              id={`${base}-panel-${l}`}
              role="tabpanel"
              aria-labelledby={`${base}-tab-${l}`}
              hidden={tab !== l}
              className="fam-field ie-tabpanel"
            >
              <label className="fam-label" htmlFor={`${base}-stem-${l}`}>
                {l === 'uz' ? m.stem.labelUz : m.stem.labelRu}
              </label>
              <textarea
                id={`${base}-stem-${l}`}
                className="ie-textarea"
                lang={l === 'uz' ? 'uz-Latn' : 'ru'}
                rows={4}
                maxLength={4000}
                value={value[key]}
                readOnly={readOnly}
                placeholder={m.stem.ph}
                aria-invalid={bad ? 'true' : undefined}
                aria-describedby={bad ? `${base}-stem-${l}-err` : undefined}
                onChange={(e) => onChange({ [key]: e.target.value })}
              />
              {bad && (
                <p id={`${base}-stem-${l}-err`} className="fam-caption fam-caption--bad">
                  {m.stem.eStem}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
