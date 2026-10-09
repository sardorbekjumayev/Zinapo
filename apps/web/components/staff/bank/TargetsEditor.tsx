'use client';

import { useState } from 'react';
import { bankApi } from '@/lib/bank-api';
import { fill } from '@/lib/i18n';
import type { BankMessages } from '@/messages/bank';
import { useBankAction } from './live';

const MAX = 5000;

/** The bank editor's five per-grade targets for the season (`PUT /staff/items/targets`). */
export function TargetsEditor({
  m,
  tiles,
  hasSeason,
}: {
  m: BankMessages;
  tiles: { grade: number; target: number | null }[];
  hasSeason: boolean;
}) {
  const t = m.tiles;
  const { run, busy, errorFor, fail, clearError } = useBankAction(m);
  const [open, setOpen] = useState(false);
  const initial = () => Object.fromEntries(tiles.map((x) => [x.grade, x.target === null ? '' : String(x.target)]));
  const [values, setValues] = useState<Record<number, string>>(initial);
  const error = errorFor('targets');

  if (!open) {
    return (
      <button
        type="button"
        className="fam-btn fam-btn--sm bk-season__edit"
        onClick={() => {
          setValues(initial());
          clearError();
          setOpen(true);
        }}
        disabled={!hasSeason}
        title={hasSeason ? undefined : t.noSeason}
      >
        {t.editTargets}
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const targets = tiles.map((x) => ({ grade: x.grade, raw: values[x.grade]?.trim() ?? '' }));
    if (targets.some((x) => !/^\d+$/.test(x.raw) || Number(x.raw) > MAX)) {
      fail('targets', t.targetsInvalid);
      return;
    }
    const ok = await run(
      'targets',
      () => bankApi.setTargets(targets.map((x) => ({ grade: x.grade, target: Number(x.raw) }))),
      t.targetsSaved,
    );
    if (ok) setOpen(false);
  }

  return (
    <form className="bk-targets" onSubmit={submit} noValidate aria-labelledby="bk-targets-h">
      <h3 id="bk-targets-h" className="fam-label">
        {t.targetsTitle}
      </h3>
      <div className="bk-targets__grid">
        {tiles.map((x) => (
          <div key={x.grade} className="fam-field">
            <label className="fam-small fam-muted" htmlFor={`bk-target-${x.grade}`}>
              {fill(t.targetLabel, { g: x.grade })}
            </label>
            <input
              id={`bk-target-${x.grade}`}
              className="fam-input bk-targets__input"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX}
              step={1}
              value={values[x.grade] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [x.grade]: e.target.value }))}
              aria-invalid={error ? true : undefined}
              aria-describedby="bk-targets-hint"
            />
          </div>
        ))}
      </div>
      <p id="bk-targets-hint" className="fam-caption">
        {t.targetsHint}
      </p>
      {error && (
        <p className="fam-caption fam-caption--bad" role="alert">
          {error}
        </p>
      )}
      <div className="fam-inline">
        <button type="submit" className="fam-btn fam-btn--primary fam-btn--sm" disabled={busy !== null} aria-busy={busy === 'targets'}>
          {busy === 'targets' && <span className="spinner" aria-hidden="true" />}
          {m.common.save}
        </button>
        <button type="button" className="fam-btn fam-btn--quiet fam-btn--sm" onClick={() => setOpen(false)} disabled={busy !== null}>
          {m.common.cancel}
        </button>
      </div>
    </form>
  );
}
