'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { familyApi, FamilyApiError } from '@/lib/family-api';

type Field = 'familyName' | 'givenName' | 'patronymic';
const FIELDS: Field[] = ['familyName', 'givenName', 'patronymic'];
const MAX = 120;

export interface ChildDetailsCopy {
  familyName: string;
  givenName: string;
  patronymic: string;
  dob: string;
  none: string;
  edit: string;
  save: string;
  cancel: string;
  saved: string;
  required: string;
  tooLong: string;
  networkError: string;
  genericError: string;
}

/**
 * The owner's inline edit of the child's names (`PATCH /family/children/:id`).
 * Only changed fields are sent, so an untouched upper-case family name is not
 * rewritten. The date of birth is not editable here: it is checked against the
 * identity number at creation and changing it is a support case.
 */
export function ChildDetails({
  childId,
  initial,
  dobLabel,
  canEdit,
  copy,
}: {
  childId: string;
  initial: Record<Field, string>;
  dobLabel: string;
  canEdit: boolean;
  copy: ChildDetailsCopy;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // The API can't clear a patronymic (1–120 chars), so an empty one is only
  // valid if there wasn't one to begin with.
  const errorFor = (f: Field): string | null => {
    const v = values[f].trim();
    if (!v) return f === 'patronymic' && !initial.patronymic ? null : copy.required;
    if (v.length > MAX) return copy.tooLong;
    return null;
  };
  const errors = Object.fromEntries(FIELDS.map((f) => [f, errorFor(f)])) as Record<Field, string | null>;
  const invalid = FIELDS.some((f) => errors[f]);
  const changed = FIELDS.filter((f) => values[f].trim() !== initial[f].trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    if (changed.length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await familyApi.patchChild(
        childId,
        Object.fromEntries(changed.map((f) => [f, values[f].trim()])),
      );
      setEditing(false);
      setTouched(false);
      setResult({ ok: true, text: copy.saved });
      router.refresh();
    } catch (err) {
      const code = err instanceof FamilyApiError ? err.code : 'UNKNOWN';
      setResult({ ok: false, text: code === 'NETWORK' ? copy.networkError : copy.genericError });
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <>
        <dl className="fp-dl">
          {FIELDS.map((f) => (
            <div key={f} className="fp-dl__row">
              <dt>{copy[f]}</dt>
              <dd>{initial[f] || copy.none}</dd>
            </div>
          ))}
          <div className="fp-dl__row">
            <dt>{copy.dob}</dt>
            <dd>{dobLabel}</dd>
          </div>
        </dl>
        {canEdit && (
          <div className="fam-actions">
            <p className={result?.ok ? 'fam-alert fam-alert--ok' : 'visually-hidden'} role="status">
              {result?.ok ? result.text : ''}
            </p>
            <button
              type="button"
              className="fam-btn fam-btn--sm"
              onClick={() => {
                setValues(initial);
                setResult(null);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} />
              {copy.edit}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <form className="fam-stack" style={{ '--gap': '16px' } as React.CSSProperties} onSubmit={save} noValidate>
      {FIELDS.map((f) => {
        const err = touched ? errors[f] : null;
        return (
          <div key={f} className="fam-field">
            <label className="fam-label" htmlFor={`fp-${f}`}>
              {copy[f]}
            </label>
            <input
              id={`fp-${f}`}
              className="fam-input"
              value={values[f]}
              maxLength={MAX + 20}
              autoComplete="off"
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? `fp-${f}-err` : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
            />
            {err && (
              <p id={`fp-${f}-err`} className="fam-caption fam-caption--bad">
                {err}
              </p>
            )}
          </div>
        );
      })}
      {result && !result.ok && (
        <p className="fam-alert" role="alert">
          {result.text}
        </p>
      )}
      <div className="fam-actions">
        <button
          type="button"
          className="fam-btn fam-btn--quiet fam-btn--sm"
          onClick={() => {
            setEditing(false);
            setTouched(false);
            setResult(null);
          }}
          disabled={busy}
        >
          {copy.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary fam-btn--sm" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {copy.save}
        </button>
      </div>
    </form>
  );
}
