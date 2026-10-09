'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/family/Avatar';
import { Toggle } from '@/components/family/Toggle';
import { Icon } from '@/components/shell/Icon';
import { FamilyApiError, familyApi } from '@/lib/family-api';
import type { ConsentType, CreateChildInput, InvitePreview, Region, School } from '@/lib/family-types';
import { childDisplayName, formatDate, regionName } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { familyMessages } from '@/messages/family';
import { wizardMessages } from '@/messages/wizard';
import { Stepper } from './Stepper';
import { WhyWeAsk } from './WhyWeAsk';
import { FollowDispute } from '../trust/FollowDispute';
import { Disputed, Done, Duplicate, Linked, Review, type DoneSummary } from './Outcomes';
import { pinflBirthDate, schoolYearLabel } from './pinfl';

/**
 * The add-child wizard (task.md § 8.1.2, design/02-add-child.html).
 *
 * Everything typed lives in React state only. The PINFL in particular is never
 * written to storage or the URL, and is dropped from state as soon as the API
 * has answered with a child or a case — the screens after that never need it.
 */

interface Form {
  pinfl: string;
  familyName: string;
  givenName: string;
  patronymic: string;
  dob: string;
  grade: string;
  regionId: string;
  /** '' and 'none' both mean "no school" — the school is optional. */
  schoolId: string;
}

const EMPTY: Form = {
  pinfl: '',
  familyName: '',
  givenName: '',
  patronymic: '',
  dob: '',
  grade: '',
  regionId: '',
  schoolId: '',
};

const NO_CONSENTS: Record<ConsentType, boolean> = {
  data_processing: false,
  third_party_transfer: false,
  marketing: false,
};

type View =
  | { kind: 'details' }
  | { kind: 'access' }
  | { kind: 'sending' }
  | { kind: 'failed' }
  | { kind: 'done'; summary: DoneSummary }
  | { kind: 'duplicate'; caseId: string }
  | { kind: 'disputed'; reference: string; phone: string; caseId: string }
  | { kind: 'review'; reference: string; phone: string }
  | { kind: 'linked' }
  | { kind: 'forbidden' };

type SchoolList = { status: 'idle' | 'loading' | 'error' } | { status: 'ok'; list: School[] };

