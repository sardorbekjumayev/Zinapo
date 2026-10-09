'use client';

import { useId, useState } from 'react';
import { fill } from '@/lib/i18n';
import { trustApi } from '@/lib/trust-api';
import type { CaseDetail, CaseStaff } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { useCaseAction } from './useCaseAction';

/** Who is on the case: pick a colleague, take it yourself, or let it go. */
export function AssignPanel({
  c,
  staff,
  meId,
  m,
}: {
  c: CaseDetail;
  staff: CaseStaff[];
  meId: string;
  m: TrustMessages;
}) {
  const a = m.assign;
  const selectId = useId();
  const { busy, error, run } = useCaseAction(m);
  const [pick, setPick] = useState(c.assignee?.personId ?? '');
  const closed = c.status === 'resolved' || c.status === 'dismissed';

  const assign = (personId: string | null) => {
    const name = personId ? staff.find((s) => s.personId === personId)?.name ?? '' : '';
    const done = personId ? fill(a.assigned, { ref: c.reference, name }) : fill(a.unassigned, { ref: c.reference });
    void run(personId ? `assign-${personId}` : 'unassign', () => trustApi.assign(c.id, personId), done);
  };

  return (
    <section className="fam-panel" aria-labelledby="ts-assign-title">
      <div>
        <h2 id="ts-assign-title" className="fam-panel__title">
          {a.title}
        </h2>
        <p className="fam-panel__sub">
          {c.assignee ? `${c.assignee.name}${c.assignee.me ? ` (${m.list.you})` : ''}` : a.nobody}
        </p>
      </div>
      {!closed && (
        <>
          <div className="fam-field">
            <label htmlFor={selectId} className="fam-label">
              {a.select}
            </label>
            <select id={selectId} className="fam-select" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{a.choose}</option>
              {staff.map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ts-actions">
            <button
              type="button"
              className="fam-btn fam-btn--sm"
              disabled={busy !== null || !pick || pick === c.assignee?.personId}
              aria-busy={busy === `assign-${pick}`}
              onClick={() => assign(pick)}
            >
              {a.assign}
            </button>
            {!c.assignee?.me && (
              <button type="button" className="fam-btn fam-btn--sm" disabled={busy !== null} onClick={() => assign(meId)}>
                {a.me}
              </button>
            )}
            {c.assignee && (
              <button type="button" className="fam-btn fam-btn--sm fam-btn--quiet" disabled={busy !== null} onClick={() => assign(null)}>
                {a.unassign}
              </button>
            )}
          </div>
          {error && (
            <p className="fam-alert" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
