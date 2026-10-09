'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { checkLine, displayPhone, errorText } from '@/components/educator/invites/shared';
import { useAnnounce } from '@/components/staff/review/live';
import { educatorApi } from '@/lib/educator-api';
import type { EducatorKind, Preapproval } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { CasesMessages } from '@/messages/cases';

const KINDS: EducatorKind[] = ['tutor', 'school_teacher', 'learning_centre'];

/**
 * "Pre-approve an educator" (task.md § 8.5): a phone that will be approved
 * the moment its owner applies — or at once, if they already have.
 */
export function Preapprovals({ locale, m, list }: { locale: Locale; m: CasesMessages; list: Preapproval[] }) {
  const t = m.pre;
  const router = useRouter();
  const announce = useAnnounce();
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<EducatorKind>('tutor');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invalid, setInvalid] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = checkLine(phone);
    if (!phone.trim() || !c.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    setMsg(null);
    try {
      const res = await educatorApi.preapprove(c.e164, kind, note.trim() || undefined);
      const text = fill(res.approvedNow ? t.approvedNow : t.done, { phone: displayPhone(res.phone) });
      setMsg({ ok: true, text });
      announce(text);
      setPhone('');
      setNote('');
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, m.errors) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p: Preapproval) => {
    setCancelling(p.id);
    setMsg(null);
    try {
      await educatorApi.cancelPreapproval(p.id);
      announce(fill(t.cancelledMsg, { phone: displayPhone(p.phone) }));
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, m.errors) });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <section className="fam-panel iv-panel" aria-labelledby="iv-pre-title">
      <div>
        <h2 id="iv-pre-title" className="fam-panel__title">
          {t.title}
        </h2>
        <p className="fam-panel__sub">{t.sub}</p>
      </div>
      <form className="fam-stack" style={{ '--gap': '14px' } as React.CSSProperties} onSubmit={submit} noValidate>
        <div className="fam-field">
          <label htmlFor="iv-pre-phone" className="fam-label">
            {t.phone}
          </label>
          <input
            id="iv-pre-phone"
            className="fam-input fam-input--mono"
            inputMode="tel"
            autoComplete="off"
            placeholder="+998 90 123 45 67"
            value={phone}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'iv-pre-phone-err' : undefined}
            onChange={(e) => setPhone(e.target.value)}
          />
          {invalid && (
            <p id="iv-pre-phone-err" className="fam-caption fam-caption--bad">
              {t.v.phone}
            </p>
          )}
        </div>
        <div className="fam-field">
          <label htmlFor="iv-pre-kind" className="fam-label">
            {t.kind}
          </label>
          <select id="iv-pre-kind" className="fam-select" value={kind} onChange={(e) => setKind(e.target.value as EducatorKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {m.kind[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="fam-field">
          <label htmlFor="iv-pre-note" className="fam-label">
            {t.note}
          </label>
          <input
            id="iv-pre-note"
            className="fam-input"
            maxLength={300}
            placeholder={t.notePh}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {busy ? t.submitting : t.submit}
        </button>
      </form>
      {msg && (
        <p className={msg.ok ? 'fam-alert fam-alert--ok' : 'fam-alert'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}

      <hr className="fam-divider" />
      <h3 className="iv-subTitle">{t.listT}</h3>
      {list.length === 0 ? (
        <p className="fam-small fam-muted">{t.listEmpty}</p>
      ) : (
        <ul className="iv-pres">
          {list.map((p) => {
            const state = p.cancelledAt ? 'cancelled' : p.usedAt ? 'used' : 'waiting';
            return (
              <li key={p.id} className="iv-pre">
                <div className="fam-stack" style={{ '--gap': '4px', minWidth: 0 } as React.CSSProperties}>
                  <span className="mono">{displayPhone(p.phone)}</span>
                  <span className="fam-small fam-muted">
                    {m.kind[p.kind]} · {fill(t.meta, { date: formatDate(p.createdAt, locale), by: p.invitedBy })}
                  </span>
                  {p.note && <span className="fam-small">{p.note}</span>}
                </div>
                <div className="iv-pre__side">
                  <span
                    className={
                      state === 'used' ? 'fam-tag fam-tag--ok' : state === 'waiting' ? 'fam-tag fam-tag--warn' : 'fam-tag'
                    }
                  >
                    {state === 'used' ? fill(t.usedBy, { name: p.usedBy ?? '—' }) : state === 'waiting' ? t.waiting : t.cancelled}
                  </span>
                  {state === 'waiting' && (
                    <button
                      type="button"
                      className="fam-btn fam-btn--sm fam-btn--quiet"
                      disabled={cancelling !== null}
                      aria-busy={cancelling === p.id}
                      aria-label={fill(t.cancelLabel, { phone: displayPhone(p.phone) })}
                      onClick={() => cancel(p)}
                    >
                      {cancelling === p.id && <span className="spinner" aria-hidden="true" />}
                      {t.cancel}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
