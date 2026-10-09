'use client';

import { Fragment, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { GroupOverview, Pupil } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { errorText } from './errors';
import { ProgressChip } from './ProgressChip';
import { PupilView } from './PupilView';

type Loaded = { state: 'loading' } | { state: 'ok'; pupil: Pupil } | { state: 'error'; text: string };

/**
 * "Progress since the last wave" (design/08). Rows stay in the API's order —
 * already sorted by gain, never re-sorted by level or name (task.md § 8.4.4).
 * Selecting a child opens the pupil panel in place, under the row.
 */
export function GroupProgress({
  locale,
  rows,
  waveOrdinal,
}: {
  locale: Locale;
  rows: GroupOverview['children'];
  waveOrdinal: number | null;
}) {
  const m = educatorMessages(locale);
  const g = m.group;
  const [open, setOpen] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Loaded>>({});

  async function load(id: string) {
    setCache((c) => ({ ...c, [id]: { state: 'loading' } }));
    try {
      const pupil = await educatorApi.pupil(id);
      setCache((c) => ({ ...c, [id]: { state: 'ok', pupil } }));
    } catch (err) {
      setCache((c) => ({ ...c, [id]: { state: 'error', text: errorText(err, m, { NOT_FOUND: m.pupil.notFoundTitle }) } }));
    }
  }

  function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (!cache[id] || cache[id].state === 'error') void load(id);
  }

  return (
    <table className="ed-table">
      <thead>
        <tr>
          <th scope="col">{g.colChild}</th>
          {waveOrdinal !== null && <th scope="col">{fill(g.colTook, { n: waveOrdinal })}</th>}
          <th scope="col" className="ed-table__end">
            {g.colProgress}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = open === r.id;
          const panelId = `ed-pupil-${r.id}`;
          const entry = cache[r.id];
          return (
            <Fragment key={r.id}>
              <tr className={isOpen ? 'ed-table__row ed-table__row--open' : 'ed-table__row'}>
                <th scope="row">
                  <button
                    type="button"
                    className="ed-nameBtn"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panelId : undefined}
                    onClick={() => toggle(r.id)}
                  >
                    <Icon name="chevronDown" size={16} />
                    {r.name}
                  </button>
                </th>
                {waveOrdinal !== null && (
                  <td>
                    <span className={r.tookSelectedWave ? 'ed-took ed-took--yes' : 'ed-took'}>
                      {r.tookSelectedWave && <Icon name="check" size={14} />}
                      {r.tookSelectedWave ? g.tookYes : g.tookNo}
                    </span>
                  </td>
                )}
                <td className="ed-table__end">
                  <ProgressChip value={r.progress} label={m.progress[r.progress]} />
                </td>
              </tr>
              {isOpen && (
                <tr className="ed-table__panelRow">
                  <td colSpan={waveOrdinal !== null ? 3 : 2} id={panelId}>
                    {!entry || entry.state === 'loading' ? (
                      <div className="ed-pupil ed-pupil--panel" aria-busy="true">
                        <span className="skel" style={{ width: '40%', height: 22 }} />
                        <span className="skel" style={{ width: '100%', height: 64 }} />
                        <span className="skel" style={{ width: '80%', height: 16 }} />
                      </div>
                    ) : entry.state === 'error' ? (
                      <div className="fam-stack" role="alert">
                        <p className="fam-alert">
                          {m.pupil.loadError} {entry.text}
                        </p>
                        <button type="button" className="fam-btn fam-btn--sm ed-selfStart" onClick={() => void load(r.id)}>
                          {m.common.retry}
                        </button>
                      </div>
                    ) : (
                      <PupilView pupil={entry.pupil} locale={locale} variant="panel" headingLevel={3} />
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
