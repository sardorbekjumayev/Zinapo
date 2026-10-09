'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { bankApi } from '@/lib/bank-api';
import type { Cluster, Topic } from '@/lib/bank-types';
import { fill } from '@/lib/i18n';
import { useBankAction } from './live';
import { FormFoot, PREFIX, SelectField, TOPIC_CODE, TextField, gradeOptions, type TaxCopy } from './tax-shared';

const CLUSTERS: Cluster[] = ['numeracy', 'reasoning', 'language'];

type Draft = { nameUz: string; nameRu: string; gradeMin: string; gradeMax: string; sort: string };

function TopicEdit({ topic, copy, onDone }: { topic: Topic; copy: TaxCopy; onDone: () => void }) {
  const { m } = copy;
  const t = m.tax;
  const { run, busy, errorFor, fail } = useBankAction(m);
  const [d, setD] = useState<Draft>({
    nameUz: topic.nameUz,
    nameRu: topic.nameRu,
    gradeMin: String(topic.gradeMin),
    gradeMax: String(topic.gradeMax),
    sort: String(topic.sort),
  });
  const id = `bk-te-${topic.code}`;
  const set = (k: keyof Draft) => (v: string) => setD((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.nameUz.trim() || !d.nameRu.trim() || !/^\d{1,4}$/.test(d.sort)) return fail('edit', t.required);
    if (Number(d.gradeMin) > Number(d.gradeMax)) return fail('edit', t.errors.grade_range);
    const ok = await run(
      'edit',
      () =>
        bankApi.patchTopic(topic.code, {
          nameUz: d.nameUz.trim(),
          nameRu: d.nameRu.trim(),
          gradeMin: Number(d.gradeMin),
          gradeMax: Number(d.gradeMax),
          sort: Number(d.sort),
        }),
      fill(t.updated, { code: topic.code }),
    );
    if (ok) onDone();
  }

  return (
    <form className="bk-taxForm" onSubmit={submit} noValidate aria-label={`${m.common.edit} ${topic.code}`}>
      <div className="fam-row">
        <TextField id={`${id}-uz`} label={t.nameUz} value={d.nameUz} onChange={set('nameUz')} maxLength={120} />
        <TextField id={`${id}-ru`} label={t.nameRu} value={d.nameRu} onChange={set('nameRu')} maxLength={120} />
      </div>
      <div className="fam-row" style={{ ['--cols' as string]: 3 }}>
        <SelectField id={`${id}-min`} label={t.gradeMin} value={d.gradeMin} onChange={set('gradeMin')} options={gradeOptions(0, 4)} />
        <SelectField id={`${id}-max`} label={t.gradeMax} value={d.gradeMax} onChange={set('gradeMax')} options={gradeOptions(0, 4)} />
        <TextField id={`${id}-sort`} label={t.sort} value={d.sort} onChange={set('sort')} maxLength={4} />
      </div>
      <FormFoot m={m} busy={busy !== null} error={errorFor('edit')} submitLabel={m.common.save} onCancel={onDone} />
    </form>
  );
}

