'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import { sessionApi } from '@/lib/session-api';
import type { StaffWave, WaveForm } from '@/lib/session-types';
import type { SeasonsMessages } from '@/messages/seasons';
import { fromLocalInput, toLocalInput } from './shared';
import { useSeasonAction } from './useSeasonAction';

export interface WaveTarget {
  grade: number;
  ordinal: number;
  wave: StaffWave | null;
}

/**
 * Set or edit one wave window (task.md § 8.5, INV-14). What may change
 * follows the API: anything while upcoming; once open only a later close —
 * the start and the form are already what children were measured with.
 * Closed waves never reach this dialog.
 */
export function WaveDialog({
  target,
  seasonId,
  forms,
  gradeName,
  m,
  onClose,
}: {
  target: WaveTarget;
  seasonId: string;
  forms: WaveForm[];
  gradeName: string;
  m: SeasonsMessages;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const act = useSeasonAction(m);
  const { wave, grade, ordinal } = target;
  const isOpen = wave?.state === 'open';
  const [opens, setOpens] = useState(wave ? toLocalInput(wave.opensAt) : '');
  const [closes, setCloses] = useState(wave ? toLocalInput(wave.closesAt) : '');
  const [formId, setFormId] = useState(wave?.formId ?? '');
  const [clientErr, setClientErr] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const o = fromLocalInput(opens);
    const c = fromLocalInput(closes);
    if (!o || !c) return setClientErr(m.wave.dateErr);
    if (c <= o) return setClientErr(m.wave.closesErr);
    if (isOpen && wave && new Date(c) <= new Date(wave.closesAt)) return setClientErr(m.wave.extendErr);
    setClientErr(null);

    const done = () => fill(m.wave.saved, { n: ordinal, grade: gradeName });
    const ok = !wave
      ? await act.run(
          () => sessionApi.upsertWave({ seasonId, grade, ordinal, opensAt: o, closesAt: c, ...(formId ? { formId } : {}) }),
          done,
        )
      : isOpen
        ? await act.run(() => sessionApi.patchWave(wave.id, { closesAt: c }), done)
        : await act.run(() => sessionApi.patchWave(wave.id, { opensAt: o, closesAt: c, formId: formId || null }), done);
    if (ok) onClose();
  }

  const error = clientErr ?? act.error;
  const selected = forms.find((f) => f.id === formId);

  return (
    <dialog
      ref={ref}
      className="fam-dialog ss-dialog"
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        if (!act.busy) onClose();
      }}
    >
      <form onSubmit={save} noValidate className="fam-stack" style={{ '--gap': '18px' } as React.CSSProperties}>
        <div className="fam-inline" style={{ justifyContent: 'space-between' }}>
          <h2 id={`${id}-t`} className="fam-dialog__title" style={{ margin: 0 }}>
            {fill(wave ? m.wave.editTitle : m.wave.newTitle, { n: ordinal, grade: gradeName })}
          </h2>
          {wave && <span className={`chip ss-chip--${wave.state}`}>{m.cal.state[wave.state]}</span>}
        </div>

        {isOpen && (
          <p className="fam-note fam-note--brand">
            <Icon name="lock" size={18} />
            <span>{m.wave.openNote}</span>
          </p>
        )}

        <fieldset className="ss-fieldset" disabled={act.busy}>
          <div className="fam-row">
            <div className="fam-field">
              <label className="fam-label" htmlFor={`${id}-o`}>
                {m.wave.opensLbl}
              </label>
              <input
                id={`${id}-o`}
                type="datetime-local"
                className="fam-input"
                value={opens}
                disabled={isOpen}
                required
                aria-describedby={`${id}-tz`}
                onChange={(e) => setOpens(e.target.value)}
              />
            </div>
            <div className="fam-field">
              <label className="fam-label" htmlFor={`${id}-c`}>
                {m.wave.closesLbl}
              </label>
              <input
                id={`${id}-c`}
                type="datetime-local"
                className="fam-input"
                value={closes}
                min={isOpen && wave ? toLocalInput(wave.closesAt) : opens || undefined}
                required
                autoFocus={isOpen}
                aria-describedby={`${id}-tz`}
                aria-invalid={!!clientErr || undefined}
                onChange={(e) => setCloses(e.target.value)}
              />
            </div>
          </div>
          <span id={`${id}-tz`} className="fam-caption">
            <Icon name="clock" size={14} />
            {m.wave.tzHint}
          </span>

          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-f`}>
              {m.wave.formLbl}
            </label>
            {isOpen ? (
              <p className="ss-formFixed" id={`${id}-f`}>
                {wave?.formLabel ?? m.wave.formNone}
              </p>
            ) : forms.length === 0 ? (
              <p className="fam-note fam-note--warn" id={`${id}-f`}>
                <Icon name="alert" size={18} />
                <span>{m.wave.formsEmpty}</span>
              </p>
            ) : (
              <select id={`${id}-f`} className="fam-select" value={formId} onChange={(e) => setFormId(e.target.value)}>
                <option value="">{m.wave.formNone}</option>
                {forms.map((f) => {
                  const used = [...new Set(f.usedByWaves ?? [])];
                  return (
                    <option key={f.id} value={f.id}>
                      {used.length > 0
                        ? fill(m.wave.formUsedFmt, { label: f.label, list: used.join(', ') })
                        : fill(m.wave.formFmt, { label: f.label, n: f.positions })}
                    </option>
                  );
                })}
              </select>
            )}
            {!isOpen && !selected && forms.length > 0 && (
              <span className="fam-caption fam-caption--bad">
                <Icon name="alert" size={14} />
                {m.wave.noFormWarn}
              </span>
            )}
          </div>
        </fieldset>

        {error && (
          <p className="fam-alert" role="alert">
            {error}
          </p>
        )}

        <div className="fam-dialog__actions" style={{ marginTop: 0 }}>
          <button type="button" className="fam-btn" onClick={onClose} disabled={act.busy}>
            {m.wave.cancel}
          </button>
          <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
            {act.busy && <span className="spinner" aria-hidden="true" />}
            {m.wave.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}
