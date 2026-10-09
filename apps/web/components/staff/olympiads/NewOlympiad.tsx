'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { olympiadApi } from '@/lib/olympiad-api';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { DEFAULT_RULES, invalidRules, RuleInputs, ruleValues, type RuleDraft, type RuleKey } from './RuleInputs';
import { gradeName, titleOf } from './shared';
import { useOlympiadAction } from './useOlympiadAction';

const GRADES = [0, 1, 2, 3, 4] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{2,48}$/;

type Errs = Partial<Record<'slug' | 'titles' | 'grades', string>>;

/**
 * "New olympiad" (task.md § 8.5). Ranking is not a choice: the API derives it
 * from the lowest grade, so the form only explains what the range implies.
 * On success the operator lands on the new olympiad to set its stages.
 */
export function NewOlympiad({ locale, m }: { locale: Locale; m: OlympiadsMessages }) {
  const router = useRouter();
  const act = useOlympiadAction(m);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [titleUz, setTitleUz] = useState('');
  const [titleRu, setTitleRu] = useState('');
  const [gradeMin, setGradeMin] = useState(3);
  const [gradeMax, setGradeMax] = useState(4);
  const [rules, setRules] = useState<RuleDraft>(DEFAULT_RULES);
  const [errs, setErrs] = useState<Errs>({});
  const [badRules, setBadRules] = useState<RuleKey[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Errs = {};
    if (!SLUG.test(slug.trim())) found.slug = m.create.slugErr;
    if (titleUz.trim().length < 2 || titleRu.trim().length < 2) found.titles = m.create.titleErr;
    if (gradeMax < gradeMin) found.grades = m.create.gradesErr;
    const bad = invalidRules(rules);
    setErrs(found);
    setBadRules(bad);
    if (Object.keys(found).length > 0 || bad.length > 0) return;

    const created = await act.run(
      () =>
        olympiadApi.create({
          slug: slug.trim(),
          titleUz: titleUz.trim(),
          titleRu: titleRu.trim(),
          gradeMin,
          gradeMax,
          ...ruleValues(rules),
        }),
      (o) => fill(m.create.created, { title: titleOf(o, locale) }),
    );
    if (created) router.push(`/${locale}/staff/olympiads/${created.id}`);
  }

  if (!open) {
    return (
      <button type="button" className="fam-btn fam-btn--primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} />
        {m.create.open}
      </button>
    );
  }

  const young = gradeMin <= 2;

  return (
    <form className="oa-form" onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="oa-form__title">
        {m.create.title}
      </h3>
      <fieldset className="oa-fieldset" disabled={act.busy}>
        <div className="fam-field" style={{ maxWidth: 420 }}>
          <label className="fam-label" htmlFor={`${id}-slug`}>
            {m.create.slugLbl}
          </label>
          <input
            id={`${id}-slug`}
            className="fam-input mono"
            value={slug}
            maxLength={49}
            autoFocus
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={!!errs.slug || undefined}
            aria-describedby={`${id}-slug-h`}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          <span id={`${id}-slug-h`} className={errs.slug ? 'fam-caption fam-caption--bad' : 'fam-caption'}>
            {errs.slug ?? fill(m.create.slugHint, { slug: slug.trim() || '…' })}
          </span>
        </div>

        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-uz`}>
              {m.create.titleUzLbl}
            </label>
            <input
              id={`${id}-uz`}
              className="fam-input"
              value={titleUz}
              maxLength={120}
              aria-invalid={(!!errs.titles && titleUz.trim().length < 2) || undefined}
              aria-describedby={errs.titles ? `${id}-titles-e` : undefined}
              onChange={(e) => setTitleUz(e.target.value)}
            />
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-ru`}>
              {m.create.titleRuLbl}
            </label>
            <input
              id={`${id}-ru`}
              className="fam-input"
              value={titleRu}
              maxLength={120}
              aria-invalid={(!!errs.titles && titleRu.trim().length < 2) || undefined}
              aria-describedby={errs.titles ? `${id}-titles-e` : undefined}
              onChange={(e) => setTitleRu(e.target.value)}
            />
          </div>
        </div>
        {errs.titles && (
          <span id={`${id}-titles-e`} className="fam-caption fam-caption--bad">
            {errs.titles}
          </span>
        )}

        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-gmin`}>
              {m.create.gradeMinLbl}
            </label>
            <select
              id={`${id}-gmin`}
              className="fam-select"
              value={gradeMin}
              aria-describedby={`${id}-rank`}
              onChange={(e) => setGradeMin(Number(e.target.value))}
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {gradeName(g, m)}
                </option>
              ))}
            </select>
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-gmax`}>
              {m.create.gradeMaxLbl}
            </label>
            <select
              id={`${id}-gmax`}
              className="fam-select"
              value={gradeMax}
              aria-invalid={!!errs.grades || undefined}
              aria-describedby={`${id}-rank`}
              onChange={(e) => setGradeMax(Number(e.target.value))}
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {gradeName(g, m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {errs.grades && <span className="fam-caption fam-caption--bad">{errs.grades}</span>}
        <p id={`${id}-rank`} className={young ? 'fam-note fam-note--warn' : 'fam-note fam-note--teal'} aria-live="polite">
          <Icon name={young ? 'info' : 'trophy'} size={18} />
          <span>{young ? m.create.marathonNote : m.create.rankedNote}</span>
        </p>

        <h4 className="oa-form__sub">{m.create.rulesTitle}</h4>
        <RuleInputs idPrefix={`${id}-r`} draft={rules} invalid={badRules} onChange={setRules} m={m} />
      </fieldset>

      {act.error && (
        <p className="fam-alert" role="alert">
          {act.error}
        </p>
      )}

      <div className="fam-actions">
        <button type="button" className="fam-btn" disabled={act.busy} onClick={() => setOpen(false)}>
          {m.create.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {m.create.create}
        </button>
      </div>
    </form>
  );
}
