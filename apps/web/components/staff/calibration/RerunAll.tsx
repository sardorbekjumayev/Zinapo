'use client';

import { useState } from 'react';
import type { CalibrationMessages } from '@/messages/calibration';
import type { CalibrationMethod } from './api';
import { RerunButton } from './RerunButton';

/**
 * The page toolbar: the method for a re-run and "Re-run all grades". v1 is
 * listed so the road ahead is visible, but disabled until M9 (the API would
 * answer 409 METHOD_NOT_AVAILABLE anyway).
 */
export function RerunAll({ m }: { m: CalibrationMessages }) {
  const [method, setMethod] = useState<CalibrationMethod>('raw_band_v0');

  return (
    <div className="cb-toolbar">
      <fieldset className="cb-methods">
        <legend className="fam-label">{m.toolbar.methodLegend}</legend>
        <label className="cb-method">
          <input
            type="radio"
            name="cb-method"
            value="raw_band_v0"
            checked={method === 'raw_band_v0'}
            onChange={() => setMethod('raw_band_v0')}
          />
          <span>{m.toolbar.v0}</span>
        </label>
        <label className="cb-method" data-disabled="true">
          <input
            type="radio"
            name="cb-method"
            value="rasch_anchor_equating_v1"
            disabled
            aria-describedby="cb-v1-note"
            checked={method === 'rasch_anchor_equating_v1'}
            onChange={() => setMethod('rasch_anchor_equating_v1')}
          />
          <span>{m.toolbar.v1}</span>
          <span id="cb-v1-note" className="chip chip--neutral">
            {m.toolbar.v1Note}
          </span>
        </label>
      </fieldset>
      <RerunButton m={m} method={method} label={m.toolbar.rerunAll} primary />
    </div>
  );
}
