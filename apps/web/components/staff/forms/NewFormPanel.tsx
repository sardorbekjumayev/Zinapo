'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { useAnnounce } from '@/components/staff/review/live';
import { bankApi } from '@/lib/bank-api';
import { fill, type Locale } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';
import { formErrorText } from './shared';

const GRADES = [0, 1, 2, 3, 4];

/**
 * design/14 "Create from template", as a small form above the list. Monitoring
 * or practice only — olympiad forms belong to M7. On success the new form
 * opens, since the next step is always filling its positions.
 */
export function NewFormPanel({
  m,
  locale,
  children,
}: {
  m: FormsMessages;
  locale: Locale;
  /** The filters: drawn on the same row as the "New form" button. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'monitoring' | 'practice'>('monitoring');
  const [grade, setGrade] = useState(4);
  const [label, setLabel] = useState('');
  const [template, setTemplate] = useState(true);
  const [labelErr, setLabelErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), grade: useId(), label: useId(), labelErr: useId(), tpl: useId() };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setLabelErr(true);
      labelRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = await bankApi.createForm({ mode, grade, label: label.trim(), template });
      announce(fill(m.create.created, { label: form.label }));
      router.push(`/${locale}/staff/forms/${form.id}`);
    } catch (err) {
      setError(formErrorText(err, m));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fb-toolbar">
        {children}
        {!open && (
          <button
            type="button"
            className="fam-btn fam-btn--primary"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => labelRef.current?.focus());
            }}
          >
            <Icon name="plus" size={18} />
            {m.create.open}
          </button>
        )}
      </div>

      {open && (
        <form className="fam-panel fb-new" aria-labelledby={ids.title} onSubmit={create} noValidate>
          <h2 id={ids.title} className="fam-panel__title">
            {m.create.title}
          </h2>

          <fieldset className="fb-modeSeg" disabled={busy}>
            <legend className="fam-label">{m.create.modeLbl}</legend>
            {(['monitoring', 'practice'] as const).map((md) => (
              <label key={md} className="fb-modeSeg__opt" data-mode={md} data-on={mode === md}>
                <input
                  type="radio"
                  name="fb-mode"
                  value={md}
                  checked={mode === md}
                  onChange={() => setMode(md)}
                  className="fb-srInput"
                />
                {m.mode[md]}
              </label>
            ))}
          </fieldset>

          <div className="fb-newRow">
            <div className="fam-field">
              <label className="fam-label" htmlFor={ids.grade}>
                {m.create.gradeLbl}
              </label>
              <select
                id={ids.grade}
                className="fam-select"
                value={grade}
                disabled={busy}
                onChange={(e) => setGrade(Number(e.target.value))}
              >
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="fam-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="fam-label" htmlFor={ids.label}>
                {m.create.labelLbl}
              </label>
              <input
                id={ids.label}
                ref={labelRef}
                className="fam-input"
                value={label}
                maxLength={120}
                placeholder={m.create.labelPh}
                disabled={busy}
                required
                aria-invalid={labelErr || undefined}
                aria-describedby={labelErr ? ids.labelErr : undefined}
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (e.target.value.trim()) setLabelErr(false);
                }}
              />
              {labelErr && (
                <span id={ids.labelErr} className="fam-caption fam-caption--bad">
                  {m.create.labelErr}
                </span>
              )}
            </div>
          </div>

          <label className="fam-check" htmlFor={ids.tpl}>
            <input
              id={ids.tpl}
              type="checkbox"
              checked={template}
              disabled={busy}
              onChange={(e) => setTemplate(e.target.checked)}
            />
            <span className="fam-stack" style={{ '--gap': '2px' } as React.CSSProperties}>
              <span>{m.create.template}</span>
              <span className="fam-small fam-muted">
                {!template ? m.create.templateOff : mode === 'practice' ? m.create.templatePr : m.create.templateMon}
              </span>
            </span>
          </label>

          {error && (
            <p className="fam-alert" role="alert">
              {error}
            </p>
          )}

          <div className="fam-actions">
            <button type="button" className="fam-btn" disabled={busy} onClick={() => setOpen(false)}>
              {m.create.cancel}
            </button>
            <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {m.create.submit}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
