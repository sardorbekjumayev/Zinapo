'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { bankApi } from '@/lib/bank-api';
import type { Misconception, Topic } from '@/lib/bank-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { useBankAction } from './live';
import { FormFoot, MISCONCEPTION_CODE, SelectField, TextField, topicName, type TaxCopy } from './tax-shared';

type Texts = { nameUz: string; nameRu: string; explainUz: string; explainRu: string };

function TextsFields({ id, d, set, copy }: { id: string; d: Texts; set: (k: keyof Texts) => (v: string) => void; copy: TaxCopy }) {
  const t = copy.m.tax;
  return (
    <>
      <div className="fam-row">
        <TextField id={`${id}-uz`} label={t.nameUz} value={d.nameUz} onChange={set('nameUz')} maxLength={120} />
        <TextField id={`${id}-ru`} label={t.nameRu} value={d.nameRu} onChange={set('nameRu')} maxLength={120} />
      </div>
      <div className="fam-row">
        <TextField id={`${id}-xuz`} label={t.explainUz} value={d.explainUz} onChange={set('explainUz')} maxLength={600} multiline />
        <TextField id={`${id}-xru`} label={t.explainRu} value={d.explainRu} onChange={set('explainRu')} maxLength={600} multiline />
      </div>
    </>
  );
}

const filled = (d: Texts) => !!(d.nameUz.trim() && d.nameRu.trim() && d.explainUz.trim() && d.explainRu.trim());
const trimmed = (d: Texts): Texts => ({
  nameUz: d.nameUz.trim(),
  nameRu: d.nameRu.trim(),
  explainUz: d.explainUz.trim(),
  explainRu: d.explainRu.trim(),
});

function MisEdit({ mis, copy, onDone }: { mis: Misconception; copy: TaxCopy; onDone: () => void }) {
  const { m } = copy;
  const { run, busy, errorFor, fail } = useBankAction(m);
  const [d, setD] = useState<Texts>({
    nameUz: mis.nameUz,
    nameRu: mis.nameRu,
    explainUz: mis.explainUz,
    explainRu: mis.explainRu,
  });
  const set = (k: keyof Texts) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!filled(d)) return fail('edit', m.tax.required);
    const ok = await run(
      'edit',
      () => bankApi.patchMisconception(mis.code, { ...trimmed(d) }),
      fill(m.tax.updated, { code: mis.code }),
    );
    if (ok) onDone();
  }

  return (
    <form className="bk-taxForm" onSubmit={submit} noValidate aria-label={`${m.common.edit} ${mis.code}`}>
      <TextsFields id={`bk-me-${mis.code}`} d={d} set={set} copy={copy} />
      <FormFoot m={m} busy={busy !== null} error={errorFor('edit')} submitLabel={m.common.save} onCancel={onDone} />
    </form>
  );
}

function AddMis({ topics, copy }: { topics: Topic[]; copy: TaxCopy }) {
  const { m, locale } = copy;
  const t = m.tax;
  const { run, busy, errorFor, fail } = useBankAction(m);
  const empty = { code: 'm.', topicCode: '', nameUz: '', nameRu: '', explainUz: '', explainRu: '' };
  const [d, setD] = useState(empty);
  const set = (k: keyof Texts) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.topicCode || !filled(d)) return fail('add', t.required);
    if (!MISCONCEPTION_CODE.test(d.code)) return fail('add', t.codeInvalid);
    const ok = await run(
      'add',
      () => bankApi.createMisconception({ code: d.code, topicCode: d.topicCode, ...trimmed(d) }),
      fill(t.created, { code: d.code }),
    );
    if (ok) setD({ ...empty, topicCode: d.topicCode });
  }

  return (
    <form className="fam-panel bk-taxAdd" onSubmit={submit} noValidate aria-labelledby="bk-addmis-h">
      <h2 id="bk-addmis-h" className="fam-panel__title">
        {t.addMis}
      </h2>
      <div className="fam-row">
        <TextField
          id="bk-am-code"
          label={t.code}
          value={d.code}
          onChange={(v) => setD((x) => ({ ...x, code: v.trim().toLowerCase() }))}
          hint={t.misCodeHint}
          mono
          invalid={d.code.length > 2 && !MISCONCEPTION_CODE.test(d.code)}
          maxLength={64}
        />
        <SelectField
          id="bk-am-topic"
          label={t.topic}
          value={d.topicCode}
          placeholder={t.pickTopic}
          onChange={(v) => setD((x) => ({ ...x, topicCode: v }))}
          options={topics.map((x) => ({ value: x.code, label: `${x.code} — ${topicName(x, locale)}` }))}
        />
      </div>
      <TextsFields id="bk-am" d={d} set={set} copy={copy} />
      <FormFoot m={m} busy={busy !== null} error={errorFor('add')} submitLabel={t.add} />
    </form>
  );
}

