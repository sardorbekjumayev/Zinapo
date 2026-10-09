'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { calibrationApi, type CalibrationMethod } from './api';
import { useCalibrationAction } from './useCalibrationAction';

/**
 * "Re-run v0" for one grade, or for every grade when `grade` is undefined.
 * Behind a confirm because a finished re-run becomes current at once — the
 * parent reports of that grade switch to it.
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

  async function start() {
    const ok = await action.run(
      () => calibrationApi.trigger(method, grade),
      (r) => (r.runs.length === 0 ? m.rerun.none : fill(m.rerun.doneFmt, { n: r.runs.length })),
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
        title={all ? m.rerun.dlgTitleAll : fill(m.rerun.dlgTitleGradeFmt, { g: grade })}
        body={all ? `${m.rerun.dlgBody} ${m.rerun.dlgBodyAll}` : m.rerun.dlgBody}
        confirmLabel={m.rerun.confirm}
        cancelLabel={m.rerun.cancel}
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
