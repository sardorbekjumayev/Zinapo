'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { useAnnounce } from '@/components/staff/review/live';
import { adminApi, AdminApiError } from '@/lib/admin-api';
import type { ImportResult } from '@/lib/admin-types';
import { fill } from '@/lib/i18n';
import type { OutcomesMessages } from '@/messages/outcomes';
import { errorText, MAX_CHARS, MAX_ROWS } from './shared';

/** How many lines of invalid rows to list before "… and n more". */
const SHOW_INVALID = 50;

/**
 * Import an official admission list (task.md § 8.5 outcomes operator). The
 * file holds PINFLs, so it is read in the browser and only its name and row
 * count are ever rendered; the text sits in a ref (never state, never the DOM)
 * until it is sent and is dropped right after — success or not (INV-06).
 */
export function ImportPanel({ m }: { m: OutcomesMessages }) {
  const t = m.import;
  const router = useRouter();
  const announce = useAnnounce();
  const input = useRef<HTMLInputElement>(null);
  const text = useRef<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; rows: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; data: ImportResult } | null>(null);

  function discard() {
    text.current = null;
    setPicked(null);
    if (input.current) input.current.value = '';
  }

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    text.current = null;
    setPicked(null);
    setInvalid(null);
    setError(null);
    if (!file) return;
    setReading(true);
    try {
      const csv = await file.text();
      // Rows after the header; blank lines don't count (the API skips them too).
      const rows = Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1);
      if (csv.length > MAX_CHARS || rows > MAX_ROWS) {
        setInvalid(errorText(new AdminApiError('CSV_TOO_LARGE', 400, { max: MAX_ROWS }), m));
        discard();
        return;
      }
      text.current = csv;
      setPicked({ name: file.name.slice(0, 200), rows });
    } catch {
      setInvalid(t.readFailed);
      discard();
    } finally {
      setReading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const csv = text.current;
    if (!picked || csv === null) {
      setInvalid(t.noFile);
      input.current?.focus();
      return;
    }
    if (picked.rows === 0) {
      setInvalid(t.noRows);
      return;
    }
    setInvalid(null);
    setError(null);
    setBusy(true);
    const name = picked.name;
    try {
      const data = await adminApi.importOutcomes(name, csv);
      setResult({ name, data });
      announce(fill(t.doneFmt, { name, rows: data.rows, matched: data.matched, pending: data.unmatched }));
      router.refresh();
    } catch (err) {
      setResult(null);
      setError(errorText(err, m));
    } finally {
      discard();
      setBusy(false);
    }
  }

  const reasons = t.reasons as Record<string, string>;

  return (
    <section className="fam-panel ad-oc-panel" aria-labelledby="ad-oc-import-title">
      <div>
        <h2 id="ad-oc-import-title" className="fam-panel__title">
          {t.title}
        </h2>
        <p className="fam-panel__sub">{t.sub}</p>
      </div>

      <div className="ad-oc-columns">
        <h3 className="ad-oc-sub">{t.columnsTitle}</h3>
        <ul>
          {t.columns.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <p className="fam-note fam-note--teal">
        <Icon name="lock" size={18} />
        <span>{t.privacy}</span>
      </p>

      <form className="fam-stack" style={{ '--gap': '14px' } as React.CSSProperties} onSubmit={submit} noValidate>
        <div className="fam-field">
          <label htmlFor="ad-oc-file" className="fam-label">
            {t.fileLabel}
          </label>
          <input
            ref={input}
            id="ad-oc-file"
            type="file"
            accept=".csv,text/csv"
            className="ad-oc-file"
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'ad-oc-file-err' : picked ? 'ad-oc-file-picked' : undefined}
            disabled={busy}
            onChange={choose}
          />
          {reading && <p className="fam-caption">{t.reading}</p>}
          {picked && !reading && (
            <p id="ad-oc-file-picked" className="fam-caption ad-oc-picked">
              <Icon name="file" size={16} />
              {fill(t.pickedFmt, { name: picked.name, n: picked.rows })}
            </p>
          )}
          {invalid && (
            <p id="ad-oc-file-err" className="fam-caption fam-caption--bad" role="alert">
              {invalid}
            </p>
          )}
        </div>
        <button type="submit" className="fam-btn fam-btn--primary ad-oc-submit" disabled={busy || reading} aria-busy={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="file" size={18} />}
          {busy ? t.sending : t.submit}
        </button>
      </form>

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="ad-oc-result" aria-labelledby="ad-oc-result-title" role="status">
          <h3 id="ad-oc-result-title" className="ad-oc-sub">
            {t.resultTitle} · {result.name}
          </h3>
          <dl className="ad-oc-counts">
            {(
              [
                [t.rows, result.data.rows],
                [t.matched, result.data.matched],
                [t.pending, result.data.unmatched],
                [t.invalid, result.data.invalid.length],
              ] as const
            ).map(([label, n]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{n}</dd>
              </div>
            ))}
          </dl>
          {result.data.invalid.length > 0 && (
            <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              <h4 className="ad-oc-sub">{t.invalidTitle}</h4>
              <ul className="ad-oc-invalid">
                {result.data.invalid.slice(0, SHOW_INVALID).map((x) => (
                  <li key={x.line}>
                    <span className="ad-oc-invalid__line">{fill(t.lineFmt, { n: x.line })}</span>
                    {reasons[x.reason] ?? reasons.other}
                  </li>
                ))}
              </ul>
              {result.data.invalid.length > SHOW_INVALID && (
                <p className="fam-small fam-muted">{fill(t.moreFmt, { n: result.data.invalid.length - SHOW_INVALID })}</p>
              )}
            </div>
          )}
          <p className="fam-small fam-muted">{t.discarded}</p>
        </section>
      )}
    </section>
  );
}
