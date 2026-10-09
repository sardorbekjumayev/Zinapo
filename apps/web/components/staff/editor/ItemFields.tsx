'use client';

import type { Cluster, Taxonomy } from '@/lib/bank-types';
import type { Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';
import { CLUSTERS, GRADES, needsSkill, skillsFor, topicName, topicsFor } from './shared';

export interface ItemFieldsValue {
  grade: number | null;
  cluster: Cluster | null;
  topicCode: string;
  skillCode: string;
  construct: string;
}

export type ItemFieldErrors = Partial<Record<'grade' | 'cluster' | 'topic' | 'skill' | 'construct', string>>;

/**
 * design/12 "Item card", item-level half: grade, cluster → topic, skill
 * (grades 0–2 only, INV-11) and construct. Changing the grade or cluster drops
 * a topic/skill that no longer fits, so the API's `topic_grade` / `skill_topic`
 * can only happen through a stale taxonomy.
 */
export function ItemFields({
  value,
  onChange,
  tax,
  m,
  locale,
  errors = {},
  idPrefix,
}: {
  value: ItemFieldsValue;
  onChange: (next: ItemFieldsValue) => void;
  tax: Taxonomy;
  m: EditorMessages;
  locale: Locale;
  errors?: ItemFieldErrors;
  idPrefix: string;
}) {
  const topics = topicsFor(tax, value.grade, value.cluster);
  const skills = skillsFor(tax, value.grade, value.topicCode);

  function set(patch: Partial<ItemFieldsValue>) {
    const next = { ...value, ...patch };
    const okTopics = topicsFor(tax, next.grade, next.cluster);
    if (!okTopics.some((t) => t.code === next.topicCode)) next.topicCode = '';
    const okSkills = skillsFor(tax, next.grade, next.topicCode);
    if (!okSkills.some((s) => s.code === next.skillCode)) next.skillCode = '';
    onChange(next);
  }

  const id = (k: string) => `${idPrefix}-${k}`;
  const err = (k: keyof ItemFieldErrors) =>
    errors[k] ? (
      <p id={id(`${k}-err`)} className="fam-caption fam-caption--bad">
        {errors[k]}
      </p>
    ) : null;

  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '18px' }}>
      <div className="ie-row2">
        <fieldset className="ie-fieldset" aria-describedby={errors.grade ? id('grade-err') : undefined}>
          <legend className="fam-label">{m.card.grade}</legend>
          <div className="ie-seg" data-invalid={errors.grade ? 'true' : undefined}>
            {GRADES.map((g) => (
              <label key={g} className="ie-seg__opt">
                <input
                  type="radio"
                  name={id('grade')}
                  value={g}
                  checked={value.grade === g}
                  onChange={() => set({ grade: g })}
                />
                <span>{g}</span>
              </label>
            ))}
          </div>
          {err('grade')}
        </fieldset>

        <fieldset className="ie-fieldset" aria-describedby={errors.cluster ? id('cluster-err') : undefined}>
          <legend className="fam-label">{m.card.cluster}</legend>
          <div className="ie-pills" data-invalid={errors.cluster ? 'true' : undefined}>
            {CLUSTERS.map((c) => (
              <label key={c} className="ie-pill">
                <input
                  type="radio"
                  name={id('cluster')}
                  value={c}
                  checked={value.cluster === c}
                  onChange={() => set({ cluster: c })}
                />
                <span>{m.cluster[c]}</span>
              </label>
            ))}
          </div>
          {err('cluster')}
        </fieldset>
      </div>

      <div className="ie-row2">
        <div className="fam-field">
          <label className="fam-label" htmlFor={id('topic')}>
            {m.card.topic}
          </label>
          <select
            id={id('topic')}
            className="fam-select"
            value={value.topicCode}
            disabled={topics.length === 0}
            aria-invalid={errors.topic ? 'true' : undefined}
            aria-describedby={errors.topic ? id('topic-err') : id('topic-hint')}
            onChange={(e) => set({ topicCode: e.target.value })}
          >
            <option value="">{m.card.topicPick}</option>
            {topics.map((t) => (
              <option key={t.code} value={t.code}>
                {topicName(t, locale)}
              </option>
            ))}
          </select>
          {errors.topic
            ? err('topic')
            : value.grade !== null &&
              value.cluster &&
              topics.length === 0 && (
                <p id={id('topic-hint')} className="fam-caption">
                  {m.card.topicNone}
                </p>
              )}
        </div>

        {value.grade !== null && needsSkill(value.grade) && (
          <div className="fam-field">
            <label className="fam-label" htmlFor={id('skill')}>
              {m.card.skill}
            </label>
            <select
              id={id('skill')}
              className="fam-select"
              value={value.skillCode}
              disabled={skills.length === 0}
              required
              aria-invalid={errors.skill ? 'true' : undefined}
              aria-describedby={errors.skill ? id('skill-err') : id('skill-hint')}
              onChange={(e) => set({ skillCode: e.target.value })}
            >
              <option value="">{m.card.skillPick}</option>
              {skills.map((s) => (
                <option key={s.code} value={s.code}>
                  {locale === 'ru' ? s.nameRu : s.nameUz}
                </option>
              ))}
            </select>
            {errors.skill ? (
              err('skill')
            ) : (
              <p id={id('skill-hint')} className="fam-caption">
                {value.topicCode && skills.length === 0 ? m.card.skillNone : m.card.skillHint}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="fam-field">
        <label className="fam-label" htmlFor={id('construct')}>
          {m.card.construct}
        </label>
        <input
          id={id('construct')}
          className="fam-input"
          value={value.construct}
          maxLength={300}
          placeholder={m.card.phConstruct}
          aria-invalid={errors.construct ? 'true' : undefined}
          aria-describedby={errors.construct ? id('construct-err') : undefined}
          onChange={(e) => set({ construct: e.target.value })}
        />
        {err('construct')}
      </div>
    </div>
  );
}
