'use client';

import { useEffect, useId, useRef } from 'react';
import { Icon, type IconName } from '@/components/shell/Icon';

/**
 * The confirm dialog from design/06 (decline, switch off, transfer, delete).
 *
 * A native <dialog> opened with showModal(): focus is trapped and restored, Esc
 * closes it, and the page behind is inert — all without a library.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  list,
  confirmLabel,
  cancelLabel,
  danger = true,
  icon,
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  list?: string[];
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  icon?: IconName;
  busy?: boolean;
  /** Shown above the buttons when the confirmed action failed. */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Several dialogs can be mounted on one page; each needs its own title id.
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

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
        <Icon name={icon ?? (danger ? 'alert' : 'users')} size={22} />
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
          onClick={onConfirm}
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
