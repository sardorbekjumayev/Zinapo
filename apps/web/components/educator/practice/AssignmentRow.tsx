'use client';

import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { AssignmentResults, AssignmentSummary } from '@/lib/educator-types';
import { fill } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';
import { ResultsList } from './ResultsList';

/** An earlier set: its summary, and each child's result read only when opened. */
export function AssignmentRow({
  a,
  label,
  dateLabel,
  m,
  retryLabel,
}: {
  a: AssignmentSummary;
  /** The set's title in the page's language (the API sends uz and ru). */
  label: string;
  dateLabel: string;
  m: PracticeMessages['list'];
  retryLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'error' } | { status: 'ready'; data: AssignmentResults }>({
    status: 'idle',
  });
  const panelId = `pr-row-${a.id}`;

  async function load() {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', data: await educatorApi.results(a.id) });
    } catch {
      setState({ status: 'error' });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state.status !== 'ready' && state.status !== 'loading') void load();
  }

  const s = a.summary;
  return (
    <li className="pr-row">
      <div className="pr-row__top">
        <div className="pr-row__body">
          <span className="pr-row__title">
            {label}
            {a.repeatOf && <span className="fam-tag fam-tag--teal">{m.repeatTag}</span>}
          </span>
          <span className="fam-small fam-muted">
            {[a.groupName, fill(m.rowMeta, { date: dateLabel, n: s.assigned })].filter(Boolean).join(' · ')}
          </span>
          <span className="fam-small">
            {fill(m.rowDone, { a: s.completed, b: s.assigned })}
            {s.typicalSolved !== null && <> · {fill(m.rowTyp, { x: s.typicalSolved, n: a.total })}</>}
          </span>
        </div>
        <button
          type="button"
          className="fam-btn fam-btn--sm fam-btn--quiet"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          {open ? m.hideChildren : m.showChildren}
          <span className={open ? 'pr-chev pr-chev--open' : 'pr-chev'} aria-hidden="true">
            <Icon name="chevronDown" size={16} />
          </span>
        </button>
      </div>
      <div id={panelId} hidden={!open} aria-live="polite">
        {state.status === 'loading' && (
          <p className="fam-inline fam-small fam-muted">
            <span className="spinner" aria-hidden="true" />
            {m.resultsLoading}
          </p>
        )}
        {state.status === 'error' && (
          <p className="fam-note fam-note--danger" role="alert">
            <Icon name="alert" size={18} />
            <span>
              {m.resultsError}{' '}
              <button type="button" className="pr-linkBtn" onClick={load}>
                {retryLabel}
              </button>
            </span>
          </p>
        )}
        {state.status === 'ready' && <ResultsList results={state.data} m={m} />}
      </div>
    </li>
  );
}
