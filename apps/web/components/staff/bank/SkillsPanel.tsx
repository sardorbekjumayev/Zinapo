'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { bankApi } from '@/lib/bank-api';
import type { Skill, Topic } from '@/lib/bank-types';
import { fill } from '@/lib/i18n';
import { useBankAction } from './live';
import { FormFoot, SKILL_CODE, SelectField, TextField, gradeOptions, topicName, type TaxCopy } from './tax-shared';

/** Skills are the grade 0–2 instrument (task.md § 1.9, INV-11). */
const SKILL_GRADES = [0, 1, 2];

function SkillEdit({ skill, copy, onDone }: { skill: Skill; copy: TaxCopy; onDone: () => void }) {
  const { m } = copy;
  const t = m.tax;
  const { run, busy, errorFor, fail } = useBankAction(m);
  const [nameUz, setUz] = useState(skill.nameUz);
  const [nameRu, setRu] = useState(skill.nameRu);
  const id = `bk-se-${skill.code}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameUz.trim() || !nameRu.trim()) return fail('edit', t.required);
    const ok = await run(
      'edit',
      () => bankApi.patchSkill(skill.code, { nameUz: nameUz.trim(), nameRu: nameRu.trim() }),
      fill(t.updated, { code: skill.code }),
    );
    if (ok) onDone();
  }

  return (
    <form className="bk-taxForm" onSubmit={submit} noValidate aria-label={`${m.common.edit} ${skill.code}`}>
      <div className="fam-row">
        <TextField id={`${id}-uz`} label={t.nameUz} value={nameUz} onChange={setUz} maxLength={120} />
        <TextField id={`${id}-ru`} label={t.nameRu} value={nameRu} onChange={setRu} maxLength={120} />
      </div>
      <FormFoot m={m} busy={busy !== null} error={errorFor('edit')} submitLabel={m.common.save} onCancel={onDone} />
    </form>
  );
}

function AddSkill({ topics, copy }: { topics: Topic[]; copy: TaxCopy }) {
  const { m, locale } = copy;
  const t = m.tax;
  const { run, busy, errorFor, fail } = useBankAction(m);
  const empty = { code: 's.', topicCode: '', grade: '0', nameUz: '', nameRu: '' };
  const [d, setD] = useState(empty);
  const topic = topics.find((x) => x.code === d.topicCode);
  // The grade must lie in the topic's range as well as in 0–2.
  const grades = SKILL_GRADES.filter((g) => !topic || (g >= topic.gradeMin && g <= topic.gradeMax));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.topicCode || !d.nameUz.trim() || !d.nameRu.trim()) return fail('add', t.required);
    if (!SKILL_CODE.test(d.code)) return fail('add', t.codeInvalid);
    const ok = await run(
      'add',
      () =>
        bankApi.createSkill({
          code: d.code,
          topicCode: d.topicCode,
          grade: Number(d.grade),
          nameUz: d.nameUz.trim(),
          nameRu: d.nameRu.trim(),
        }),
      fill(t.created, { code: d.code }),
    );
    if (ok) setD({ ...empty, topicCode: d.topicCode, grade: d.grade });
  }

  return (
    <form className="fam-panel bk-taxAdd" onSubmit={submit} noValidate aria-labelledby="bk-addskill-h">
      <h2 id="bk-addskill-h" className="fam-panel__title">
        {t.addSkill}
      </h2>
      <div className="fam-row" style={{ ['--cols' as string]: 3 }}>
        <TextField
          id="bk-as-code"
          label={t.code}
          value={d.code}
          onChange={(v) => setD((x) => ({ ...x, code: v.trim().toLowerCase() }))}
          hint={t.skillCodeHint}
          mono
          invalid={d.code.length > 2 && !SKILL_CODE.test(d.code)}
          maxLength={64}
        />
        <SelectField
          id="bk-as-topic"
          label={t.topic}
          value={d.topicCode}
          placeholder={t.pickTopic}
          onChange={(v) => {
            const next = topics.find((x) => x.code === v);
            setD((x) => ({ ...x, topicCode: v, grade: String(Math.max(Number(x.grade), next?.gradeMin ?? 0)) }));
          }}
          options={topics.map((x) => ({ value: x.code, label: `${x.code} — ${topicName(x, locale)}` }))}
        />
        <SelectField
          id="bk-as-grade"
          label={t.grade}
          value={d.grade}
          onChange={(v) => setD((x) => ({ ...x, grade: v }))}
          options={grades.map((g) => ({ value: String(g), label: String(g) }))}
        />
      </div>
      <div className="fam-row">
        <TextField id="bk-as-uz" label={t.nameUz} value={d.nameUz} onChange={(v) => setD((x) => ({ ...x, nameUz: v }))} maxLength={120} />
        <TextField id="bk-as-ru" label={t.nameRu} value={d.nameRu} onChange={(v) => setD((x) => ({ ...x, nameRu: v }))} maxLength={120} />
      </div>
      <FormFoot m={m} busy={busy !== null} error={errorFor('add')} submitLabel={t.add} />
    </form>
  );
}

export function SkillsPanel({ skills, topics, copy }: { skills: Skill[]; topics: Topic[]; copy: TaxCopy }) {
  const { m, locale, canManage } = copy;
  const t = m.tax;
  const [editing, setEditing] = useState<string | null>(null);
  const byCode = new Map(topics.map((x) => [x.code, x]));
  // Only topics that reach into grades 0–2 can carry a skill.
  const young = topics.filter((x) => x.gradeMin <= 2);

  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }}>
      <section className="fam-panel" aria-labelledby="bk-skills-h">
        <div>
          <h2 id="bk-skills-h" className="fam-panel__title">
            {t.tabSkills}
          </h2>
          <p className="fam-panel__sub">{t.skillsNote}</p>
        </div>
        {skills.length === 0 ? (
          <p className="bk-muted">{t.skillsEmpty}</p>
        ) : (
          <ul className="bk-taxList">
            {skills.map((skill) => {
              const topic = byCode.get(skill.topicCode);
              return (
                <li key={skill.code} className="bk-taxRow">
                  {editing === skill.code ? (
                    <SkillEdit skill={skill} copy={copy} onDone={() => setEditing(null)} />
                  ) : (
                    <>
                      <span className="bk-taxRow__code mono">{skill.code}</span>
                      <span className="bk-taxRow__names">
                        <span lang="uz">{skill.nameUz}</span>
                        <span lang="ru" className="bk-muted">
                          {skill.nameRu}
                        </span>
                      </span>
                      <span className="bk-taxRow__meta">
                        <span className="fam-tag fam-tag--brand">{fill(m.common.gradeN, { g: skill.grade })}</span>
                        <span className="bk-muted" title={topic ? topicName(topic, locale) : undefined}>
                          <span className="mono">{skill.topicCode}</span>
                        </span>
                        <span className="bk-muted">{fill(t.itemsN, { n: skill.itemCount })}</span>
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          className="fam-btn fam-btn--quiet fam-btn--sm"
                          onClick={() => setEditing(skill.code)}
                          aria-label={`${m.common.edit} ${skill.code}`}
                        >
                          <Icon name="edit" size={16} />
                          {m.common.edit}
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {canManage && <AddSkill topics={young} copy={copy} />}
    </div>
  );
}
