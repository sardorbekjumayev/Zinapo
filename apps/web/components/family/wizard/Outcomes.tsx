'use client';

import { useState, type RefObject } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/family/Avatar';
import { Icon, type IconName } from '@/components/shell/Icon';
import { FamilyApiError, familyApi } from '@/lib/family-api';
import type { ConsentType } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { FamilyMessages } from '@/messages/family';
import type { WizardMessages } from '@/messages/wizard';

/**
 * Everything the wizard can end in (design/02): the child is added, the PINFL
 * is already registered (→ dispute), a fifth child (→ manual review), or the
 * parent already co-guards this child. None of these screens has the PINFL.
 */

export interface DoneSummary {
  id: string;
  alreadyYours: boolean;
  givenName: string;
  fullName: string;
  grade: number;
  schoolName: string | null;
  regionName: string;
  consents: Record<ConsentType, boolean>;
  /** Who invited — null when the parent did not arrive from an invite. */
  educatorName: string | null;
  sharedUntil: string | null;
}

type Heading = RefObject<HTMLHeadingElement | null>;

function Hero({
  icon,
  tone,
  overline,
  title,
  body,
  headingRef,
  chip,
  aside,
}: {
  icon: IconName;
  tone: 'ok' | 'warn' | 'brand';
  overline?: string;
  title: string;
  body: string;
  headingRef: Heading;
  chip?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="wz-hero">
      <span className={`wz-hero__icon wz-hero__icon--${tone}`}>
        <Icon name={icon} size={26} strokeWidth={tone === 'ok' ? 2 : 1.5} />
      </span>
      <div className="wz-hero__text" role="status">
        {(overline || chip) && (
          <span className="fam-inline" style={{ ['--gap' as string]: '10px' }}>
            {overline && <span className={`wz-overline wz-overline--${tone}`}>{overline}</span>}
            {chip}
          </span>
        )}
        <h2 ref={headingRef} tabIndex={-1} className="wz-hero__title">
          {title}
        </h2>
        <p className="card__body">{body}</p>
      </div>
      {aside}
    </div>
  );
}

function Reference({ label, value }: { label: string; value: string }) {
  return (
    <span className="wz-ref">
      <span className="fam-small fam-muted">{label}</span>
      <span className="wz-ref__chip mono">{value}</span>
    </span>
  );
}

