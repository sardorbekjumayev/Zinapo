'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorText } from '@/components/educator/invites/shared';
import { Icon, type IconName } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { EducatorKind, Subject } from '@/lib/educator-types';
import type { Region } from '@/lib/family-types';
import { regionName } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { InvitesMessages } from '@/messages/invites';

const KINDS: { kind: EducatorKind; icon: IconName }[] = [
  { kind: 'tutor', icon: 'user' },
  { kind: 'school_teacher', icon: 'users' },
  { kind: 'learning_centre', icon: 'home' },
];
const SUBJECTS: Subject[] = ['numeracy', 'reasoning', 'language'];

type Schools = { state: 'idle' | 'loading' | 'error' } | { state: 'ok'; list: { id: string; name: string }[] };

/** The educator application (task.md § 8.4): who, where, which areas. */
export function ApplyForm({
  locale,
  m,
  regions,
  back,
  initial,
}: {
  locale: Locale;
  /** Only the slices it needs: the whole namespace would ship the invites page's copy too. */
  m: Pick<InvitesMessages, 'apply' | 'common'>;
  regions: Region[];
  back: string;
  initial: { kind: EducatorKind | null; regionId: number | null; subjects: Subject[] } | null;
}) {
  const t = m.apply;
  const router = useRouter();
  const [kind, setKind] = useState<EducatorKind | null>(initial?.kind ?? null);
  const [regionId, setRegionId] = useState<number | null>(initial?.regionId ?? null);
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState<Schools>({ state: 'idle' });
  const [subjects, setSubjects] = useState<Subject[]>(initial?.subjects ?? []);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSchoolId('');
    if (regionId === null) {
      setSchools({ state: 'idle' });
      return;
    }
    let live = true;
    setSchools({ state: 'loading' });
    educatorApi.schools(regionId).then(
      (list) => live && setSchools({ state: 'ok', list }),
      () => live && setSchools({ state: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [regionId]);

  const v = {
    kind: kind === null ? t.v.kind : null,
    region: regionId === null ? t.v.region : null,
    subjects: subjects.length === 0 ? t.v.subjects : null,
  };

  const toggle = (s: Subject) =>
    setSubjects((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (v.kind || v.region || v.subjects || kind === null || regionId === null) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await educatorApi.apply({ kind, regionId, schoolId: schoolId || null, subjects });
      // The workspace list changed (task.md § 2.2): re-read it, then go.
      router.refresh();
      router.replace(`/${locale}/educator${profile.status === 'approved' ? '' : '/pending'}`);
    } catch (err) {
      setError(errorText(err, t.errors, m.common.errors));
      setBusy(false);
    }
  };

  return (
    <form className="fam-panel iv-panel" onSubmit={submit} noValidate>
      <fieldset className="iv-fieldset">
        <legend className="fam-label">{t.kindLabel}</legend>
        <div className="iv-choices">
          {KINDS.map((k) => (
            <label key={k.kind} className="iv-choice">
              <input
                type="radio"
                name="kind"
                value={k.kind}
                checked={kind === k.kind}
                onChange={() => setKind(k.kind)}
                className="visually-hidden"
              />
              <span className="iv-choice__icon" aria-hidden="true">
                <Icon name={k.icon} size={20} />
              </span>
              <span className="iv-choice__title">{m.common.kind[k.kind]}</span>
              <span className="fam-small fam-muted">{t.kindHint[k.kind]}</span>
            </label>
          ))}
        </div>
        {tried && v.kind && <p className="fam-caption fam-caption--bad">{v.kind}</p>}
      </fieldset>

      <div className="fam-row">
        <div className="fam-field">
          <label htmlFor="iv-region" className="fam-label">
            {t.region}
          </label>
          <select
            id="iv-region"
            className="fam-select"
            value={regionId ?? ''}
            aria-invalid={tried && !!v.region}
            onChange={(e) => setRegionId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t.regionPick}</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {regionName(r, locale)}
              </option>
            ))}
          </select>
          {tried && v.region && <p className="fam-caption fam-caption--bad">{v.region}</p>}
        </div>
        <div className="fam-field">
          <label htmlFor="iv-school" className="fam-label">
            {t.school}
          </label>
          <select
            id="iv-school"
            className="fam-select"
            value={schoolId}
            disabled={schools.state !== 'ok'}
            aria-describedby="iv-school-note"
            onChange={(e) => setSchoolId(e.target.value)}
          >
            <option value="">
              {schools.state === 'idle'
                ? t.schoolPickRegion
                : schools.state === 'loading'
                  ? t.schoolLoading
                  : t.schoolNone}
            </option>
            {schools.state === 'ok' &&
              schools.list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <p id="iv-school-note" className="fam-caption" aria-live="polite">
            {schools.state === 'error' ? t.schoolErr : ''}
          </p>
        </div>
      </div>

      <fieldset className="iv-fieldset">
        <legend className="fam-label">
          {t.subjects} <span className="fam-muted fam-small">· {t.subjectsHint}</span>
        </legend>
        <div className="iv-tags">
          {SUBJECTS.map((s) => (
            <label key={s} className="iv-check">
              <input type="checkbox" checked={subjects.includes(s)} onChange={() => toggle(s)} />
              {m.common.subject[s]}
            </label>
          ))}
        </div>
        {tried && v.subjects && <p className="fam-caption fam-caption--bad">{v.subjects}</p>}
      </fieldset>

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      <div className="iv-actions">
        <Link href={back} className="fam-btn fam-btn--quiet">
          {t.back}
        </Link>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t.submitting : t.submit}
        </button>
      </div>
    </form>
  );
}
