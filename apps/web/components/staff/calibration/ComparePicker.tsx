'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fill } from '@/lib/i18n';
import type { CalibrationMessages } from '@/messages/calibration';
import { defaultPair, type PickerRun } from './shared';

/**
 * Pick two runs of one grade; the pair lives in the URL (`?a=&b=`) so a
 * comparison can be reloaded and shared. Only same-grade runs are offered —
 * the API answers 409 NOT_COMPARABLE otherwise.
 */
export function ComparePicker({
  m,
  runs,
  grades,
  initial,
  basePath,
}: {
  m: CalibrationMessages;
  runs: PickerRun[];
  /** Grades with at least two finished runs. */
  grades: number[];
  initial: { grade: number; a: string; b: string };
  basePath: string;
}) {
  const router = useRouter();
  const [grade, setGrade] = useState(initial.grade);
  const [a, setA] = useState(initial.a);
  const [b, setB] = useState(initial.b);
  const [invalid, setInvalid] = useState(false);
  const ofGrade = runs.filter((r) => r.grade === grade);

  function pickGrade(g: number) {
    setGrade(g);
    const pair = defaultPair(runs, g);
    setA(pair.a);
    setB(pair.b);
    setInvalid(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!a || !b || a === b) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    router.push(`${basePath}?${new URLSearchParams({ a, b })}#cb-compare`);
  }

  const options = ofGrade.map((r) => (
    <option key={r.id} value={r.id}>
      {r.label}
    </option>
  ));

  return (
    <form className="cb-picker" onSubmit={submit} noValidate>
      <div className="fam-field">
        <label htmlFor="cb-cmp-grade" className="fam-label">
          {m.compare.grade}
        </label>
        <select
          id="cb-cmp-grade"
          className="fam-select"
          value={grade}
          onChange={(e) => pickGrade(Number(e.target.value))}
        >
          {grades.map((g) => (
            <option key={g} value={g}>
              {fill(m.grade.titleFmt, { g })}
            </option>
          ))}
        </select>
      </div>
      <div className="fam-field">
        <label htmlFor="cb-cmp-a" className="fam-label">
          {m.compare.runA}
        </label>
        <select id="cb-cmp-a" className="fam-select" value={a} onChange={(e) => setA(e.target.value)}>
          {options}
        </select>
      </div>
      <div className="fam-field">
        <label htmlFor="cb-cmp-b" className="fam-label">
          {m.compare.runB}
        </label>
        <select
          id="cb-cmp-b"
          className="fam-select"
          value={b}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'cb-cmp-err' : undefined}
          onChange={(e) => setB(e.target.value)}
        >
          {options}
        </select>
      </div>
      <button type="submit" className="fam-btn fam-btn--primary cb-picker__go">
        {m.compare.submit}
      </button>
      {invalid && (
        <p id="cb-cmp-err" className="fam-caption fam-caption--bad cb-picker__err" role="alert">
          {m.compare.samePair}
        </p>
      )}
    </form>
  );
}
