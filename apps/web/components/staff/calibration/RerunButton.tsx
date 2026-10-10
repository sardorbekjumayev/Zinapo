'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { adminApi } from '@/lib/admin-api';
import { fill } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { calibrationApi, type CalibrationMethod } from './api';
import { useCalibrationAction } from './useCalibrationAction';

/**
 * Start a run for one grade, or for every grade when `grade` is undefined.
 * Behind a confirm: a v0 run becomes current at once (the grade's parent
 * reports switch to it); a v1 run is written next to the others and stays out
 * of the reports until staff make it current (task.md note M9-d).
 */
export function RerunButton({
  m,
  grade,
  method = 'raw_band_v0',
  label,
  primary = false,
}: {
  m: CalibrationMessages;
  grade?: number;
  method?: CalibrationMethod;
  label: string;
  primary?: boolean;
}) {
  const action = useCalibrationAction(m);
  const [open, setOpen] = useState(false);
  const all = grade === undefined;
  const t = method === 'rasch_anchor_equating_v1' ? m.runV1 : m.rerun;

  async function start() {
    const ok = await action.run(
      () => (method === 'rasch_anchor_equating_v1' ? adminApi.runV1(grade) : calibrationApi.trigger(method, grade)),
      (r) => (r.runs.length === 0 ? t.none : fill(t.doneFmt, { n: r.runs.length })),
    );
    if (ok) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={primary ? 'fam-btn fam-btn--primary' : 'fam-btn fam-btn--sm'}
        disabled={action.busy}
        aria-busy={action.busy}
        onClick={() => setOpen(true)}
      >
        {action.busy && !open ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={18} />}
        {label}
      </button>
      {action.error && !open && (
        <p className="fam-alert cb-inlineError" role="alert">
          {action.error}
        </p>
      )}
      <ConfirmDialog
        open={open}
        icon="gauge"
        danger={false}
        title={all ? t.dlgTitleAll : fill(t.dlgTitleGradeFmt, { g: grade })}
        body={all ? `${t.dlgBody} ${t.dlgBodyAll}` : t.dlgBody}
        confirmLabel={t.confirm}
        cancelLabel={t.cancel}
        busy={action.busy}
        error={action.error}
        onConfirm={start}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
      />
    </>
  );
}
