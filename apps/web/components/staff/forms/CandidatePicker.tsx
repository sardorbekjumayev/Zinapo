'use client';

import { useEffect, useId, useState } from 'react';
import { bankApi } from '@/lib/bank-api';
import type { Candidate, Cluster, FormMode } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';
import { band, formatB, formErrorText } from './shared';

const CLUSTERS: Cluster[] = ['numeracy', 'reasoning', 'language'];

/**
 * design/14 "Replace": the versions the API's candidate query offers for one
 * position. The list is whatever the query returns — this component adds no
 * eligibility rules of its own (INV-08 lives in the query, task.md § 1.8).
 */
export function CandidatePicker({
  formId,
  position,
  mode,
  initialCluster,
  m,
  locale,
  busy,
  onUse,
}: {
  formId: string;
  position: number;
  mode: FormMode;
  initialCluster: Cluster | '';
  m: FormsMessages;
  locale: Locale;
  busy: boolean;
  onUse: (c: Candidate) => void;
}) {
  const [cluster, setCluster] = useState<Cluster | ''>(initialCluster);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ids = { cluster: useId(), q: useId(), title: useId() };

  // Typing narrows the list after a short pause, not on every key.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    bankApi
      .candidates(formId, position, { cluster: cluster || undefined, q: query || undefined })
      .then((rows) => live && setList(rows))
      .catch((err) => live && setError(formErrorText(err, m)));
    return () => {
      live = false;
    };
  }, [formId, position, cluster, query, attempt, m]);

  return (
    <section className="fb-cand" aria-labelledby={ids.title}>
      <h4 id={ids.title} className="fb-cand__title">
        {m.cand.title}
      </h4>
      <p className="fam-small fam-muted">{mode === 'practice' ? m.cand.hintPractice : m.cand.hint}</p>
      <div className="fb-cand__filters">
        <div className="fam-field">
          <label className="fam-label" htmlFor={ids.cluster}>
            {m.cand.clusterLbl}
          </label>
          <select
            id={ids.cluster}
            className="fam-select"
            value={cluster}
            onChange={(e) => setCluster(e.target.value as Cluster | '')}
          >
            <option value="">{m.cand.allClusters}</option>
            {CLUSTERS.map((c) => (
              <option key={c} value={c}>
                {m.cluster[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="fam-field">
          <label className="fam-label" htmlFor={ids.q}>
            {m.cand.searchLbl}
          </label>
          <input
            id={ids.q}
            type="search"
            className="fam-input fam-input--mono"
            value={q}
            placeholder={m.cand.searchPh}
            maxLength={40}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div aria-live="polite" aria-busy={list === null && !error}>
        {error ? (
          <div className="fam-stack">
            <p className="fam-alert" role="alert">
              {error}
            </p>
            <button type="button" className="fam-btn fam-btn--sm" onClick={() => setAttempt((n) => n + 1)}>
              {m.cand.retry}
            </button>
          </div>
        ) : list === null ? (
          <div className="fam-stack">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ height: 64, borderRadius: 16 }} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="fam-note">{m.cand.empty}</p>
        ) : (
          <ul className="fb-cand__list" aria-label={m.cand.listLabel}>
            {list.map((c) => {
              const d = band(c);
              return (
                <li key={c.itemVersionId} className="fb-cand__row">
                  <div className="fam-stack" style={{ '--gap': '2px', flex: 1, minWidth: 0 } as React.CSSProperties}>
                    <span className="mono fb-cand__code">{c.code}</span>
                    <span className="fam-small fam-muted">
                      {m.cluster[c.cluster]} ·{' '}
                      {c.difficultyB !== null
                        ? fill(m.cand.bFmt, { b: formatB(c.difficultyB, locale), d: d ? m.slot[d] : '' })
                        : c.expectedP !== null
                          ? fill(m.cand.pFmt, { p: Math.round(c.expectedP * 100) })
                          : m.slot.noDifficulty}
                    </span>
                    <span className="fam-small fb-cand__stem" lang="uz">
                      {c.stemUz}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm"
                    disabled={busy}
                    aria-label={fill(m.cand.useFmt, { code: c.code, n: position })}
                    onClick={() => onUse(c)}
                  >
                    {m.cand.use}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
