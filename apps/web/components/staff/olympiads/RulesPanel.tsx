'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { olympiadApi } from '@/lib/olympiad-api';
import type { OlympiadDetail } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { invalidRules, RULE_KEYS, RuleInputs, ruleDraftOf, ruleValues, type RuleDraft, type RuleKey } from './RuleInputs';
import { formatNum, gradeName, gradesText } from './shared';
import { useOlympiadAction } from './useOlympiadAction';

const GRADES = [0, 1, 2, 3, 4] as const;

/**
 * The rules of one olympiad (task.md § 8.5): titles, grades, and the five
 * numbers results are computed with. The grade range locks once anyone has
 * registered — the API answers HAS_ENTRIES, so the inputs say it first.
 */
export function RulesPanel({ o, hasEntries, locale, m }: { o: OlympiadDetail; hasEntries: boolean; locale: Locale; m: OlympiadsMessages }) {
  const [editing, setEditing] = useState(false);
  const shown: { k: RuleKey; label: string; value: string }[] = [
    { k: 'certificateTopPct', label: m.rules.certLbl, value: `${o.certificateTopPct}%` },
    { k: 'qualifyTopPct', label: m.rules.qualifyLbl, value: `${o.qualifyTopPct}%` },
    { k: 'miniFinalTopN', label: m.rules.miniLbl, value: formatNum(o.miniFinalTopN) },
    { k: 'bonusRate', label: m.rules.bonusLbl, value: fill(m.rules.bonusFmt, { n: formatNum(o.bonusRate) }) },
    { k: 'cupTopN', label: m.rules.cupLbl, value: String(o.cupTopN) },
  ];

  return (
    <section className="fam-panel" aria-labelledby="oa-rules-title">
      <div className="fam-panel__head">
        <div>
          <h2 id="oa-rules-title" className="fam-panel__title">
            {m.rules.title}
          </h2>
          <p className="fam-panel__sub">{m.rules.sub}</p>
        </div>
        {!editing && (
          <button type="button" className="fam-btn fam-btn--sm" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
            {m.rules.edit}
          </button>
        )}
      </div>

      {editing ? (
        <RulesForm o={o} hasEntries={hasEntries} m={m} onDone={() => setEditing(false)} />
      ) : (
        <dl className="oa-facts">
          <div>
            <dt>{m.rules.gradesLbl}</dt>
            <dd>{gradesText(o.gradeMin, o.gradeMax, m)}</dd>
          </div>
          {shown.map((f) => (
            <div key={f.k}>
              <dt>{f.label}</dt>
              <dd className="mono">{f.value}</dd>
            </div>
          ))}
          <div className="oa-facts__wide">
            <dt>{m.rules.titlesLbl}</dt>
            <dd>
              {locale === 'ru' ? o.titleRu : o.titleUz}
              <span className="fam-small fam-muted"> · {locale === 'ru' ? o.titleUz : o.titleRu}</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function RulesForm({ o, hasEntries, m, onDone }: { o: OlympiadDetail; hasEntries: boolean; m: OlympiadsMessages; onDone: () => void }) {
  const act = useOlympiadAction(m);
  const id = useId();
  const [titleUz, setTitleUz] = useState(o.titleUz);
  const [titleRu, setTitleRu] = useState(o.titleRu);
  const [gradeMin, setGradeMin] = useState(o.gradeMin);
  const [gradeMax, setGradeMax] = useState(o.gradeMax);
  const [rules, setRules] = useState<RuleDraft>(ruleDraftOf(o));
  const [bad, setBad] = useState<RuleKey[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = invalidRules(rules);
    setBad(invalid);
    if (titleUz.trim().length < 2 || titleRu.trim().length < 2) return setErr(m.create.titleErr);
    if (gradeMax < gradeMin) return setErr(m.create.gradesErr);
    if (invalid.length > 0) return setErr(null);
    setErr(null);

    // Only what changed: sending the grades again would trip HAS_ENTRIES.
    const values = ruleValues(rules);
    const patch: Record<string, unknown> = {};
    if (titleUz.trim() !== o.titleUz) patch.titleUz = titleUz.trim();
    if (titleRu.trim() !== o.titleRu) patch.titleRu = titleRu.trim();
    if (gradeMin !== o.gradeMin) patch.gradeMin = gradeMin;
    if (gradeMax !== o.gradeMax) patch.gradeMax = gradeMax;
    for (const k of RULE_KEYS) if (values[k] !== o[k]) patch[k] = values[k];
    if (Object.keys(patch).length === 0) return onDone();

    const ok = await act.run(
      () => olympiadApi.update(o.id, patch),
      () => m.rules.saved,
    );
    if (ok) onDone();
  }

  const error = err ?? act.error;

  return (
    <form className="oa-form" onSubmit={submit} noValidate aria-label={m.rules.title}>
      <fieldset className="oa-fieldset" disabled={act.busy}>
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
              autoFocus
              onChange={(e) => setTitleUz(e.target.value)}
            />
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-ru`}>
              {m.create.titleRuLbl}
            </label>
            <input id={`${id}-ru`} className="fam-input" value={titleRu} maxLength={120} onChange={(e) => setTitleRu(e.target.value)} />
          </div>
        </div>
        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-gmin`}>
              {m.create.gradeMinLbl}
            </label>
            <select
              id={`${id}-gmin`}
              className="fam-select"
              value={gradeMin}
              disabled={hasEntries}
              aria-describedby={`${id}-gnote`}
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
              disabled={hasEntries}
              aria-describedby={`${id}-gnote`}
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
        <p id={`${id}-gnote`} className={hasEntries || gradeMin <= 2 ? 'fam-note fam-note--warn' : 'fam-note fam-note--teal'}>
          <Icon name={hasEntries ? 'lock' : 'info'} size={18} />
          <span>{hasEntries ? m.rules.gradesLocked : gradeMin <= 2 ? m.create.marathonNote : m.create.rankedNote}</span>
        </p>
        <RuleInputs idPrefix={`${id}-r`} draft={rules} invalid={bad} onChange={setRules} m={m} />
      </fieldset>

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      <div className="fam-actions">
        <button type="button" className="fam-btn" disabled={act.busy} onClick={onDone}>
          {m.rules.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {m.rules.save}
        </button>
      </div>
    </form>
  );
}
