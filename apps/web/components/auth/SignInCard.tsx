'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, start as apiStart, verify as apiVerify } from '@/lib/auth-api';
import { fill, Locale, Messages } from '@/lib/i18n';
import { formatFull, isComplete, toE164 } from '@/lib/phone';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { useLoginStatus } from '@/hooks/useLoginStatus';
import { PhoneInput } from './PhoneInput';
import { OtpInput } from './OtpInput';
import { TelegramButton } from './TelegramButton';
import { DeepLinkQr } from './DeepLinkQr';
import { InviteBanner } from './InviteBanner';

type Step = 'phone' | 'code' | 'done';

interface Props {
  locale: Locale;
  messages: Messages;
  invite?: { name: string; code: string } | null;
  /** Where to go after sign-in — a same-locale path, already checked by the page. */
  next?: string | null;
}

export function SignInCard({ locale, messages, invite, next }: Props) {
  const t = messages.signIn;
  const router = useRouter();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: pollStatus } = useLoginStatus(step === 'code' ? requestId : null);
  const secondsLeft = useCountdown(pollStatus?.codeExpiresAt ?? null);

  const describe = useCallback(
    (err: ApiError): string => {
      switch (err.code) {
        case 'PHONE_INVALID':
        case 'VALIDATION_FAILED':
          return t.phoneInvalid;
        case 'RATE_LIMITED':
          return fill(t.rateLimited, { n: err.retryAfter ?? 60 });
        case 'CODE_INVALID':
          return fill(t.codeInvalid, { n: err.attemptsLeft ?? 0 });
        case 'CODE_EXPIRED':
          return t.codeExpired;
        case 'LOCKED':
          return t.locked;
        case 'REQUEST_EXPIRED':
          return t.requestExpired;
        case 'PHONE_MISMATCH':
          return t.mismatch;
        case 'BROWSER_MISMATCH':
          return t.browserMismatch;
        default:
          return t.networkError;
      }
    },
    [t],
  );

  // The bot can end the request while the user is staring at the code boxes.
  const terminalMessage = useMemo((): string | null => {
    switch (pollStatus?.status) {
      case 'PHONE_MISMATCH':
        return t.mismatch;
      case 'LOCKED':
        return t.locked;
      case 'CANCELLED':
        return t.cancelled;
      case 'EXPIRED':
        return t.requestExpired;
      default:
        return null;
    }
  }, [pollStatus?.status, t]);

  const handleStart = async (): Promise<void> => {
    if (!isComplete(phone) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiStart(toE164(phone), locale);
      setRequestId(response.requestId);
      setDeepLink(response.deepLink);
      setCode('');
      setStep('code');
    } catch (err) {
      setError(describe(err instanceof ApiError ? err : new ApiError('NETWORK', 0)));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = useCallback(
    async (fullCode: string): Promise<void> => {
      if (!requestId || busy) return;
      setBusy(true);
      setError(null);
      try {
        await apiVerify(requestId, fullCode);
        setStep('done');
        router.replace(next ?? `/${locale}/dashboard`);
        router.refresh();
      } catch (err) {
        const apiError = err instanceof ApiError ? err : new ApiError('NETWORK', 0);
        setError(describe(apiError));
        setCode('');
      } finally {
        setBusy(false);
      }
    },
    [requestId, busy, router, locale, describe, next],
  );

  const restart = (): void => {
    setStep('phone');
    setRequestId(null);
    setDeepLink(null);
    setCode('');
    setError(null);
  };

  // A fresh code from the bot clears whatever the previous one left behind.
  useEffect(() => {
    if (pollStatus?.codeExpiresAt) setError(null);
  }, [pollStatus?.codeExpiresAt]);

  // An expired code is not an expired request — the bot can issue a new one.
  useEffect(() => {
    if (step === 'code' && pollStatus?.status === 'CODE_SENT' && secondsLeft === 0) {
      setError(t.codeExpired);
    }
  }, [step, pollStatus?.status, secondsLeft, t.codeExpired]);

  const codeReady = pollStatus?.status === 'CODE_SENT' && secondsLeft > 0;
  const shownError = error ?? terminalMessage;

  return (
    <section className="auth" aria-labelledby="auth-title">
      {invite && (
        <InviteBanner name={invite.name} code={invite.code} messages={messages} />
      )}

      {step === 'phone' && (
        <>
          <p className="eyebrow">{t.kicker}</p>
          <h1 className="auth__title" id="auth-title">
            {t.title}
          </h1>
          <p className="auth__subtitle">{t.subtitle}</p>

          <PhoneInput
            value={phone}
            onChange={setPhone}
            label={t.phoneLabel}
            invalid={!!error}
            disabled={busy}
            onEnter={handleStart}
          />
          <p className="field__hint">{t.phoneHint}</p>

          {shownError && (
            <p className="strip strip--error" role="alert" style={{ marginTop: 16 }}>
              {shownError}
            </p>
          )}

          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: 20 }}
            onClick={handleStart}
            disabled={!isComplete(phone) || busy}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? t.sending : t.sendCode}
          </button>

          <p className="legal">{t.legal}</p>
        </>
      )}

      {step === 'code' && (
        <>
          <p className="eyebrow">{t.codeKicker}</p>
          <h1 className="auth__title" id="auth-title">
            {t.codeTitle}
          </h1>
          <p className="auth__subtitle">
            {fill(t.codeSubtitle, { phone: formatFull(phone) })}
          </p>

          {!codeReady && !terminalMessage && (
            <>
              <p className="strip strip--info">
                <span className="spinner" aria-hidden="true" />
                {pollStatus?.status === 'TG_LINKED' ? t.waitingContact : t.waitingLink}
              </p>
              {deepLink && <TelegramButton deepLink={deepLink} label={t.getCode} />}
              <p className="field__hint" style={{ textAlign: 'center' }}>
                {t.getCodeHint}
              </p>
              {deepLink && <DeepLinkQr value={deepLink} label={t.qrLabel} />}
            </>
          )}

          {codeReady && (
            <>
              <p className="strip strip--ok" role="timer" aria-live="off">
                {fill(t.codeValid, { time: mmss(secondsLeft) })}
              </p>
              <OtpInput
                value={code}
                onChange={setCode}
                onComplete={handleVerify}
                label={t.enterCode}
                invalid={!!error}
                disabled={busy}
                autoFocus
              />
              {busy && (
                <p className="strip strip--info">
                  <span className="spinner" aria-hidden="true" />
                  {t.verifying}
                </p>
              )}
            </>
          )}

          {shownError && (
            <p className="strip strip--error" role="alert">
              {shownError}
            </p>
          )}

          <div className="auth__footerActions">
            <button type="button" className="btn btn--ghost" onClick={restart}>
              {terminalMessage ? t.restart : t.changeNumber}
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <p className="strip strip--ok" role="status">
          {t.success}
        </p>
      )}
    </section>
  );
}
