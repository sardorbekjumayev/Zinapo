'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { educatorApi } from '@/lib/educator-api';
import type { Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { errorText } from './errors';
import { gradeName } from './labels';

/** Create a group, then open it. The API returns the existing group for a repeated name (a double click is not two groups). */
export function CreateGroupForm({ locale, defaultGrade = null }: { locale: Locale; defaultGrade?: number | null }) {
  const m = educatorMessages(locale);
  const c = m.create;
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState<string>(defaultGrade === null ? '' : String(defaultGrade));
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setInvalid(c.nameRequired);
    if (clean.length > 80) return setInvalid(c.nameTooLong);
    setInvalid(null);
    setError(null);
    setBusy(true);
    try {
      const res = await educatorApi.createGroup({ name: clean, grade: grade === '' ? null : Number(grade) });
      if (!res.created) setNote(c.existed);
      router.push(`/${locale}/educator/groups/${res.id}`);
      router.refresh();
    } catch (err) {
      setError(errorText(err, m, { NAME_REQUIRED: c.nameRequired }));
      setBusy(false);
    }
  }

  return (
    <form className="ed-createForm" onSubmit={submit} noValidate>
      <div className="fam-field">
        <label className="fam-label" htmlFor={`${id}-name`}>
          {c.nameLabel}
        </label>
        <input
          id={`${id}-name`}
          className="fam-input"
          value={name}
          maxLength={120}
          placeholder={c.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${id}-err` : undefined}
        />
        {invalid && (
          <p id={`${id}-err`} className="fam-caption fam-caption--bad" role="alert">
            {invalid}
          </p>
        )}
      </div>
      <div className="fam-field">
        <label className="fam-label" htmlFor={`${id}-grade`}>
          {c.gradeLabel}
        </label>
        <select
          id={`${id}-grade`}
          className="fam-select"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          aria-describedby={`${id}-hint`}
        >
          {[0, 1, 2, 3, 4].map((g) => (
            <option key={g} value={g}>
              {gradeName(locale, g, '')}
            </option>
          ))}
          <option value="">{m.common.gradeAny}</option>
        </select>
        <p id={`${id}-hint`} className="fam-caption">
          {c.gradeHint}
        </p>
      </div>
      <button type="submit" className="fam-btn ed-selfStart" disabled={busy} aria-busy={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {c.submit}
      </button>
      {note && (
        <p className="fam-caption" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
