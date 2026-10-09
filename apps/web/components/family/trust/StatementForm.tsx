'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TrustApiError, trustApi } from '@/lib/trust-api';
import { fill, type Locale } from '@/lib/i18n';
import { disputesMessages } from '@/messages/disputes';
import { MAX_LENGTH, MAX_STATEMENTS } from './shared';

/**
 * "Add a statement" (task.md M8-d): plain text, up to 4000 characters and 10
 * statements per party. After a send the page re-reads the case, so the new
 * statement appears in the list above from the API, not from local state.
 */
export function StatementForm({ caseId, written, locale }: { caseId: string; written: number; locale: Locale }) {
  const m = disputesMessages(locale);
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (written >= MAX_STATEMENTS) {
    return <p className="fam-note fam-note--warn">{fill(m.form.limit, { max: MAX_STATEMENTS })}</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSent(false);
    if (text.trim().length === 0) {
      setError(m.form.empty);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await trustApi.statement(caseId, text.trim());
      setText('');
      setSent(true);
      router.refresh();
    } catch (err) {
      const code = err instanceof TrustApiError ? err.code : 'generic';
      const known = m.errors as Record<string, string>;
      setError(known[code] ?? (err instanceof TrustApiError && err.status === 429 ? m.errors.RATE_LIMITED : m.errors.generic));
      // The case changed under us (decided, or the limit reached elsewhere):
      // re-read it so the page shows why.
      if (code === 'CASE_CLOSED' || code === 'TOO_MANY_STATEMENTS' || code === 'NOT_FOUND') router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const over = text.length >= MAX_LENGTH;

  return (
    <form className="dp-form" onSubmit={submit} noValidate>
      <label className="fam-label" htmlFor={`${id}-t`}>
        {m.form.label}
      </label>
      <p className="fam-caption" id={`${id}-h`}>
        {m.form.hint}
      </p>
      <textarea
        id={`${id}-t`}
        className="dp-textarea"
        rows={6}
        maxLength={MAX_LENGTH}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
          if (sent) setSent(false);
        }}
        aria-describedby={`${id}-h ${id}-c`}
        aria-invalid={error === m.form.empty ? true : undefined}
        disabled={busy}
      />
      <div className="dp-form__foot">
        <span className={over ? 'dp-count dp-count--max' : 'dp-count'} id={`${id}-c`}>
          {fill(m.form.count, { n: text.length, max: MAX_LENGTH })}
          {' · '}
          {fill(m.form.used, { n: written, max: MAX_STATEMENTS })}
        </span>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={busy} aria-busy={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {m.form.submit}
        </button>
      </div>
      <div aria-live="polite" role="status">
        {sent && <p className="fam-alert fam-alert--ok">{m.form.sent}</p>}
      </div>
      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
