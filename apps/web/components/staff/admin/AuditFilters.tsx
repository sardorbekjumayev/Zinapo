'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { fill, type Locale } from '@/lib/i18n';
import { isComplete, toE164 } from '@/lib/phone';
import type { AdminMessages } from '@/messages/admin';
import { PhoneField } from './PhoneField';
import { nationalDigits } from './shared';

export interface AuditQuery {
  action: string;
  phone: string;
  from: string;
  to: string;
}

/** The audit filters; they live in the URL, and applying them starts again from the newest entry. */
export function AuditFilters({
  m,
  locale,
  actions,
  initial,
}: {
  m: AdminMessages;
  locale: Locale;
  actions: { action: string; n: number }[];
  initial: AuditQuery;
}) {
  const a = m.audit;
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [action, setAction] = useState(initial.action);
  const [digits, setDigits] = useState(() => nationalDigits(initial.phone));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [tried, setTried] = useState(false);

  const groups = new Map<string, number>();
  for (const x of actions) {
    const g = x.action.split('.')[0];
    groups.set(g, (groups.get(g) ?? 0) + x.n);
  }
  // A filter from a shared link that has no entries yet still shows as chosen.
  const unknown = initial.action && !groups.has(initial.action) && !actions.some((x) => x.action === initial.action);
  const phoneBad = tried && digits.length > 0 && !isComplete(digits);
  const datesBad = tried && !!from && !!to && from > to;

  function go(q: AuditQuery) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
    const qs = sp.toString();
    startTransition(() => router.push(`/${locale}/staff/audit${qs ? `?${qs}` : ''}`));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if ((digits.length > 0 && !isComplete(digits)) || (from && to && from > to)) return;
    go({ action, phone: digits ? toE164(digits) : '', from, to });
  }

  function reset() {
    setAction('');
    setDigits('');
    setFrom('');
    setTo('');
    setTried(false);
    go({ action: '', phone: '', from: '', to: '' });
  }

  return (
    <form className="ad-filters" onSubmit={submit} noValidate aria-label={a.filters}>
      <div className="fam-field ad-filters__action">
        <label className="fam-label" htmlFor="ad-audit-action">
          {a.action}
        </label>
        <select id="ad-audit-action" className="fam-select" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{a.allActions}</option>
          {unknown && <option value={initial.action}>{initial.action}</option>}
          <optgroup label={a.groups}>
            {[...groups].map(([g, n]) => (
              <option key={g} value={g}>
                {fill(a.groupFmt, { g })} ({n})
              </option>
            ))}
          </optgroup>
          <optgroup label={a.exact}>
            {actions.map((x) => (
              <option key={x.action} value={x.action}>
                {x.action} ({x.n})
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="ad-filters__phone">
        <PhoneField id="ad-audit-phone" label={a.phone} value={digits} onChange={setDigits} invalid={phoneBad} errorId="ad-audit-phone-err" />
        {phoneBad && (
          <p id="ad-audit-phone-err" className="fam-caption fam-caption--bad">
            {m.common.phoneInvalid}
          </p>
        )}
      </div>
      <div className="fam-field">
        <label className="fam-label" htmlFor="ad-audit-from">
          {a.from}
        </label>
        <input id="ad-audit-from" type="date" className="fam-input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-invalid={datesBad ? 'true' : 'false'} />
      </div>
      <div className="fam-field">
        <label className="fam-label" htmlFor="ad-audit-to">
          {a.to}
        </label>
        <input id="ad-audit-to" type="date" className="fam-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={datesBad ? 'true' : 'false'} />
      </div>
      <div className="ad-filters__buttons">
        <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {a.apply}
        </button>
        <button type="button" className="fam-btn fam-btn--quiet" onClick={reset} disabled={busy}>
          {a.reset}
        </button>
      </div>
      {datesBad && (
        <p className="fam-caption fam-caption--bad ad-filters__err" role="alert">
          {a.datesBad}
        </p>
      )}
    </form>
  );
}