/**
 * Misconceptions: the codes every distractor carries (task.md § 1 rule 7).
 * Nothing is deleted — one in use is retired, and can be restored.
 */
export function MisconceptionsPanel({
  misconceptions,
  topics,
  copy,
}: {
  misconceptions: Misconception[];
  topics: Topic[];
  copy: TaxCopy;
}) {
  const { m, locale, canManage } = copy;
  const t = m.tax;
  const { run, busy, errorFor } = useBankAction(m);
  const [editing, setEditing] = useState<string | null>(null);
  const ru = locale === 'ru';

  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }}>
      <section className="fam-panel" aria-labelledby="bk-mis-h">
        <div>
          <h2 id="bk-mis-h" className="fam-panel__title">
            {t.tabMis}
          </h2>
          <p className="fam-panel__sub">{t.misNote}</p>
        </div>
        {misconceptions.length === 0 ? (
          <p className="bk-muted">{t.misEmpty}</p>
        ) : (
          <ul className="bk-taxList">
            {misconceptions.map((mis) => {
              const retired = mis.retiredAt !== null;
              const key = `retire:${mis.code}`;
              return (
                <li key={mis.code} className="bk-taxRow bk-taxRow--mis" data-retired={retired || undefined}>
                  {editing === mis.code ? (
                    <MisEdit mis={mis} copy={copy} onDone={() => setEditing(null)} />
                  ) : (
                    <>
                      <span className="bk-taxRow__code mono">{mis.code}</span>
                      <span className="bk-taxRow__names">
                        <span lang="uz">{mis.nameUz}</span>
                        <span lang="ru" className="bk-muted">
                          {mis.nameRu}
                        </span>
                        <span className="bk-explain">
                          <span className="visually-hidden">{t.explain}: </span>
                          {ru ? mis.explainRu : mis.explainUz}
                        </span>
                      </span>
                      <span className="bk-taxRow__meta">
                        <span className="mono bk-muted">{mis.topicCode}</span>
                        <span className="bk-muted">{fill(t.optionsN, { n: mis.optionCount })}</span>
                        {retired && (
                          <span className="chip bk-chip--muted" title={formatDate(mis.retiredAt, locale)}>
                            {t.retired}
                          </span>
                        )}
                      </span>
                      {canManage && (
                        <span className="bk-taxRow__actions">
                          {!retired && (
                            <button
                              type="button"
                              className="fam-btn fam-btn--quiet fam-btn--sm"
                              onClick={() => setEditing(mis.code)}
                              aria-label={`${m.common.edit} ${mis.code}`}
                            >
                              <Icon name="edit" size={16} />
                              {m.common.edit}
                            </button>
                          )}
                          <button
                            type="button"
                            className="fam-btn fam-btn--sm"
                            onClick={() =>
                              run(
                                key,
                                () => bankApi.setMisconceptionRetired(mis.code, !retired),
                                fill(retired ? t.restoredDone : t.retiredDone, { code: mis.code }),
                              )
                            }
                            disabled={busy !== null}
                            aria-busy={busy === key}
                            aria-label={`${retired ? t.restore : t.retire} ${mis.code}`}
                          >
                            {busy === key && <span className="spinner" aria-hidden="true" />}
                            {retired ? t.restore : t.retire}
                          </button>
                        </span>
                      )}
                      {errorFor(key) && (
                        <p className="fam-caption fam-caption--bad bk-taxRow__err" role="alert">
                          {errorFor(key)}
                        </p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {canManage && <AddMis topics={topics} copy={copy} />}
    </div>
  );
}
