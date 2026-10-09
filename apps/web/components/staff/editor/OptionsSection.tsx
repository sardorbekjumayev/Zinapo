'use client';

import { useId } from 'react';
import { Icon } from '@/components/shell/Icon';
import type { Misconception, Taxonomy } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';
import { MediaSlot } from './MediaSlot';
import { MAX_OPTIONS, MIN_OPTIONS, letter, misconceptionName, topicName, type DraftOption } from './shared';

const blankOption = (): DraftOption => ({
  labelUz: '',
  labelRu: '',
  image: null,
  isKey: false,
  misconceptionCode: '',
  rationale: '',
});

/**
 * design/12 "Answer options": A–D (3–5 allowed), one key, and for every
 * distractor a misconception code + rationale (task.md § 1 rule 7, INV-10).
 *
 * `keysHidden` (a reviewer before the blind solve): the key, codes and
 * rationales are never rendered — the data does not even carry them.
 */
export function OptionsSection({
  options,
  onChange,
  topicCode,
  tax,
  m,
  locale,
  readOnly,
  keysHidden,
  errors,
}: {
  options: DraftOption[];
  onChange: (next: DraftOption[]) => void;
  topicCode: string;
  tax: Taxonomy;
  m: EditorMessages;
  locale: Locale;
  readOnly: boolean;
  keysHidden: boolean;
  errors: Set<string>;
}) {
  const group = useId();
  const groups = misconceptionGroups(tax, topicCode, locale, m);

  const set = (i: number, patch: Partial<DraftOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const markKey = (i: number) =>
    onChange(options.map((o, j) => ({ ...o, isKey: j === i })));

  return (
    <section className="fam-panel" aria-labelledby="ie-opt-h">
      <div>
        <h2 id="ie-opt-h" className="fam-panel__title">
          {m.opt.title}
        </h2>
        {!keysHidden && <p className="fam-panel__sub">{m.opt.hint}</p>}
      </div>

      {keysHidden && (
        <p className="fam-note fam-note--brand">
          <Icon name="lock" size={18} />
          <span>
            <strong>{m.keysHidden.title}. </strong>
            {m.keysHidden.body}
          </span>
        </p>
      )}

      {(errors.has('correct') || errors.has('options')) && (
        <p className="fam-caption fam-caption--bad" id="ie-opt-err">
          {[errors.has('correct') && m.opt.eCorrect, errors.has('options') && m.opt.eCount].filter(Boolean).join(' · ')}
        </p>
      )}

      <div
        className="ie-opts"
        role={keysHidden ? undefined : 'radiogroup'}
        aria-label={keysHidden ? undefined : m.opt.correct}
        aria-describedby={errors.has('correct') ? 'ie-opt-err' : undefined}
      >
        {options.map((o, i) => {
          const L = letter(i);
          const n = i + 1;
          const e = (k: string) => errors.has(`options.${n}.${k}`);
          const showMeta = !keysHidden && !o.isKey;
          const known = groups.some((g) => g.items.some((x) => x.code === o.misconceptionCode));
          return (
            <div
              key={i}
              className="ie-opt"
              data-key={!keysHidden && o.isKey ? 'true' : undefined}
              data-invalid={errors.has('correct') ? 'true' : undefined}
            >
              <div className="ie-opt__top">
                {!keysHidden && (
                  <label className="ie-radio" title={fill(m.opt.markCorrect, { L })}>
                    <input
                      type="radio"
                      name={`${group}-key`}
                      checked={o.isKey}
                      disabled={readOnly}
                      onChange={() => markKey(i)}
                      aria-label={fill(m.opt.markCorrect, { L })}
                    />
                  </label>
                )}
                <span className="ie-opt__letter" aria-hidden="true">
                  {L}
                </span>
                {!keysHidden && (
                  <span className={o.isKey ? 'fam-tag fam-tag--ok' : 'fam-tag'}>
                    {o.isKey ? m.opt.correct : m.opt.distractor}
                  </span>
                )}
                {!readOnly && options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm fam-btn--quiet ie-opt__remove"
                    onClick={() => onChange(options.filter((_, j) => j !== i))}
                    aria-label={fill(m.opt.remove, { L })}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>

              <div className="ie-row2">
                <Field
                  id={`${group}-${i}-uz`}
                  label={fill(m.opt.labelUz, { L })}
                  value={o.labelUz}
                  placeholder={m.opt.ph}
                  readOnly={readOnly}
                  error={e('labelUz') ? m.opt.eBody : null}
                  onChange={(v) => set(i, { labelUz: v })}
                />
                <Field
                  id={`${group}-${i}-ru`}
                  label={fill(m.opt.labelRu, { L })}
                  value={o.labelRu}
                  placeholder={m.opt.ph}
                  readOnly={readOnly}
                  error={e('labelRu') ? m.opt.eBody : null}
                  onChange={(v) => set(i, { labelRu: v })}
                />
              </div>

              {(!readOnly || o.image) && (
                <MediaSlot
                  kind="image"
                  title={fill(m.opt.image, { L })}
                  sub={m.media.imgSub}
                  value={o.image}
                  onChange={(image) => set(i, { image })}
                  m={m}
                  readOnly={readOnly}
                  alt={fill(m.media.optImgAlt, { L })}
                  compact
                />
              )}

              {showMeta && (
                <div className="ie-row2 ie-opt__meta">
                  <div className="fam-field">
                    <label className="fam-label" htmlFor={`${group}-${i}-code`}>
                      {m.opt.code}
                    </label>
                    <select
                      id={`${group}-${i}-code`}
                      className="fam-select"
                      value={o.misconceptionCode}
                      disabled={readOnly}
                      aria-label={fill(m.opt.codeAria, { L })}
                      aria-invalid={e('misconception') ? 'true' : undefined}
                      aria-describedby={e('misconception') ? `${group}-${i}-code-err` : undefined}
                      onChange={(ev) => set(i, { misconceptionCode: ev.target.value })}
                    >
                      <option value="">{m.opt.phCode}</option>
                      {!known && o.misconceptionCode && (
                        <option value={o.misconceptionCode}>{fill(m.opt.retired, { code: o.misconceptionCode })}</option>
                      )}
                      {groups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((x) => (
                            <option key={x.code} value={x.code}>
                              {x.code} — {misconceptionName(x, locale)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {e('misconception') && (
                      <p id={`${group}-${i}-code-err`} className="fam-caption fam-caption--bad">
                        {m.opt.eCode}
                      </p>
                    )}
                  </div>
                  <div className="fam-field">
                    <label className="fam-label" htmlFor={`${group}-${i}-rat`}>
                      {fill(m.opt.rat, { L })}
                    </label>
                    <textarea
                      id={`${group}-${i}-rat`}
                      className="ie-textarea ie-textarea--sm"
                      value={o.rationale}
                      readOnly={readOnly}
                      maxLength={1000}
                      rows={2}
                      placeholder={m.opt.phRat}
                      aria-invalid={e('rationale') ? 'true' : undefined}
                      aria-describedby={e('rationale') ? `${group}-${i}-rat-err` : undefined}
                      onChange={(ev) => set(i, { rationale: ev.target.value })}
                    />
                    {e('rationale') && (
                      <p id={`${group}-${i}-rat-err`} className="fam-caption fam-caption--bad">
                        {m.opt.eRat}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="ie-inline">
          {options.length < MAX_OPTIONS && (
            <button type="button" className="fam-btn fam-btn--sm" onClick={() => onChange([...options, blankOption()])}>
              <Icon name="plus" size={16} />
              {m.opt.add}
            </button>
          )}
          <span className="fam-small fam-muted">{m.opt.limits}</span>
        </div>
      )}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  placeholder,
  readOnly,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  readOnly: boolean;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="fam-field">
      <label className="fam-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="fam-input"
        value={value}
        readOnly={readOnly}
        maxLength={500}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-err`} className="fam-caption fam-caption--bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Live misconceptions, the item's own topic first, then the rest by topic. */
function misconceptionGroups(tax: Taxonomy, topicCode: string, locale: Locale, m: EditorMessages) {
  const live = tax.misconceptions.filter((x) => !x.retiredAt);
  const byTopic = new Map<string, Misconception[]>();
  for (const x of live) byTopic.set(x.topicCode, [...(byTopic.get(x.topicCode) ?? []), x]);
  const order = [...byTopic.keys()].sort((a, b) => (a === topicCode ? -1 : b === topicCode ? 1 : a.localeCompare(b)));
  return order.map((code) => {
    const topic = tax.topics.find((t) => t.code === code);
    return {
      label: code === topicCode ? m.opt.groupTopic : fill(m.opt.groupOther, { topic: topic ? topicName(topic, locale) : code }),
      items: byTopic.get(code)!.sort((a, b) => a.code.localeCompare(b.code)),
    };
  });
}
