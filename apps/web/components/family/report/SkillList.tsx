'use client';

import { useId, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/shell/Icon';

export type SkillStateKey = 'secure' | 'emerging' | 'not_yet' | 'none';

export interface SkillItem {
  code: string;
  name: string;
  cluster: string;
  state: SkillStateKey;
  stateLabel: string;
  /** Already worded on the server — the per-wave tallies never reach the browser. */
  evidence: string;
  trail: string[];
}

type Filter = 'all' | 'secure' | 'emerging' | 'not_yet';

/** design/04 "All skills this season": filter tabs and a click-to-expand "how we know". */
export function SkillList({
  items,
  tabs,
  copy,
}: {
  items: SkillItem[];
  tabs: { key: Filter; label: string }[];
  copy: { filterLabel: string; filterEmpty: string; shown: string };
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  const shown = items.filter((s) => filter === 'all' || s.state === filter);

  return (
    <div className="fam-stack" style={{ '--gap': '16px' } as CSSProperties}>
      <div className="rp-tabs" role="group" aria-label={copy.filterLabel}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={filter === t.key ? 'rp-tab rp-tab--on' : 'rp-tab'}
            aria-pressed={filter === t.key}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {copy.shown.replace('{n}', String(shown.length))}
      </p>

      {shown.length === 0 ? (
        <p className="fam-note">
          <Icon name="info" size={18} />
          {copy.filterEmpty}
        </p>
      ) : (
        <ul className="rp-skills">
          {shown.map((s) => {
            const isOpen = open === s.code;
            const panel = `${base}-${s.code}`;
            return (
              <li key={s.code} className="rp-skill">
                <button
                  type="button"
                  className="rp-skill__row"
                  aria-expanded={isOpen}
                  aria-controls={panel}
                  onClick={() => setOpen(isOpen ? null : s.code)}
                >
                  <span className="rp-skill__name">
                    <strong>{s.name}</strong>
                    <span className="fam-small fam-muted">{s.cluster}</span>
                  </span>
                  <span className={`rp-state rp-state--${s.state}`}>{s.stateLabel}</span>
                  <span className={isOpen ? 'rp-skill__chev rp-skill__chev--open' : 'rp-skill__chev'} aria-hidden="true">
                    <Icon name="chevronDown" size={18} />
                  </span>
                </button>
                <div id={panel} className="rp-skill__ev" hidden={!isOpen}>
                  <p>{s.evidence}</p>
                  {s.trail.length > 0 && (
                    <ul className="rp-trail">
                      {s.trail.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