function AddTopic({ copy }: { copy: TaxCopy }) {
  const { m } = copy;
  const t = m.tax;
  const { run, busy, errorFor, fail } = useBankAction(m);
  const empty = { cluster: 'numeracy' as Cluster, code: PREFIX.numeracy as string, nameUz: '', nameRu: '', gradeMin: '0', gradeMax: '4', sort: '100' };
  const [d, setD] = useState(empty);
  const codeBad = d.code.length > PREFIX[d.cluster].length && !TOPIC_CODE.test(d.code);

  function pickCluster(v: string) {
    const c = v as Cluster;
    // Keep what was typed after the prefix; only the prefix follows the cluster.
    setD((x) => ({ ...x, cluster: c, code: PREFIX[c] + x.code.replace(/^(num|rea|lan)\./, '') }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.nameUz.trim() || !d.nameRu.trim() || !/^\d{1,4}$/.test(d.sort)) return fail('add', t.required);
    if (!TOPIC_CODE.test(d.code)) return fail('add', t.codeInvalid);
    if (!d.code.startsWith(PREFIX[d.cluster])) return fail('add', t.errors.cluster_mismatch);
    if (Number(d.gradeMin) > Number(d.gradeMax)) return fail('add', t.errors.grade_range);
    const ok = await run(
      'add',
      () =>
        bankApi.createTopic({
          code: d.code,
          cluster: d.cluster,
          nameUz: d.nameUz.trim(),
          nameRu: d.nameRu.trim(),
          gradeMin: Number(d.gradeMin),
          gradeMax: Number(d.gradeMax),
          sort: Number(d.sort),
        }),
      fill(t.created, { code: d.code }),
    );
    if (ok) setD({ ...empty, cluster: d.cluster, code: PREFIX[d.cluster] });
  }

  return (
    <form className="fam-panel bk-taxAdd" onSubmit={submit} noValidate aria-labelledby="bk-addtopic-h">
      <div>
        <h2 id="bk-addtopic-h" className="fam-panel__title">
          {t.addTopic}
        </h2>
        <p className="fam-panel__sub">{t.addTopicSub}</p>
      </div>
      <div className="fam-row">
        <SelectField
          id="bk-at-cluster"
          label={m.filters.cluster}
          value={d.cluster}
          onChange={pickCluster}
          options={CLUSTERS.map((c) => ({ value: c, label: m.cluster[c] }))}
        />
        <TextField
          id="bk-at-code"
          label={t.code}
          value={d.code}
          onChange={(v) => setD((x) => ({ ...x, code: v.trim().toLowerCase() }))}
          hint={fill(t.topicCodeHint, { p: PREFIX[d.cluster] })}
          mono
          invalid={codeBad}
          maxLength={40}
        />
      </div>
      <div className="fam-row">
        <TextField id="bk-at-uz" label={t.nameUz} value={d.nameUz} onChange={(v) => setD((x) => ({ ...x, nameUz: v }))} maxLength={120} />
        <TextField id="bk-at-ru" label={t.nameRu} value={d.nameRu} onChange={(v) => setD((x) => ({ ...x, nameRu: v }))} maxLength={120} />
      </div>
      <div className="fam-row" style={{ ['--cols' as string]: 3 }}>
        <SelectField id="bk-at-min" label={t.gradeMin} value={d.gradeMin} onChange={(v) => setD((x) => ({ ...x, gradeMin: v }))} options={gradeOptions(0, 4)} />
        <SelectField id="bk-at-max" label={t.gradeMax} value={d.gradeMax} onChange={(v) => setD((x) => ({ ...x, gradeMax: v }))} options={gradeOptions(0, 4)} />
        <TextField id="bk-at-sort" label={t.sort} value={d.sort} onChange={(v) => setD((x) => ({ ...x, sort: v }))} maxLength={4} />
      </div>
      <FormFoot m={m} busy={busy !== null} error={errorFor('add')} submitLabel={t.add} />
    </form>
  );
}

/** Topics, grouped by the three clusters (task.md § 12 M3 "topics (3 clusters)"). */
export function TopicsPanel({ topics, copy }: { topics: Topic[]; copy: TaxCopy }) {
  const { m, canManage } = copy;
  const t = m.tax;
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="fam-stack" style={{ ['--gap' as string]: '24px' }}>
      {CLUSTERS.map((c) => {
        const list = topics.filter((x) => x.cluster === c);
        return (
          <section key={c} className="fam-panel" aria-labelledby={`bk-cl-${c}`}>
            <div className="bk-taxHead">
              <h2 id={`bk-cl-${c}`} className="fam-panel__title">
                {m.cluster[c]}
              </h2>
              <span className="chip chip--code">{PREFIX[c]}</span>
            </div>
            {list.length === 0 ? (
              <p className="bk-muted">{t.topicsEmpty}</p>
            ) : (
              <ul className="bk-taxList">
                {list.map((topic) => (
                  <li key={topic.code} className="bk-taxRow">
                    {editing === topic.code ? (
                      <TopicEdit topic={topic} copy={copy} onDone={() => setEditing(null)} />
                    ) : (
                      <>
                        <span className="bk-taxRow__code mono">{topic.code}</span>
                        <span className="bk-taxRow__names">
                          <span lang="uz">{topic.nameUz}</span>
                          <span lang="ru" className="bk-muted">
                            {topic.nameRu}
                          </span>
                        </span>
                        <span className="bk-taxRow__meta">
                          <span className="fam-tag fam-tag--brand">
                            {fill(t.gradeRange, { a: topic.gradeMin, b: topic.gradeMax })}
                          </span>
                          <span className="bk-muted">{fill(t.itemsN, { n: topic.itemCount })}</span>
                          <span className="bk-muted" title={t.sort}>
                            #{topic.sort}
                          </span>
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            className="fam-btn fam-btn--quiet fam-btn--sm"
                            onClick={() => setEditing(topic.code)}
                            aria-label={`${m.common.edit} ${topic.code}`}
                          >
                            <Icon name="edit" size={16} />
                            {m.common.edit}
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {canManage && <AddTopic copy={copy} />}
    </div>
  );
}
