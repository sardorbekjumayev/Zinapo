'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { familyApi, FamilyApiError } from '@/lib/family-api';
import type { School } from '@/lib/family-types';

export interface EnrolmentFormCopy {
  title: string;
  sub: string;
  yearLabel: string;
  gradeLabel: string;
  regionLabel: string;
  regionChoose: string;
  schoolLabel: string;
  schoolChoose: string;
  schoolNotListedOption: string;
  schoolsLoading: string;
  schoolsEmpty: string;
  schoolsError: string;
  regionCap: string;
  submit: string;
  added: string;
  errSchoolRegion: string;
  errPending: string;
  networkError: string;
  genericError: string;
}

/** Sentinel for "my school isn't listed" — the request then omits `schoolId`. */
const NOT_LISTED = 'not-listed';

/**
 * "Changed school or grade?" — adds an enrolment (task.md § 12 M2). History,
 * not an edit: the API closes the current record of that school year and
 * opens a new one. The region is the SCHOOL's region because the cohort is
 * (task.md § 8.1.2).
 */
export function EnrolmentForm({
  childId,
  years,
  grades,
  regions,
  initial,
  copy,
}: {
  childId: string;
  years: { value: number; label: string }[];
  grades: { value: number; label: string }[];
  regions: { id: number; name: string }[];
  initial: { schoolYear: number; grade: number | null; regionId: number | null; schoolId: string | null };
  copy: EnrolmentFormCopy;
}) {
  const router = useRouter();
  const [year, setYear] = useState(initial.schoolYear);
  const [grade, setGrade] = useState(initial.grade ?? 0);
  const [regionId, setRegionId] = useState<number | null>(initial.regionId);
  const [schools, setSchools] = useState<School[] | null>(null);
  const [schoolsState, setSchoolsState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [schoolId, setSchoolId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (regionId === null) return;
    let live = true;
    setSchools(null);
    setSchoolId('');
    setSchoolsState('loading');
    familyApi
      .schools(regionId)
      .then((list) => {
        if (!live) return;
        setSchools(list);
        setSchoolsState('idle');
        // No list for this region: "not listed" is the only honest answer.
        if (list.length === 0) setSchoolId(NOT_LISTED);
        else if (regionId === initial.regionId && list.some((s) => s.id === initial.schoolId)) {
          setSchoolId(initial.schoolId ?? '');
        }
      })
      .catch(() => live && setSchoolsState('error'));
    return () => {
      live = false;
    };
  }, [regionId, initial.regionId, initial.schoolId]);

  const ready = regionId !== null && schoolId !== '' && schoolsState === 'idle';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy || regionId === null) return;
    setBusy(true);
    setResult(null);
    try {
      await familyApi.addEnrolment(childId, {
        schoolYear: year,
        grade,
        schoolRegionId: regionId,
        ...(schoolId !== NOT_LISTED ? { schoolId } : {}),
      });
      setResult({ ok: true, text: copy.added });
      router.refresh();
    } catch (err) {
      const code = err instanceof FamilyApiError ? err.code : 'UNKNOWN';
      const text =
        code === 'SCHOOL_NOT_IN_REGION'
          ? copy.errSchoolRegion
          : code === 'ANONYMISATION_PENDING'
            ? copy.errPending
            : code === 'NETWORK'
              ? copy.networkError
              : copy.genericError;
      setResult({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fp-enrolForm" onSubmit={submit} noValidate>
      <div>
        <h3 className="fp-h3">{copy.title}</h3>
        <p className="fam-panel__sub">{copy.sub}</p>
      </div>

      <div className="fam-row">
        <div className="fam-field">
          <label className="fam-label" htmlFor="fp-year">
            {copy.yearLabel}
          </label>
          <select id="fp-year" className="fam-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y.value} value={y.value}>
                {y.label}
              </option>
            ))}
          </select>
        </div>
        <div className="fam-field">
          <label className="fam-label" htmlFor="fp-grade">
            {copy.gradeLabel}
          </label>
          <select id="fp-grade" className="fam-select" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
            {grades.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="fam-row">
        <div className="fam-field">
          <label className="fam-label" htmlFor="fp-region">
            {copy.regionLabel}
          </label>
          <select
            id="fp-region"
            className="fam-select"
            value={regionId ?? ''}
            aria-describedby="fp-region-cap"
            onChange={(e) => setRegionId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="" disabled>
              {copy.regionChoose}
            </option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="fam-field">
          <label className="fam-label" htmlFor="fp-school">
            {copy.schoolLabel}
          </label>
          <select
            id="fp-school"
            className="fam-select"
            value={schoolId}
            disabled={regionId === null || schoolsState !== 'idle'}
            aria-describedby="fp-school-cap"
            onChange={(e) => setSchoolId(e.target.value)}
          >
            <option value="" disabled>
              {schoolsState === 'loading' ? copy.schoolsLoading : copy.schoolChoose}
            </option>
            {(schools ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.district ? `${s.name} (${s.district})` : s.name}
              </option>
            ))}
            <option value={NOT_LISTED}>{copy.schoolNotListedOption}</option>
          </select>
        </div>
      </div>

      <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <p id="fp-region-cap" className="fam-caption">
          <Icon name="pin" size={14} />
          {copy.regionCap}
        </p>
        <p id="fp-school-cap" className={schoolsState === 'error' ? 'fam-caption fam-caption--bad' : 'fam-caption'} aria-live="polite">
          {schoolsState === 'error' ? copy.schoolsError : schools && schools.length === 0 ? copy.schoolsEmpty : ''}
        </p>
      </div>

      <div aria-live="polite">
        {result && (
          <p className={result.ok ? 'fam-alert fam-alert--ok' : 'fam-alert'} role={result.ok ? 'status' : 'alert'}>
            {result.text}
          </p>
        )}
      </div>

      <div className="fam-actions" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={!ready || busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {copy.submit}
        </button>
      </div>
    </form>
  );
}
