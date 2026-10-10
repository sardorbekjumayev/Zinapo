'use client';

import { useState } from 'react';
import type { CalibrationMessages } from '@/messages/calibration';
import type { CalibrationMethod } from './api';
import { RerunButton } from './RerunButton';

/**
 * The page toolbar: the method, then one run for every grade. v1 is explained
 * right under its choice — its runs are not current until someone switches
 * them (task.md note M9-d), unlike v0.
 */
export function RerunAll({ m }: { m: CalibrationMessages }) {
  const [method, setMethod] = useState<CalibrationMethod>('raw_band_v0');
  const v1 = method === 'rasch_anchor_equating_v1';

  return (
    <div className="cb-toolbar">
      <fieldset className="cb-methods">
        <legend className="fam-label">{m.toolbar.methodLegend}</legend>
        <label className="cb-method">
          <input
            type="radio"
            name="cb-method"
            value="raw_band_v0"
            checked={!v1}
            onChange={() => setMethod('raw_band_v0')}
          />
          <span>{m.toolbar.v0}</span>
        </label>
        <label className="cb-method">
          <input
            type="radio"
            name="cb-method"
            value="rasch_anchor_equating_v1"
            aria-describedby="cb-v1-note"
            checked={v1}
            onChange={() => setMethod('rasch_anchor_equating_v1')}
          />
          <span>{m.toolbar.v1}</span>
        </label>
      </fieldset>
      <ul id="cb-v1-note" className="cb-v1note" data-active={v1 ? 'true' : 'false'}>
        <li>{m.toolbar.v1Bands}</li>
        <li>{m.toolbar.v1Anchors}</li>
        <li>{m.toolbar.v1Inflation}</li>
        <li className="cb-v1note__key">{m.toolbar.v1NotCurrent}</li>
      </ul>
      <RerunButton m={m} method={method} label={v1 ? m.toolbar.runAllV1 : m.toolbar.rerunAll} primary />
    </div>
  );
}
