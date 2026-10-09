'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { InviteSendResult } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { InvitesMessages } from '@/messages/invites';
import { checkLine, errorText } from './shared';

const MAX_LINES = 200;
const SHOWN_BAD = 5;
const TTL_DAYS = 14;

/** MatchCheck's "Invite by phone" asks the composer to take focus. */
export const INVITE_BY_PHONE_EVENT = 'iv:invite-by-phone';

/**
 * design/10 "Invite by phone number": paste a group, see what will be sent,
 * send. The live check mirrors the API's; the counts after sending are the
 * API's own (task.md § 8.4.1).
 */
export function InviteComposer({
  locale,
  m,
  educatorName,
  publicCode,
}: {
  locale: Locale;
  m: InvitesMessages;
  educatorName: string;
  publicCode: string | null;
}) {
  const t = m.bulk;
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: InviteSendResult; until: string } | null>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    const onAsk = () => {
      setResult(null);
      setHint(true);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    };
    window.addEventListener(INVITE_BY_PHONE_EVENT, onAsk);
    return () => window.removeEventListener(INVITE_BY_PHONE_EVENT, onAsk);
  }, []);

  const lines = text.split('\n');
  const check = useMemo(() => {
    const seen = new Set<string>();
    let dup = 0;
    let filled = 0;
    const bad: { index: number; raw: string; why: string }[] = [];
    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      filled += 1;
      const c = checkLine(raw);
      if (!c.ok) bad.push({ index, raw: raw.trim(), why: fill(t.why[c.why], { d: c.digits }) });
      else if (seen.has(c.e164)) dup += 1;
      else seen.add(c.e164);
    });
    return { valid: seen.size, dup, bad, filled };
    // `lines` derives from `text`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, t]);

  const tooMany = check.filled > MAX_LINES;
  const canSend = check.valid > 0 && !tooMany && !busy;

  const removeLine = (index: number) => {
    setText(lines.filter((_, i) => i !== index).join('\n'));
    area.current?.focus();
  };

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const data = await educatorApi.sendInvites(lines.map((l) => l.trim()).filter(Boolean));
      const until = new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString();
      setResult({ data, until });
      setText('');
      setHint(false);
      router.refresh();
    } catch (err) {
      setError(errorText(err, t.errors, m.common.errors));
    } finally {
      setBusy(false);
    }
  };

  const code = publicCode ?? '';
  const smsLink = 'zinapo.uz/invite/…';

  return (
    <section className="fam-panel iv-panel" aria-labelledby="iv-bulk-title">
      <div>
        <h2 id="iv-bulk-title" className="fam-panel__title">
          {t.title}
        </h2>
        <p className="fam-panel__sub">{t.sub}</p>
      </div>

      {result ? (
        <div className="iv-sent" role="status" aria-live="polite">
          <span className={result.data.sent > 0 ? 'iv-sent__icon' : 'iv-sent__icon iv-sent__icon--quiet'}>
            <Icon name={result.data.sent > 0 ? 'check' : 'info'} size={22} />
          </span>
          <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
            <h3 className="iv-sent__title">
              {result.data.sent > 0 ? fill(t.sentT, { n: result.data.sent }) : t.sentNone}
            </h3>
            {result.data.sent > 0 && (
              <p className="fam-small fam-muted">
                {fill(t.sentD, { days: result.data.expiresInDays, date: formatDate(result.until, locale, false) })}
              </p>
            )}
            {(result.data.alreadyInvited > 0 || result.data.duplicates > 0 || result.data.invalid.length > 0) && (
              <div className="iv-tags">
                {result.data.alreadyInvited > 0 && (
                  <span className="fam-tag">{fill(t.sAlready, { n: result.data.alreadyInvited })}</span>
                )}
                {result.data.duplicates > 0 && <span className="fam-tag">{fill(t.sDup, { n: result.data.duplicates })}</span>}
                {result.data.invalid.length > 0 && (
                  <span className="fam-tag fam-tag--danger">{fill(t.sInvalid, { n: result.data.invalid.length })}</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="fam-btn iv-sent__again"
            onClick={() => {
              setResult(null);
              requestAnimationFrame(() => area.current?.focus());
            }}
          >
            <Icon name="plus" size={18} />
            {t.again}
          </button>
        </div>
      ) : (
        <>
          <div className="fam-field">
            <div className="iv-labelRow">
              <label htmlFor="iv-phones" className="fam-label">
                {t.label}
              </label>
              <span id="iv-phones-hint" className="fam-small fam-muted">
                {t.hint}
              </span>
            </div>
            <textarea
              id="iv-phones"
              ref={area}
              className="iv-textarea"
              rows={6}
              value={text}
              placeholder={t.placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-describedby="iv-phones-hint iv-phones-check"
              aria-invalid={check.bad.length > 0 || tooMany}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          {hint && (
            <p className="fam-note fam-note--brand">
              <Icon name="info" size={18} />
              {t.fromMatch}
            </p>
          )}

          <div id="iv-phones-check" className="iv-tags" aria-live="polite">
            {check.valid > 0 && (
              <span className="fam-tag fam-tag--ok">
                <Icon name="check" size={14} />
                {fill(t.valOk, { n: check.valid })}
              </span>
            )}
            {check.dup > 0 && <span className="fam-tag">{fill(t.valDup, { n: check.dup })}</span>}
            {check.bad.length > 0 && (
              <span className="fam-tag fam-tag--danger">{fill(t.valBad, { n: check.bad.length })}</span>
            )}
          </div>

          {tooMany && (
            <p className="fam-alert" role="alert">
              {fill(t.tooMany, { max: MAX_LINES })}
            </p>
          )}

          {check.bad.length > 0 && (
            <ul className="iv-bad">
              {check.bad.slice(0, SHOWN_BAD).map((b) => (
                <li key={b.index} className="iv-bad__row">
                  <Icon name="alert" size={18} />
                  <div className="iv-bad__body">
                    <span className="iv-bad__line">
                      {fill(t.line, { n: b.index + 1 })} · <span className="mono">{b.raw}</span>
                    </span>
                    <span>
                      {b.why} {t.badTail}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm"
                    aria-label={fill(t.removeLabel, { n: b.index + 1 })}
                    onClick={() => removeLine(b.index)}
                  >
                    {t.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="iv-sms">
            <span className="iv-sms__label">{t.smsLabel}</span>
            <p className="iv-sms__text">
              {fill(t.smsText, { name: educatorName, link: smsLink, days: TTL_DAYS })}
            </p>
            {code && <p className="iv-sms__meta">{fill(t.smsMeta, { code })}</p>}
          </div>

          {error && (
            <p className="fam-alert" role="alert">
              {error}
            </p>
          )}

          <div className="iv-actions">
            <button type="button" className="fam-btn fam-btn--primary" disabled={!canSend} aria-busy={busy} onClick={send}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="mail" size={18} />}
              {busy ? t.sending : check.valid > 0 ? fill(t.send, { n: check.valid }) : t.sendNone}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