export function AddChildWizard({
  locale,
  regions,
  invite,
  ownerName,
  schoolYear,
  forbidden,
}: {
  locale: Locale;
  regions: Region[];
  invite: (InvitePreview & { code: string }) | null;
  ownerName: string;
  schoolYear: number;
  forbidden: React.ReactNode;
}) {
  const t = wizardMessages(locale);
  const fam = familyMessages(locale);
  const router = useRouter();

  const [form, setForm] = useState<Form>(EMPTY);
  const [consents, setConsents] = useState(NO_CONSENTS);
  // The invite is for one child: "Add another" starts without it.
  const [activeInvite, setActiveInvite] = useState(invite);
  const [share, setShare] = useState(true);
  const [view, setView] = useState<View>({ kind: 'details' });
  const [tried1, setTried1] = useState(false);
  const [tried2, setTried2] = useState(false);
  const [dobRejected, setDobRejected] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [schools, setSchools] = useState<SchoolList>({ status: 'idle' });
  const [schoolsAttempt, setSchoolsAttempt] = useState(0);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const dobRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  // Each step change moves focus to the new card's heading, so a screen reader
  // hears where it landed and keyboard users don't start from the page top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view.kind]);

  useEffect(() => {
    if (!form.regionId) {
      setSchools({ status: 'idle' });
      return;
    }
    let live = true;
    setSchools({ status: 'loading' });
    familyApi
      .schools(Number(form.regionId))
      .then((list) => live && setSchools({ status: 'ok', list }))
      .catch(() => live && setSchools({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [form.regionId, schoolsAttempt]);

  const set = (key: keyof Form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === 'regionId' ? { schoolId: '' } : {}) }));
    if (key === 'dob' || key === 'pinfl') setDobRejected(false);
  };

  // ------------------------------------------------------------ validation

  const pinflDate = pinflBirthDate(form.pinfl);
  const pinflBad = form.pinfl.length === 14 ? !pinflDate : tried1 && !pinflDate;
  const dobChecked = !!pinflDate && form.dob.length === 10;
  const dobMatches = dobChecked && pinflDate === form.dob;
  const missing = {
    familyName: !form.familyName.trim(),
    givenName: !form.givenName.trim(),
    dob: !form.dob,
    grade: form.grade === '',
    regionId: !form.regionId,
  };
  const step1Valid = !!pinflDate && dobMatches && !dobRejected && !Object.values(missing).some(Boolean);
  const dobBlocks = dobRejected || (dobChecked && !dobMatches);

  const given = form.givenName.trim();
  const nameForCopy = given || t.childFallback;
  const region = regions.find((r) => String(r.id) === form.regionId);
  const schoolList = schools.status === 'ok' ? schools.list : [];
  const school = schoolList.find((s) => s.id === form.schoolId);

  // ---------------------------------------------------------------- submit

  async function submit() {
    setFormError(null);
    setView({ kind: 'sending' });
    const sharing = !!activeInvite && share;
    const input: CreateChildInput = {
      pinfl: form.pinfl,
      familyName: form.familyName.trim(),
      givenName: given,
      ...(form.patronymic.trim() ? { patronymic: form.patronymic.trim() } : {}),
      dob: form.dob,
      grade: Number(form.grade),
      schoolRegionId: Number(form.regionId),
      ...(school ? { schoolId: school.id } : {}),
      consents: (Object.keys(consents) as ConsentType[]).map((type) => ({ type, given: consents[type] })),
      ...(activeInvite ? { inviteCode: activeInvite.code, shareWithInviter: sharing } : {}),
    };

    try {
      const result = await familyApi.createChild(input);
      const summary: DoneSummary = {
        id: result.id,
        alreadyYours: !!result.alreadyYours,
        givenName: given,
        fullName: childDisplayName({ givenName: given, familyName: input.familyName }),
        grade: input.grade,
        schoolName: school?.name ?? null,
        regionName: region ? regionName(region, locale) : '',
        consents: { ...consents },
        educatorName: activeInvite?.educatorName ?? null,
        sharedUntil: result.sharedWith?.validUntil ?? null,
      };
      dropPinfl();
      setView({ kind: 'done', summary });
      // The session's workspace claim must now include `family`, and the rail
      // must list the new child. A failed refresh only delays both.
      await familyApi.refreshSession().catch(() => undefined);
      router.refresh();
    } catch (e) {
      handleError(e);
    }
  }

  function handleError(e: unknown) {
    if (!(e instanceof FamilyApiError) || e.code === 'NETWORK' || e.status >= 500) {
      setView({ kind: 'failed' });
      return;
    }
    const d = e.details as { caseId?: string; reference?: string; phone?: string };
    switch (e.code) {
      case 'PINFL_DOB_MISMATCH':
        setDobRejected(true);
        setView({ kind: 'details' });
        return;
      case 'PINFL_MALFORMED':
        setFormError(t.errMalformed);
        setView({ kind: 'details' });
        return;
      case 'VALIDATION_FAILED':
        setFormError(t.errValidation);
        setView({ kind: 'details' });
        return;
      case 'CONSENT_REQUIRED':
        setFormError(t.errConsent);
        setView({ kind: 'access' });
        return;
      case 'CHILD_CREATE_FORBIDDEN':
        dropPinfl();
        setView({ kind: 'forbidden' });
        return;
      case 'CHILD_ALREADY_LINKED':
        dropPinfl();
        setView({ kind: 'linked' });
        return;
      case 'CHILD_ALREADY_REGISTERED':
        dropPinfl();
        setView({ kind: 'duplicate', caseId: d.caseId ?? '' });
        return;
      case 'FIFTH_CHILD_REVIEW':
        dropPinfl();
        setView({ kind: 'review', reference: d.reference ?? '', phone: d.phone ?? '' });
        return;
      default:
        setFormError(e.status === 429 ? fam.common.rateLimited : fam.common.genericError);
        setView({ kind: 'access' });
    }
  }

  function dropPinfl() {
    setForm((f) => ({ ...f, pinfl: '' }));
  }

  function restart() {
    setForm(EMPTY);
    setConsents(NO_CONSENTS);
    setActiveInvite(null);
    setShare(true);
    setTried1(false);
    setTried2(false);
    setDobRejected(false);
    setFormError(null);
    setView({ kind: 'details' });
  }

  function next1() {
    setTried1(true);
    if (!step1Valid) return;
    setFormError(null);
    setView({ kind: 'access' });
  }

  function next2() {
    setTried2(true);
    if (!consents.data_processing) return;
    void submit();
  }

  // ---------------------------------------------------------------- render

  if (view.kind === 'forbidden') return <>{forbidden}</>;

  const stepNo = view.kind === 'done' ? 3 : view.kind === 'access' || view.kind === 'sending' || view.kind === 'failed' ? 2 : 1;
  const gradeYear = schoolYearLabel(schoolYear);

  return (
    <div className="wz">
      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '6px' }}>
          <h1 className="pageHead__title">{t.title}</h1>
          <p className="card__body">{t.subtitle}</p>
        </div>
      </div>

      {activeInvite && view.kind === 'details' && (
        <div className="wz-banner">
          <Avatar name={activeInvite.educatorName} tone="teal" />
          <span>
            {fill(t.invBanner, { educator: activeInvite.educatorName, code: activeInvite.publicCode })}
          </span>
        </div>
      )}

      <Stepper t={t} current={stepNo} />

      <div className="fam-grid">
        <div className="fam-col">
          {view.kind === 'details' && (
            <section className="fam-panel wz-card" aria-labelledby="wz-h">
              <header>
                <h2 id="wz-h" ref={headingRef} tabIndex={-1} className="fam-panel__title">
                  {t.s1Title}
                </h2>
                <p className="fam-panel__sub">{t.s1Sub}</p>
              </header>

              {dobRejected && (
                <div className="wz-alertCard" role="alert">
                  <Icon name="alert" size={22} />
                  <div className="wz-alertCard__body">
                    <strong>{t.dobErrT}</strong>
                    <span>{t.dobErrB}</span>
                  </div>
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm"
                    onClick={() => {
                      setDobRejected(false);
                      dobRef.current?.focus();
                    }}
                  >
                    {t.dobFix}
                  </button>
                </div>
              )}
              {formError && (
                <p className="fam-alert" role="alert">
                  {formError}
                </p>
              )}

              <div className="fam-field">
                <label htmlFor="wz-pinfl" className="fam-label">
                  {t.pinflLabel}
                </label>
                <input
                  id="wz-pinfl"
                  className="fam-input fam-input--mono"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={14}
                  value={form.pinfl}
                  aria-invalid={pinflBad}
                  aria-describedby="wz-pinfl-cap"
                  onChange={(e) => set('pinfl')(e.target.value.replace(/\D/g, '').slice(0, 14))}
                />
                {pinflBad ? (
                  <p id="wz-pinfl-cap" className="fam-caption fam-caption--bad">
                    <Icon name="x" size={14} strokeWidth={2} />
                    {t.pinflBad}
                  </p>
                ) : (
                  <p id="wz-pinfl-cap" className="fam-caption">
                    <Icon name="lock" size={14} strokeWidth={1.8} />
                    {t.pinflCap}
                  </p>
                )}
              </div>

              <div className="fam-row" style={{ ['--cols' as string]: 3 }}>
                <TextField
                  id="wz-fam"
                  label={t.famLabel}
                  value={form.familyName}
                  onChange={set('familyName')}
                  error={tried1 && missing.familyName ? t.required : null}
                />
                <TextField
                  id="wz-given"
                  label={t.givenLabel}
                  value={form.givenName}
                  onChange={set('givenName')}
                  error={tried1 && missing.givenName ? t.required : null}
                />
                <TextField
                  id="wz-pat"
                  label={t.patLabel}
                  hint={t.optional}
                  value={form.patronymic}
                  onChange={set('patronymic')}
                  error={null}
                />
              </div>

              <div className="fam-row">
                <div className="fam-field">
                  <label htmlFor="wz-dob" className="fam-label">
                    {t.dobLabel}
                  </label>
                  <input
                    id="wz-dob"
                    ref={dobRef}
                    type="date"
                    className="fam-input"
                    value={form.dob}
                    max={new Date().toISOString().slice(0, 10)}
                    aria-invalid={dobBlocks || (tried1 && missing.dob)}
                    aria-describedby="wz-dob-cap"
                    onChange={(e) => set('dob')(e.target.value)}
                  />
                  <span id="wz-dob-cap" aria-live="polite">
                    {dobChecked && !dobBlocks && (
                      <span className="fam-caption fam-caption--ok">
                        <Icon name="check" size={16} strokeWidth={2} />
                        {t.dobOk}
                      </span>
                    )}
                    {dobChecked && dobBlocks && (
                      <span className="fam-caption fam-caption--bad">
                        <Icon name="x" size={16} strokeWidth={2} />
                        {t.dobBad}
                      </span>
                    )}
                    {!dobChecked && tried1 && missing.dob && (
                      <span className="fam-caption fam-caption--bad">{t.required}</span>
                    )}
                  </span>
                </div>
                <div className="fam-field">
                  <label htmlFor="wz-grade" className="fam-label">
                    {fill(t.gradeLabel, { year: gradeYear })}
                  </label>
                  <select
                    id="wz-grade"
                    className="fam-select"
                    value={form.grade}
                    aria-invalid={tried1 && missing.grade}
                    onChange={(e) => set('grade')(e.target.value)}
                  >
                    <option value="" disabled>
                      {t.gradePick}
                    </option>
                    {[0, 1, 2, 3, 4].map((g) => (
                      <option key={g} value={g}>
                        {fam.grade[String(g) as keyof typeof fam.grade]}
                      </option>
                    ))}
                  </select>
                  {tried1 && missing.grade && <span className="fam-caption fam-caption--bad">{t.required}</span>}
                </div>
              </div>

              <div className="fam-stack">
                <div className="fam-row wz-row--school">
                  <div className="fam-field">
                    <label htmlFor="wz-region" className="fam-label">
                      {t.regionLabel}
                    </label>
                    <select
                      id="wz-region"
                      className="fam-select"
                      value={form.regionId}
                      aria-invalid={tried1 && missing.regionId}
                      aria-describedby="wz-region-cap"
                      onChange={(e) => set('regionId')(e.target.value)}
                    >
                      <option value="" disabled>
                        {t.regionPick}
                      </option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {regionName(r, locale)}
                        </option>
                      ))}
                    </select>
                    {tried1 && missing.regionId && <span className="fam-caption fam-caption--bad">{t.required}</span>}
                  </div>
                  <div className="fam-field">
                    <label htmlFor="wz-school" className="fam-label">
                      {t.schoolLabel} <span className="wz-optional">({t.optional})</span>
                    </label>
                    <select
                      id="wz-school"
                      className="fam-select"
                      value={form.schoolId}
                      disabled={schools.status !== 'ok'}
                      aria-busy={schools.status === 'loading'}
                      onChange={(e) => set('schoolId')(e.target.value)}
                    >
                      <option value="">
                        {schools.status === 'idle'
                          ? t.schoolFirstRegion
                          : schools.status === 'loading'
                            ? t.schoolLoading
                            : t.schoolPick}
                      </option>
                      {schoolList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.district ? `${s.name} · ${s.district}` : s.name}
                        </option>
                      ))}
                      {schools.status === 'ok' && <option value="none">{t.schoolNotListed}</option>}
                    </select>
                    {schools.status === 'ok' && schools.list.length === 0 && (
                      <span className="fam-caption">{t.schoolEmpty}</span>
                    )}
                    {schools.status === 'error' && (
                      <span className="fam-caption fam-caption--bad" role="alert">
                        {t.schoolError}{' '}
                        <button type="button" className="wz-linkBtn" onClick={() => setSchoolsAttempt((n) => n + 1)}>
                          {t.schoolRetry}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                <p id="wz-region-cap" className="fam-caption">
                  <Icon name="pin" size={14} strokeWidth={1.8} />
                  {t.regionCap}
                </p>
              </div>

              <div className="wz-footer">
                <Link href={`/${locale}/family`} className="fam-btn fam-btn--quiet">
                  {t.cancel}
                </Link>
                <span className="wz-hint" aria-live="polite">
                  {dobBlocks ? t.dobHint : tried1 && !step1Valid ? t.s1Hint : ''}
                </span>
                <button
                  type="button"
                  className={step1Valid ? 'fam-btn fam-btn--primary wz-cta' : 'fam-btn fam-btn--primary wz-cta wz-cta--blocked'}
                  aria-disabled={!step1Valid}
                  onClick={next1}
                >
                  {t.next}
                </button>
              </div>
            </section>
          )}

          {view.kind === 'access' && (
            <section className="fam-panel wz-card" aria-labelledby="wz-h">
              <header>
                <h2 id="wz-h" ref={headingRef} tabIndex={-1} className="fam-panel__title">
                  {t.s2Title}
                </h2>
                <p className="fam-panel__sub">{t.s2Sub}</p>
              </header>

              {activeInvite ? (
                <div className="wz-invite">
                  <div className="wz-invite__who">
                    <Avatar name={activeInvite.educatorName} tone="teal" />
                    <div className="fam-person__body">
                      <span className="fam-person__name">{activeInvite.educatorName}</span>
                      <span className="fam-person__desc">{t.invFrom}</span>
                    </div>
                    <span className="fam-tag fam-tag--teal">
                      {t.invRole} · <span className="mono">{activeInvite.publicCode}</span>
                    </span>
                  </div>
                  <div className="wz-share">
                    <div className="wz-share__text">
                      <span id="wz-share-label" className="wz-share__label">
                        {fill(t.shareLabel, {
                          name: nameForCopy,
                          educator: activeInvite.educatorName,
                          date: formatDate(activeInvite.validUntil, locale),
                        })}
                      </span>
                      <span className="fam-person__desc" aria-live="polite">
                        {fill(share ? t.shareOn : t.shareOff, {
                          name: nameForCopy,
                          educator: activeInvite.educatorName,
                        })}
                      </span>
                    </div>
                    <Toggle
                      checked={share}
                      label={fill(t.shareLabel, {
                        name: nameForCopy,
                        educator: activeInvite.educatorName,
                        date: formatDate(activeInvite.validUntil, locale),
                      })}
                      onChange={setShare}
                    />
                  </div>
                  <p className="fam-caption">
                    <Icon name="bell" size={14} strokeWidth={1.8} />
                    {t.shareNoteAll}
                  </p>
                </div>
              ) : (
                <div className="wz-invite wz-invite--none">
                  <span className="wz-invite__icon">
                    <Icon name="user" size={20} />
                  </span>
                  <div className="fam-person__body">
                    <strong className="wz-invite__title">{t.noTutorT}</strong>
                    <span className="fam-person__desc">{fill(t.noTutorB, { name: nameForCopy })}</span>
                  </div>
                </div>
              )}

              <fieldset className="wz-consents">
                <legend className="wz-overline">{t.consOver}</legend>
                {(['data_processing', 'third_party_transfer', 'marketing'] as const).map((type) => {
                  const required = type === 'data_processing';
                  const missingRequired = required && tried2 && !consents.data_processing;
                  return (
                    <label key={type} className="fam-check">
                      <input
                        type="checkbox"
                        checked={consents[type]}
                        aria-invalid={missingRequired || undefined}
                        aria-describedby={`wz-c-${type}`}
                        onChange={(e) => {
                          const given = e.target.checked;
                          setConsents((c) => ({ ...c, [type]: given }));
                        }}
                      />
                      <span className="fam-person__body">
                        <span className="fam-person__name">
                          {fam.consent[type].title}
                          <span className={required ? 'fam-tag fam-tag--brand' : 'fam-tag'}>
                            {required ? fam.consent.required : fam.consent.optional}
                          </span>
                        </span>
                        <span id={`wz-c-${type}`} className="fam-person__desc">
                          {fam.consent[type].desc}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <p className="fam-caption">{t.consNote}</p>
              </fieldset>

              {formError && (
                <p className="fam-alert" role="alert">
                  {formError}
                </p>
              )}

              <div className="wz-footer">
                <button type="button" className="fam-btn" onClick={() => setView({ kind: 'details' })}>
                  <Icon name="arrowLeft" size={18} />
                  {t.back}
                </button>
                <span className="wz-hint" aria-live="polite">
                  {!consents.data_processing ? t.reqHint : ''}
                </span>
                <button
                  type="button"
                  className={
                    consents.data_processing
                      ? 'fam-btn fam-btn--primary wz-cta'
                      : 'fam-btn fam-btn--primary wz-cta wz-cta--blocked'
                  }
                  aria-disabled={!consents.data_processing}
                  onClick={next2}
                >
                  {fill(t.addCta, { name: nameForCopy })}
                </button>
              </div>
            </section>
          )}

          {view.kind === 'sending' && (
            <section className="fam-panel wz-card" aria-busy="true">
              <div className="wz-loading" role="status">
                <span className="wz-loading__spin spin" aria-hidden="true" />
                <div className="fam-stack" style={{ ['--gap' as string]: '2px' }}>
                  <strong>{t.ldTitle}</strong>
                  <span className="fam-muted fam-small">{t.ldSub}</span>
                </div>
              </div>
              <div className="skel" style={{ height: 48, borderRadius: 30 }} />
              <div className="skel" style={{ height: 72 }} />
              <div className="skel" style={{ height: 72 }} />
              <div className="skel" style={{ height: 72 }} />
            </section>
          )}

          {view.kind === 'failed' && (
            <section className="fam-panel wz-card wz-failed" role="alert" aria-labelledby="wz-h">
              <span className="wz-hero__icon wz-hero__icon--danger">
                <Icon name="alert" size={22} />
              </span>
              <div className="fam-stack" style={{ ['--gap' as string]: '6px', flex: 1 }}>
                <h2 id="wz-h" ref={headingRef} tabIndex={-1} className="fam-panel__title">
                  {t.errTitle}
                </h2>
                <p className="card__body">{t.errBody}</p>
              </div>
              <div className="fam-inline">
                <button type="button" className="fam-btn" onClick={() => setView({ kind: 'access' })}>
                  {t.errEdit}
                </button>
                <button type="button" className="fam-btn fam-btn--primary" onClick={() => void submit()}>
                  {fam.common.retry}
                </button>
              </div>
            </section>
          )}

          {view.kind === 'done' && (
            <Done
              t={t}
              fam={fam}
              locale={locale}
              summary={view.summary}
              ownerName={ownerName}
              headingRef={headingRef}
              onAnother={restart}
            />
          )}

          {view.kind === 'duplicate' && (
            <Duplicate
              t={t}
              fam={fam}
              caseId={view.caseId}
              headingRef={headingRef}
              onOpened={(reference, phone) => setView({ kind: 'disputed', reference, phone, caseId: view.caseId })}
              onRecheck={() => setView({ kind: 'details' })}
            />
          )}

          {view.kind === 'disputed' && (
            <>
              <Disputed t={t} locale={locale} reference={view.reference} phone={view.phone} headingRef={headingRef} />
              {view.caseId && <FollowDispute caseId={view.caseId} locale={locale} />}
            </>
          )}

          {view.kind === 'review' && (
            <Review t={t} locale={locale} reference={view.reference} phone={view.phone} headingRef={headingRef} />
          )}

          {view.kind === 'linked' && <Linked t={t} locale={locale} headingRef={headingRef} />}
        </div>

        <WhyWeAsk t={t} />
      </div>
    </div>
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="fam-field">
      <label htmlFor={id} className="fam-label">
        {label}
        {hint && <span className="wz-optional"> ({hint})</span>}
      </label>
      <input
        id={id}
        className="fam-input"
        value={value}
        maxLength={120}
        // A child's names: the browser would otherwise offer the parent's own.
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-err`} className="fam-caption fam-caption--bad">
          {error}
        </span>
      )}
    </div>
  );
}
