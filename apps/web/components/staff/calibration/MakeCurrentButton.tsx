'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { fill } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { calibrationApi } from './api';
import { useCalibrationAction } from './useCalibrationAction';

/** "Make current" on an older run: the grade's parent reports switch to it at once (task.md § 9). */
export function MakeCurrentButton({
  m,
  runId,
  grade,
  when,
}: {
  m: CalibrationMessages;
  runId: string;
  grade: number;
  /** The run's start, already formatted — names the run in the dialog and the announcement. */
  when: string;
}) {
  const action = useCalibrationAction(m);
  const [open, setOpen] = useState(false);

  async function confirm() {
    const ok = await action.run(
      () => calibrationApi.makeCurrent(runId),
      () => fill(m.history.doneFmt, { g: grade, d: when }),
    );
    if (ok) setOpen(false);
  }

  return (
    <>
      <button type="button" className="fam-btn fam-btn--sm" disabled={action.busy} onClick={() => setOpen(true)}>
        {m.history.makeCurrent}
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
        title={m.history.dlgTitle}
        body={fill(m.history.dlgBodyFmt, { g: grade, d: when })}
        confirmLabel={m.history.confirm}
        cancelLabel={m.history.cancel}
        busy={action.busy}
        error={action.error}
        onConfirm={confirm}
        onClose={() => {
          setOpen(false);
          action.clearError();
        }}
      />
    </>
  );
}
