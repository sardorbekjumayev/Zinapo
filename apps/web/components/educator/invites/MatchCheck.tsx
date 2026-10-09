'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi, EducatorApiError } from '@/lib/educator-api';
import type { AccessRequestResult, MatchLimits, MatchResult } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { InvitesMessages } from '@/messages/invites';
import { INVITE_BY_PHONE_EVENT } from './InviteComposer';
import { errorText, tashkentTime } from './shared';

type Found = Extract<MatchResult, { match: true }>;
type Outcome = { kind: 'match'; found: Omit<Found, 'limits'> } | { kind: 'nomatch' } | null;

/**
 * design/10 "Child already registered?" (task.md § 8.4.2). PINFL + family name
 * → match or not, nothing more. The PINFL is cleared after every check and
 * never leaves this component's input: the inputs carry no `name`, so even a
 * submit before hydration cannot put it in a URL.
 */
export function MatchCheck({
  locale,
  m,
  initialLimits,
}: {
  locale: Locale;
  m: InvitesMessages;
  initialLimits: MatchLimits | null;
}) {
  const t = m.match;
  const [limits, setLimits] = useState<MatchLimits | null>(initialLimits);
  const [pinfl, setPinfl] = useState('');
  const [family, setFamily] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [requested, setRequested] = useState<AccessRequestResult | null>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A failed first read: try once more from the browser.
  useEffect(() => {
    if (initialLimits) return;
    educatorApi.matchLimits().then(setLimits, () => {});
  }, [initialLimits]);

  // A pause ends on its own; re-read the limits when it does.
  const pausedUntil = limits?.pausedUntil ?? null;
  useEffect(() => {
    if (!pausedUntil) return;
    const ms = new Date(pausedUntil).getTime() - Date.now();
    const id = setTimeout(
      () => {
        setNow(Date.now());
        educatorApi.matchLimits().then(setLimits, () => {});
      },
      Math.max(0, ms) + 1000,
    );
    return () => clearTimeout(id);
  }, [pausedUntil]);

  const paused = pausedUntil !== null && new Date(pausedUntil).getTime() > now;
  const atLimit = !!limits && limits.used >= limits.limit;
  const blocked = paused || atLimit;

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked || busy) return;
    const digits = pinfl.replace(/\D/g, '');
    setError(null);
    setOutcome(null);
    setRequested(null);
    if (digits.length !== 14) {
      setPinfl('');
      setError(t.errors.PINFL_INVALID);
      return;
    }
    if (!family.trim()) {
      setError(t.errors.FAMILY_NAME_REQUIRED);
      return;
    }
    setBusy(true);
    try {
      const res = await educatorApi.matchCheck(digits, family.trim());
      setLimits(res.limits);
      setNow(Date.now());
      if (res.match) {
        const { limits: _l, ...found } = res;
        void _l;
        setOutcome({ kind: 'match', found });
      } else {
        setOutcome({ kind: 'nomatch' });
      }
    } catch (err) {
      if (err instanceof EducatorApiError && err.code === 'MATCH_CHECK_PAUSED') {
        const until = typeof err.details.until === 'string' ? err.details.until : null;
        setLimits((l) => (l ? { ...l, pausedUntil: until } : l));
        setNow(Date.now());
      } else if (err instanceof EducatorApiError && err.code === 'MATCH_CHECK_LIMIT') {
        setLimits((l) => (l ? { ...l, used: l.limit } : l));
      } else {
        setError(errorText(err, t.errors, m.common.errors));
      }
    } finally {
      // § 8.4.2: the PINFL does not outlive the check.
      setPinfl('');
      setBusy(false);
    }
  };

  const request = async (matchToken: string) => {
    setReqBusy(true);
    setError(null);
    try {
      setRequested(await educatorApi.requestAccess(matchToken));
    } catch (err) {
      if (err instanceof EducatorApiError && err.code === 'MATCH_TOKEN_INVALID') setOutcome(null);
      setError(errorText(err, t.errors, m.common.errors));
    } finally {
      setReqBusy(false);
    }
  };

  const used = limits?.used ?? 0;
  const max = limits?.limit ?? 25;
  const full = used >= max;
  const label = busy
    ? t.checking
    : paused && pausedUntil
      ? fill(t.wait, { time: tashkentTime(pausedUntil) })
      : atLimit
        ? t.limitBtn
        : t.check;

  return (
    <section className="fam-panel iv-panel" aria-labelledby="iv-match-title">
      <div>
        <h2 id="iv-match-title" className="fam-panel__title">
          {t.title}
        </h2>
        <p className="fam-panel__sub">{t.sub}</p>
      </div>

      <form className="fam-stack" style={{ '--gap': '16px' } as React.CSSProperties} onSubmit={check} noValidate>
        <div className="iv-matchRow">
          <div className="fam-field">
            <label htmlFor="iv-pinfl" className="fam-label">
              {t.pinfl}
            </label>
            <input
              id="iv-pinfl"
              className="fam-input fam-input--mono"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              maxLength={14}
              placeholder={t.pinflHint}
              value={pinfl}
              disabled={blocked}
              onChange={(e) => setPinfl(e.target.value.replace(/\D/g, '').slice(0, 14))}
            />
          </div>
          <div className="fam-field">
            <label htmlFor="iv-family" className="fam-label">
              {t.family}
            </label>
            <input
              id="iv-family"
              className="fam-input"
              autoComplete="off"
              spellCheck={false}
              value={family}
              disabled={blocked}
              onChange={(e) => setFamily(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="fam-btn fam-btn--primary iv-wide" disabled={blocked || busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {label}
        </button>
      </form>

      <div aria-live="polite" className="fam-stack" style={{ '--gap': '12px' } as React.CSSProperties}>
        {error && (
          <p className="fam-alert" role="alert">
            {error}
          </p>
        )}

        {paused && pausedUntil ? (
          <div className="iv-result iv-result--warn">
            <Icon name="clock" size={20} />
            <div>
              <strong>{t.pausedT}</strong>
              <p>{fill(t.pausedD, { time: tashkentTime(pausedUntil) })}</p>
            </div>
          </div>
        ) : atLimit ? (
          <div className="iv-result iv-result--warn">
            <Icon name="ban" size={20} />
            <div>
              <strong>{t.limitT}</strong>
              <p>{fill(t.limitD, { limit: max })}</p>
            </div>
          </div>
        ) : null}

        {outcome?.kind === 'match' && (
          <div className="iv-result iv-result--ok">
            <Icon name="check" size={20} />
            <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <strong>
                {t.matchLbl} · <span className="mono">{outcome.found.maskedName}</span>
              </strong>
              {outcome.found.existingLink === 'active' ? (
                <p>{t.linkActive}</p>
              ) : outcome.found.existingLink === 'requested' ? (
                <p>{t.linkRequested}</p>
              ) : outcome.found.existingLink === 'suspended' ? (
                <p>{t.linkSuspended}</p>
              ) : requested ? (
                <>
                  <p className="iv-result__strong">
                    {fill(t.requestedT, { date: formatDate(requested.expiresAt, locale, false) })}
                  </p>
                  <p>{t.requestedNote}</p>
                </>
              ) : (
                <>
                  <p>{t.matchD}</p>
                  <button
                    type="button"
                    className="fam-btn fam-btn--primary fam-btn--sm iv-start"
                    disabled={reqBusy}
                    aria-busy={reqBusy}
                    onClick={() => request(outcome.found.matchToken)}
                  >
                    {reqBusy && <span className="spinner" aria-hidden="true" />}
                    {reqBusy ? t.requesting : t.request}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {outcome?.kind === 'nomatch' && !paused && (
          <div className="iv-result">
            <Icon name="info" size={20} />
            <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <strong>{t.noMatchT}</strong>
              <p>{t.noMatchD}</p>
              {limits && (
                <p className="iv-result__strong">
                  {fill(t.misses, { n: limits.missesInRow, max: limits.missesBeforePause })}
                </p>
              )}
              <button
                type="button"
                className="fam-btn fam-btn--sm iv-start"
                onClick={() => window.dispatchEvent(new Event(INVITE_BY_PHONE_EVENT))}
              >
                <Icon name="mail" size={16} />
                {t.invitePhone}
              </button>
            </div>
          </div>
        )}
      </div>

      <hr className="fam-divider" />
      <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        <div className="iv-meterHead">
          <span className="fam-label">{t.checks}</span>
          <span className={full ? 'iv-meterNum iv-meterNum--full' : 'iv-meterNum'}>
            {fill(t.checksOf, { n: used, limit: max })}
          </span>
        </div>
        <div
          className="iv-meter"
          role="progressbar"
          aria-label={t.checks}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={used}
        >
          <span
            className={full ? 'iv-meter__fill iv-meter__fill--full' : 'iv-meter__fill'}
            style={{ width: `${Math.min(100, Math.round((used / max) * 100))}%` }}
          />
        </div>
        <p className="fam-small fam-muted">{t.checksNote}</p>
      </div>
    </section>
  );
}
