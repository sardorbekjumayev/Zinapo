'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { olympiadApi, OlympiadApiError } from '@/lib/olympiad-api';
import type { FamilyStage, VenueOption } from '@/lib/olympiad-types';
import type { OlympiadMessages } from '@/messages/olympiad';
import { sentence, startsLabel } from './util';

/** The landing's `?src=` (task.md § 8.1.6 deep-link attribution), kept by `SrcCookie`. */
function readSource(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)zn_src=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Codes after which the card itself is stale: re-read the page. */
const STALE = new Set(['NOT_ELIGIBLE', 'STAGE_NOT_FOUND', 'VENUE_NOT_FOUND', 'VENUE_FULL', 'STAGE_CLOSED', 'ALREADY_TAKEN', 'ALREADY_CHECKED_IN', 'STAGE_NOT_OPEN', 'ENTRY_TAKEN']);

/**
 * Everything a parent does with one stage: register (online: one tap; in
 * person: venue → accompanying adult → confirm), change venue, cancel, and
 * start or continue an online stage in kid mode. The API re-checks every
 * step; a co-guardian sees the state only (register is owner-only, § 8.2).
 */
export function StageActions({
  childId,
  childName,
  childLine,
  olympiadId,
  stage,
  owner,
  ownerName,
  region,
  marathon = false,
  locale,
  t,
}: {
  childId: string;
  childName: string;
  /** "Madina · Grade 4" for the confirm step. */
  childLine: string;
  olympiadId: string;
  stage: FamilyStage;
  owner: boolean;
  ownerName: string;
  region: string;
  marathon?: boolean;
  locale: Locale;
  t: OlympiadMessages;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [flow, setFlow] = useState<'closed' | 'register' | 'change'>('closed');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const stageName = t.stage.name[stage.kind];
  // Mid-sentence the stage name is lower-case; `sentence` restores a leading capital.
  const stageInline = stageName.toLowerCase();
  const entry = stage.entry;
  const regOpen = stage.state !== 'closed' && new Date(stage.registrationClosesAt).getTime() > Date.now();

  function message(err: unknown): string {
    const code = err instanceof OlympiadApiError ? (err.status === 404 && err.code === 'UNKNOWN' ? 'NOT_FOUND' : err.code) : 'generic';
    const copy = (t.errors as Record<string, string>)[code] ?? t.errors.generic;
    if (STALE.has(code)) router.refresh();
    return fill(copy, { name: childName });
  }

  async function register(venueId: string | null, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await olympiadApi.register(childId, olympiadId, { stageId: stage.id, venueId, source: readSource() });
      setStatus(done);
      setFlow('closed');
      router.refresh();
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId } = await olympiadApi.startOnline(childId, entry.id);
      router.push(`/${locale}/play/${sessionId}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  async function cancel() {
    if (!entry) return;
    setBusy(true);
    setCancelError(null);
    try {
      await olympiadApi.cancel(childId, entry.id);
      setCancelOpen(false);
      setStatus(t.action.cancelled);
      router.refresh();
    } catch (err) {
      setCancelError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const live = (
    <>
      <p className="ol-status" role="status" aria-live="polite">
        {status}
      </p>
      <p className="fam-alert" role="alert" hidden={!error}>
        {error}
      </p>
    </>
  );

  const readOnly = (
    <p className="fam-caption">
      <Icon name="lock" size={14} />
      {t.action.readOnly}
    </p>
  );

  // ---------------------------------------------------------------- not registered
  if (stage.eligibility !== 'registered' || !entry) {
    if (stage.eligibility !== 'ok') {
      const reason = (t.reason as Record<string, string>)[stage.eligibility];
      return (
        <div className="ol-actions">
          {reason && (
            <p className="fam-note">
              <Icon name="info" size={18} />
              {fill(reason, { name: childName })}
            </p>
          )}
          {live}
        </div>
      );
    }
    if (!owner) return <div className="ol-actions">{readOnly}</div>;

    if (!stage.inPerson) {
      return (
        <div className="ol-actions">
          <div className="fam-inline">
            <button
              type="button"
              className="fam-btn fam-btn--primary"
              onClick={() => register(null, t.action.registered)}
              disabled={busy}
              aria-busy={busy}
            >
              {busy && <span className="spinner" aria-hidden="true" />}
              {marathon ? fill(t.marathon.register, { name: childName }) : t.action.register}
            </button>
            <span className="fam-muted fam-small">
              {fill(t.stage.regUntil, { date: formatDate(stage.registrationClosesAt, locale, false) })}
            </span>
          </div>
          {live}
        </div>
      );
    }

    return (
      <div className="ol-actions">
        {flow === 'closed' ? (
          <div className="fam-inline">
            <button type="button" className="fam-btn fam-btn--primary" onClick={() => setFlow('register')}>
              {sentence(fill(t.action.registerFinal, { stage: stageInline }))}
            </button>
            <span className="fam-muted fam-small">
              {fill(t.stage.regUntil, { date: formatDate(stage.registrationClosesAt, locale, false) })}
            </span>
          </div>
        ) : (
          <VenueFlow
            venues={stage.venues}
            current={null}
            childName={childName}
            childLine={childLine}
            ownerName={ownerName}
            region={region}
            busy={busy}
            error={error}
            locale={locale}
            t={t}
            onCancel={() => {
              setFlow('closed');
              setError(null);
            }}
            onConfirm={(venueId) => register(venueId, t.action.registered)}
          />
        )}
        {flow === 'closed' && live}
      </div>
    );
  }

  // ---------------------------------------------------------------- registered
  const session = entry.session;
  const canCancel = owner && !session && !entry.checkedIn && regOpen;

  const cancelDialog = canCancel && (
    <ConfirmDialog
      open={cancelOpen}
      title={sentence(fill(t.action.cancelTitle, { stage: stageInline }))}
      body={fill(stage.inPerson ? t.action.cancelBodyVenue : t.action.cancelBody, { name: childName })}
      confirmLabel={t.action.cancelConfirm}
      cancelLabel={t.common.cancel}
      busy={busy}
      error={cancelError}
      onConfirm={cancel}
      onClose={() => {
        setCancelOpen(false);
        setCancelError(null);
      }}
    />
  );

  const cancelButton = canCancel && (
    <button type="button" className="fam-btn fam-btn--quiet" onClick={() => setCancelOpen(true)} disabled={busy}>
      {t.action.cancel}
    </button>
  );

  if (!stage.inPerson) {
    let line: string;
    let action: React.ReactNode = null;
    if (session?.status === 'submitted') {
      line = entry.resultsPublished ? t.action.takenPublished : t.action.taken;
    } else if (stage.state === 'upcoming') {
      line = fill(t.action.registeredUpcoming, { name: childName, date: formatDate(stage.opensAt, locale, false) });
    } else if (stage.state === 'closed') {
      line = t.action.notTaken;
    } else {
      line = marathon ? t.marathon.registeredBody : fill(t.action.registeredOnline, { name: childName });
      if (owner && (!session || session.status === 'started')) {
        action = (
          <button type="button" className="fam-btn fam-btn--primary" onClick={start} disabled={busy} aria-busy={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="play" size={18} />}
            {session ? t.action.continue : sentence(fill(t.action.start, { stage: stageInline }))}
          </button>
        );
      }
    }

    return (
      <div className="ol-actions">
        <div className="fam-inline">
          <span className={session?.status === 'submitted' ? 'chip chip--success' : 'chip chip--monitoring'}>
            <Icon name="check" size={14} />
            {t.action.registered}
          </span>
          <span className="fam-small">{line}</span>
        </div>
        {action && (
          <div className="ol-actions__start">
            {action}
            <span className="fam-muted fam-small">{fill(t.action.handOver, { name: childName })}</span>
          </div>
        )}
        {cancelButton && <div className="fam-inline">{cancelButton}</div>}
        {!owner && stage.state !== 'closed' && readOnly}
        {live}
        {cancelDialog}
      </div>
    );
  }

  // In person, registered: design/07's "done" state, or the venue change flow.
  if (flow === 'change' && entry.venue) {
    return (
      <div className="ol-actions">
        <VenueFlow
          venues={stage.venues}
          current={entry.venue.id}
          childName={childName}
          childLine={childLine}
          ownerName={ownerName}
          region={region}
          busy={busy}
          error={error}
          locale={locale}
          t={t}
          onCancel={() => {
            setFlow('closed');
            setError(null);
          }}
          onConfirm={(venueId) => register(venueId, t.venue.changed)}
        />
      </div>
    );
  }

  return (
    <div className="ol-actions">
      <div className="ol-done">
        <span className="chip chip--success">
          <Icon name="check" size={14} />
          {t.action.registered}
        </span>
        <h4 className="ol-done__title">{sentence(fill(t.venue.doneTitle, { name: childName, stage: stageInline }))}</h4>
        {entry.venue && (
          <dl className="ol-summary">
            <div>
              <dt>{t.venue.rVenue}</dt>
              <dd>
                {entry.venue.name}
                <span className="fam-muted fam-small">{entry.venue.address}</span>
              </dd>
            </div>
            <div>
              <dt>{t.venue.rDate}</dt>
              <dd>{startsLabel(entry.venue.startsAt, locale, t)}</dd>
            </div>
            <div>
              <dt>{t.venue.rAdult}</dt>
              <dd>{ownerName}</dd>
            </div>
          </dl>
        )}
        {entry.checkedIn ? (
          <p className="fam-caption fam-caption--ok">
            <Icon name="check" size={14} />
            {fill(t.action.checkedIn, { name: childName })}
          </p>
        ) : (
          stage.state !== 'closed' && (
            <>
              <h5 className="ol-done__sub">{t.venue.bringTitle}</h5>
              <ol className="ol-bring">
                <li>{fill(t.venue.bring1, { owner: ownerName })}</li>
                <li>{fill(t.venue.bring2, { name: childName })}</li>
                <li>{t.venue.bring3}</li>
                <li>{t.venue.bring4}</li>
              </ol>
              <p className="fam-note fam-note--brand">
                <Icon name="mail" size={18} />
                {t.venue.sms}
              </p>
            </>
          )
        )}
        {session?.status === 'submitted' && <p className="fam-small">{entry.resultsPublished ? t.action.takenPublished : t.action.taken}</p>}
      </div>
      {canCancel && (
        <div className="fam-inline">
          {stage.venues.length > 1 && (
            <button type="button" className="fam-btn" onClick={() => setFlow('change')} disabled={busy}>
              <Icon name="edit" size={16} />
              {t.venue.change}
            </button>
          )}
          {cancelButton}
        </div>
      )}
      {!owner && stage.state !== 'closed' && readOnly}
      {live}
      {cancelDialog}
    </div>
  );
}

/** Venue → accompanying adult → confirm (design/07 registration form). */
function VenueFlow({
  venues,
  current,
  childName,
  childLine,
  ownerName,
  region,
  busy,
  error,
  locale,
  t,
  onCancel,
  onConfirm,
}: {
  venues: VenueOption[];
  current: string | null;
  childName: string;
  childLine: string;
  ownerName: string;
  region: string;
  busy: boolean;
  error: string | null;
  locale: Locale;
  t: OlympiadMessages;
  onCancel: () => void;
  onConfirm: (venueId: string) => Promise<boolean>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [venueId, setVenueId] = useState<string | null>(current);
  const [pickError, setPickError] = useState(false);
  const chosen = venues.find((v) => v.id === venueId) ?? null;
  const changing = current !== null;

  if (venues.length === 0) {
    return (
      <div className="ol-flow">
        <p className="fam-note">
          <Icon name="info" size={18} />
          {fill(t.venue.none, { region })}
        </p>
        <div className="fam-inline">
          <button type="button" className="fam-btn" onClick={onCancel}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ol-flow">
      <span className="card__kicker">{fill(t.venue.step, { n: step })}</span>

      {step === 1 && (
        <fieldset className="ol-venues" aria-describedby={pickError ? 'ol-venue-err' : undefined}>
          <legend className="ol-flow__title">{t.venue.pickTitle}</legend>
          <p className="fam-muted fam-small">{fill(t.venue.pickSub, { region })}</p>
          {venues.map((v) => {
            const full = v.seatsLeft <= 0 && v.id !== current;
            const on = v.id === venueId;
            return (
              <label key={v.id} className={`ol-venue${on ? ' ol-venue--on' : ''}${full ? ' ol-venue--full' : ''}`}>
                <input
                  type="radio"
                  name="ol-venue"
                  value={v.id}
                  checked={on}
                  disabled={full}
                  onChange={() => {
                    setVenueId(v.id);
                    setPickError(false);
                  }}
                />
                <span className="ol-venue__body">
                  <span className="ol-venue__name">
                    {v.name}
                    {v.id === current && <span className="fam-tag fam-tag--brand">{t.venue.current}</span>}
                  </span>
                  <span className="fam-muted fam-small">{v.address}</span>
                  <span className="fam-small">{startsLabel(v.startsAt, locale, t)}</span>
                </span>
                <span className={full ? 'fam-tag fam-tag--danger' : 'fam-tag'}>
                  {full ? t.venue.full : fill(t.venue.seatsLeft, { n: v.seatsLeft })}
                </span>
              </label>
            );
          })}
          {pickError && (
            <p id="ol-venue-err" className="fam-caption fam-caption--bad" role="alert">
              {t.venue.pickError}
            </p>
          )}
        </fieldset>
      )}

      {step === 2 && (
        <div className="ol-flow__adult">
          <h4 className="ol-flow__title">{fill(t.venue.adultTitle, { name: childName })}</h4>
          <p className="fam-note fam-note--brand">
            <Icon name="shield" size={18} />
            {fill(t.venue.adultBody, { name: childName, owner: ownerName })}
          </p>
        </div>
      )}

      {step === 3 && chosen && (
        <div>
          <h4 className="ol-flow__title">{t.venue.confirmTitle}</h4>
          <dl className="ol-summary">
            <div>
              <dt>{t.venue.rParticipant}</dt>
              <dd>{childLine}</dd>
            </div>
            <div>
              <dt>{t.venue.rVenue}</dt>
              <dd>
                {chosen.name}
                <span className="fam-muted fam-small">{chosen.address}</span>
              </dd>
            </div>
            <div>
              <dt>{t.venue.rDate}</dt>
              <dd>{startsLabel(chosen.startsAt, locale, t)}</dd>
            </div>
            <div>
              <dt>{t.venue.rAdult}</dt>
              <dd>{ownerName}</dd>
            </div>
          </dl>
        </div>
      )}

      <p className="fam-alert" role="alert" hidden={!error}>
        {error}
      </p>

      <div className="fam-inline ol-flow__buttons">
        {step === 1 ? (
          <button type="button" className="fam-btn" onClick={onCancel} disabled={busy}>
            {t.common.cancel}
          </button>
        ) : (
          // From the summary, "Edit" goes back to the venue — the only choice made.
          <button type="button" className="fam-btn" onClick={() => setStep(1)} disabled={busy}>
            <Icon name={step === 3 ? 'edit' : 'arrowLeft'} size={16} />
            {step === 3 ? t.venue.edit : t.venue.back}
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            className="fam-btn fam-btn--primary"
            onClick={() => {
              if (!chosen) {
                setPickError(true);
                return;
              }
              setStep(step === 1 ? 2 : 3);
            }}
          >
            {t.venue.next}
            <Icon name="arrowRight" size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="fam-btn fam-btn--primary"
            disabled={busy || !chosen}
            aria-busy={busy}
            onClick={async () => {
              if (!chosen) return;
              const ok = await onConfirm(chosen.id);
              if (!ok) setStep(1);
            }}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {changing ? t.venue.confirmChange : t.venue.confirm}
          </button>
        )}
      </div>
    </div>
  );
}
