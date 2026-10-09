'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/shell/Icon';

/**
 * ConfirmDialog's look (design/06) with an optional note field: every case
 * decision is irreversible and most need the reason written down, so the
 * note is asked for at the moment of confirming, not in a separate form.
 */
export function NoteDialog({
  open,
  title,
  body,
  list,
  field,
  confirmLabel,
  cancelLabel,
  danger = false,
  icon,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  list?: string[];
  /** Absent: a plain confirmation. `required` notes need 3+ characters (the API's rule). */
  field?: { label: string; placeholder?: string; required?: boolean; requiredTag?: string; error: string };
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  icon?: IconName;
  busy: boolean;
  error: string | null;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setNote('');
      setInvalid(false);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const submit = () => {
    if (field?.required && note.trim().length < 3) {
      setInvalid(true);
      return;
    }
    onConfirm(note.trim());
  };

  return (
    <dialog
      ref={ref}
      className="fam-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <span className={danger ? 'fam-dialog__icon' : 'fam-dialog__icon fam-dialog__icon--brand'}>
        <Icon name={icon ?? (danger ? 'alert' : 'shield')} size={22} />
      </span>
      <h2 id={titleId} className="fam-dialog__title">
        {title}
      </h2>
      <p className="fam-dialog__body">{body}</p>
      {list && list.length > 0 && (
        <ul className="fam-dialog__list">
          {list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {field && (
        <div className="fam-field" style={{ marginTop: 16 }}>
          <label htmlFor={fieldId} className="fam-label">
            {field.label}
            {field.required && field.requiredTag && <span className="ts-req"> · {field.requiredTag}</span>}
          </label>
          <textarea
            id={fieldId}
            className="ts-textarea"
            rows={3}
            maxLength={2000}
            placeholder={field.placeholder}
            value={note}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${fieldId}-err` : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              if (invalid) setInvalid(false);
            }}
          />
          {invalid && (
            <p id={`${fieldId}-err`} className="fam-caption fam-caption--bad">
              {field.error}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="fam-alert" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
      <div className="fam-dialog__actions">
        <button type="button" className="fam-btn" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'fam-btn fam-btn--dangerSolid' : 'fam-btn fam-btn--primary'}
          onClick={submit}
          disabled={busy}
          aria-busy={busy}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
