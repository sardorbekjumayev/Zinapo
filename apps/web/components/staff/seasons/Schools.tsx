'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import { sessionApi } from '@/lib/session-api';
import type { StaffSchool } from '@/lib/session-types';
import type { SeasonsMessages } from '@/messages/seasons';
import { SCHOOL_KINDS } from './shared';
import { useSeasonAction } from './useSeasonAction';

type Kind = (typeof SCHOOL_KINDS)[number];

interface Draft {
  name: string;
  district: string;
  kind: Kind;
}

/**
 * Name, district and kind of one school. The region is not a field: a
 * school's region never changes (enrolments and cohorts were counted by it).
 */
function SchoolFields({
  d,
  setD,
  nameErr,
  m,
  autoFocus,
}: {
  d: Draft;
  setD: (d: Draft) => void;
  nameErr: boolean;
  m: SeasonsMessages;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="ss-schoolFields">
      <div className="fam-field">
        <label className="fam-label" htmlFor={`${id}-n`}>
          {m.schools.nameLbl}
        </label>
        <input
          id={`${id}-n`}
          className="fam-input"
          value={d.name}
          maxLength={200}
          placeholder={m.schools.namePh}
          autoFocus={autoFocus}
          aria-invalid={nameErr || undefined}
          aria-describedby={nameErr ? `${id}-ne` : undefined}
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
        {nameErr && (
          <span id={`${id}-ne`} className="fam-caption fam-caption--bad">
            {m.schools.nameErr}
          </span>
        )}
      </div>
      <div className="fam-field">
        <label className="fam-label" htmlFor={`${id}-d`}>
          {m.schools.districtLbl}
        </label>
        <input
          id={`${id}-d`}
          className="fam-input"
          value={d.district}
          maxLength={120}
          placeholder={m.schools.districtPh}
          onChange={(e) => setD({ ...d, district: e.target.value })}
        />
      </div>
      <div className="fam-field">
        <label className="fam-label" htmlFor={`${id}-k`}>
          {m.schools.kindLbl}
        </label>
        <select
          id={`${id}-k`}
          className="fam-select"
          value={d.kind}
          onChange={(e) => setD({ ...d, kind: e.target.value as Kind })}
        >
          {SCHOOL_KINDS.map((k) => (
            <option key={k} value={k}>
              {m.schools.kind[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function NewSchool({ regionId, regionName, m }: { regionId: number; regionName: string; m: SeasonsMessages }) {
  const act = useSeasonAction(m);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>({ name: '', district: '', kind: 'general' });
  const [nameErr, setNameErr] = useState(false);
  const titleId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = d.name.trim();
    if (name.length < 2) return setNameErr(true);
    setNameErr(false);
    const ok = await act.run(
      () => sessionApi.createSchool({ regionId, kind: d.kind, name, district: d.district.trim() || undefined }),
      () => fill(m.schools.added, { name }),
    );
    if (ok) {
      setD({ name: '', district: '', kind: 'general' });
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="fam-btn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} />
        {m.schools.addOpen}
      </button>
    );
  }
  return (
    <form className="ss-form" onSubmit={submit} noValidate aria-labelledby={titleId}>
      <h3 id={titleId} className="ss-form__title">
        {fill(m.schools.addTitle, { region: regionName })}
      </h3>
      <fieldset className="ss-fieldset" disabled={act.busy}>
        <SchoolFields d={d} setD={setD} nameErr={nameErr} m={m} autoFocus />
      </fieldset>
      <p className="fam-caption">
        <Icon name="pin" size={14} />
        {m.schools.regionFixed}
      </p>
      {act.error && (
        <p className="fam-alert" role="alert">
          {act.error}
        </p>
      )}
      <div className="fam-actions">
        <button type="button" className="fam-btn" disabled={act.busy} onClick={() => setOpen(false)}>
          {m.schools.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {m.schools.add}
        </button>
      </div>
    </form>
  );
}

export function SchoolList({ schools, m }: { schools: StaffSchool[]; m: SeasonsMessages }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <ul className="ss-schools">
      {schools.map((s) => (
        <li key={s.id} className="ss-school">
          {editing === s.id ? (
            <SchoolEdit school={s} m={m} onDone={() => setEditing(null)} />
          ) : (
            <>
              <div className="ss-school__main">
                <span className="ss-school__name">{s.name}</span>
                <span className="fam-small fam-muted">
                  {s.district || m.schools.noDistrict} · {fill(m.schools.pupilsFmt, { n: s.pupils })}
                </span>
              </div>
              <span className="chip chip--neutral">{m.schools.kind[s.kind]}</span>
              <button
                type="button"
                className="fam-btn fam-btn--sm fam-btn--quiet"
                aria-label={fill(m.schools.editAria, { name: s.name })}
                onClick={() => setEditing(s.id)}
              >
                <Icon name="edit" size={16} />
                {m.schools.edit}
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function SchoolEdit({ school, m, onDone }: { school: StaffSchool; m: SeasonsMessages; onDone: () => void }) {
  const act = useSeasonAction(m);
  const [d, setD] = useState<Draft>({ name: school.name, district: school.district ?? '', kind: school.kind });
  const [nameErr, setNameErr] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = d.name.trim();
    if (name.length < 2) return setNameErr(true);
    setNameErr(false);
    const ok = await act.run(
      () => sessionApi.patchSchool(school.id, { name, kind: d.kind, district: d.district.trim() }),
      () => fill(m.schools.saved, { name }),
    );
    if (ok) onDone();
  }

  return (
    <form className="ss-form ss-form--flat" onSubmit={submit} noValidate>
      <fieldset className="ss-fieldset" disabled={act.busy}>
        <SchoolFields d={d} setD={setD} nameErr={nameErr} m={m} autoFocus />
      </fieldset>
      <p className="fam-caption">
        <Icon name="pin" size={14} />
        {m.schools.regionFixed}
      </p>
      {act.error && (
        <p className="fam-alert" role="alert">
          {act.error}
        </p>
      )}
      <div className="fam-actions">
        <button type="button" className="fam-btn" disabled={act.busy} onClick={onDone}>
          {m.schools.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {m.schools.save}
        </button>
      </div>
    </form>
  );
}