function Numbered({ items, tone }: { items: string[]; tone: 'brand' | 'plain' }) {
  return (
    <ol className={tone === 'brand' ? 'wz-numbered wz-numbered--brand' : 'wz-numbered'}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------- done

export function Done({
  t,
  fam,
  locale,
  summary: s,
  ownerName,
  headingRef,
  onAnother,
}: {
  t: WizardMessages;
  fam: FamilyMessages;
  locale: Locale;
  summary: DoneSummary;
  ownerName: string;
  headingRef: Heading;
  onAnother: () => void;
}) {
  const grade = fam.grade[String(s.grade) as keyof typeof fam.grade];
  const consents = [
    t.sumC1,
    s.consents.third_party_transfer ? t.sumC2yes : t.sumC2no,
    s.consents.marketing ? t.sumC3yes : t.sumC3no,
  ].join(' · ');
  const rows: [string, string][] = [
    [t.sumChild, `${s.fullName} · ${grade}`],
    [t.sumSchool, `${s.schoolName ?? t.sumSchoolNone} · ${s.regionName}`],
    [t.sumPinfl, t.sumPinflV],
    [t.sumCons, consents],
  ];

  return (
    <section className="fam-panel wz-card">
      <Hero
        icon="check"
        tone="ok"
        title={fill(t.doneTitle, { name: s.givenName })}
        body={t.doneSub}
        headingRef={headingRef}
      />
      {s.alreadyYours && (
        <p className="fam-note fam-note--brand">
          <Icon name="info" size={18} />
          {t.doneAlready}
        </p>
      )}

      <dl className="wz-sum">
        {rows.map(([k, v]) => (
          <div key={k} className="wz-sum__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="fam-stack">
        <h3 className="wz-overline">{t.accOver}</h3>
        <div className="fam-people">
          <div className="fam-person">
            <Avatar name={ownerName} />
            <div className="fam-person__body">
              <span className="fam-person__name">
                {ownerName}
                <span className="fam-tag fam-tag--brand">{fam.role.me}</span>
              </span>
              <span className="fam-person__desc">{t.accOwner}</span>
            </div>
          </div>
          {s.educatorName && (
            <div className="fam-person">
              <Avatar name={s.educatorName} tone="teal" />
              <div className="fam-person__body">
                <span className="fam-person__name">{s.educatorName}</span>
                <span className={s.sharedUntil ? 'fam-person__desc wz-okText' : 'fam-person__desc'}>
                  {s.sharedUntil
                    ? fill(t.accShareOn, { date: formatDate(s.sharedUntil, locale) })
                    : t.accShareOff}
                </span>
              </div>
            </div>
          )}
        </div>
        {!s.educatorName && <p className="fam-person__desc">{t.accNoTutor}</p>}
      </div>

      <div className="fam-note fam-note--brand">
        <Icon name="calendar" size={22} />
        <div>
          <strong>{t.nextT}</strong>
          <span className="fam-muted">{fill(t.nextB, { name: s.givenName, grade })}</span>
        </div>
      </div>

      <div className="fam-inline" style={{ ['--gap' as string]: '12px' }}>
        <Link href={`/${locale}/family/children/${s.id}`} className="fam-btn fam-btn--primary wz-cta">
          {fill(t.openPage, { name: s.givenName })}
        </Link>
        <button type="button" className="fam-btn wz-cta" onClick={onAnother}>
          <Icon name="plus" size={18} />
          {t.addAnother}
        </button>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- duplicate

export function Duplicate({
  t,
  fam,
  caseId,
  headingRef,
  onOpened,
  onRecheck,
}: {
  t: WizardMessages;
  fam: FamilyMessages;
  caseId: string;
  headingRef: Heading;
  onOpened: (reference: string, phone: string) => void;
  onRecheck: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDispute() {
    setBusy(true);
    setError(null);
    try {
      const res = await familyApi.confirmDispute(caseId);
      onOpened(res.reference, res.phone);
    } catch (e) {
      const network = e instanceof FamilyApiError && e.code === 'NETWORK';
      setError(network ? fam.common.networkError : fam.common.genericError);
      setBusy(false);
    }
  }

  return (
    <section className="fam-panel wz-card">
      <Hero
        icon="users"
        tone="warn"
        overline={t.dupOver}
        title={t.dupTitle}
        body={t.dupBody}
        headingRef={headingRef}
      />
      <div className="wz-box">
        <strong>{t.dupIfT}</strong>
        <Numbered items={[t.dupIf1, t.dupIf2]} tone="plain" />
      </div>
      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
      <div className="fam-inline" style={{ ['--gap' as string]: '12px' }}>
        <button
          type="button"
          className="fam-btn fam-btn--primary wz-cta"
          onClick={() => void openDispute()}
          disabled={busy || !caseId}
          aria-busy={busy}
        >
          {busy && <span className="spinner" aria-hidden="true" />}
          {t.dupCta}
        </button>
        <button type="button" className="fam-btn wz-cta" onClick={onRecheck} disabled={busy}>
          {t.dupBack}
        </button>
      </div>
    </section>
  );
}

// --------------------------------------------------------------- disputed

export function Disputed({
  t,
  locale,
  reference,
  phone,
  headingRef,
}: {
  t: WizardMessages;
  locale: Locale;
  reference: string;
  phone: string;
  headingRef: Heading;
}) {
  return (
    <section className="fam-panel wz-card">
      <Hero
        icon="shield"
        tone="brand"
        overline={t.dispOver}
        title={t.dispTitle}
        body={fill(t.dispBody, { phone })}
        headingRef={headingRef}
        aside={<Reference label={t.dispNum} value={reference} />}
      />
      <div className="wz-box">
        <Numbered items={[t.disp1, t.disp2, t.disp3]} tone="brand" />
      </div>
      <Link href={`/${locale}/family`} className="fam-btn fam-btn--primary wz-cta" style={{ alignSelf: 'flex-start' }}>
        {t.toChildren}
      </Link>
    </section>
  );
}

// ----------------------------------------------------------------- review

export function Review({
  t,
  locale,
  reference,
  phone,
  headingRef,
}: {
  t: WizardMessages;
  locale: Locale;
  reference: string;
  phone: string;
  headingRef: Heading;
}) {
  const rows: [string, string][] = [
    [t.revTimeT, t.revTimeV],
    [t.revHowT, fill(t.revHowV, { phone })],
    [t.revDataT, t.revDataV],
  ];
  return (
    <section className="fam-panel wz-card">
      <Hero
        icon="clock"
        tone="brand"
        overline={t.revOver}
        chip={<span className="fam-tag fam-tag--warn">{t.revChip}</span>}
        title={t.revTitle}
        body={t.revBody}
        headingRef={headingRef}
        aside={reference ? <Reference label={t.dispNum} value={reference} /> : undefined}
      />
      <dl className="wz-sum">
        {rows.map(([k, v]) => (
          <div key={k} className="wz-sum__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/${locale}/family`} className="fam-btn fam-btn--primary wz-cta" style={{ alignSelf: 'flex-start' }}>
        {t.toChildren}
      </Link>
    </section>
  );
}

// ----------------------------------------------------------------- linked

export function Linked({ t, locale, headingRef }: { t: WizardMessages; locale: Locale; headingRef: Heading }) {
  return (
    <section className="fam-panel wz-card">
      <Hero icon="users" tone="brand" title={t.linkedTitle} body={t.linkedBody} headingRef={headingRef} />
      <Link href={`/${locale}/family`} className="fam-btn fam-btn--primary wz-cta" style={{ alignSelf: 'flex-start' }}>
        {t.toChildren}
      </Link>
    </section>
  );
}
