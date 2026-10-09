'use client';

import { useId, useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { trustApi } from '@/lib/trust-api';
import type { CaseDetail } from '@/lib/trust-types';
import type { TrustMessages } from '@/messages/trust';
import { when } from './shared';
import { useCaseAction } from './useCaseAction';

/**
 * The case's timeline: statements from the two sides of a dispute and staff
 * notes, oldest first, as plain text. Staff add notes here (a dispute calls
 * them call notes — dispute evidence is statements and calls, note M8-d).
 */
export function NotesPanel({
  c,
  locale,
  m,
  title,
  sub,
  addLabel,
  placeholder,
}: {
  c: CaseDetail;
  locale: Locale;
  m: TrustMessages;
  title: string;
  sub?: string;
  addLabel: string;
  placeholder: string;
}) {
  const n = m.notes;
  const fieldId = useId();
  const { busy, error, setError, run } = useCaseAction(m);
  const [body, setBody] = useState('');
  const closed = c.status === 'resolved' || c.status === 'dismissed';
  const tone = { claimant: 'fam-tag--blue', owner: 'fam-tag--teal', staff: 'fam-tag--brand' } as const;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError(n.err);
      return;
    }
    if (await run('note', () => trustApi.note(c.id, body.trim()), n.added)) setBody('');
  };

  return (
    <section className="fam-panel" aria-labelledby="ts-notes-title">
      <div>
        <h2 id="ts-notes-title" className="fam-panel__title">
          {title}
        </h2>
        <p className="fam-panel__sub">{sub ?? n.sub}</p>
      </div>
      {c.notes.length === 0 ? (
        <p className="fam-small fam-muted">{n.empty}</p>
      ) : (
        <ol className="ts-timeline">
          {c.notes.map((note) => (
            <li key={note.id} className="ts-timeline__item" data-role={note.authorRole}>
              <div className="ts-timeline__head">
                <span className={`fam-tag ${tone[note.authorRole]}`}>{n.role[note.authorRole]}</span>
                {/* The two parties are named (masked) in their own cards; a staff note names its author. */}
                {note.authorRole === 'staff' && <span className="fam-small">{note.authorName}</span>}
                <time className="fam-small fam-muted" dateTime={note.createdAt}>
                  {when(note.createdAt, locale, true)}
                </time>
              </div>
              <p className="ts-timeline__body">{note.body}</p>
            </li>
          ))}
        </ol>
      )}
      {!closed && (
        <form className="fam-stack" style={{ '--gap': '10px' } as React.CSSProperties} onSubmit={submit} noValidate>
          <label htmlFor={fieldId} className="fam-label">
            {addLabel}
          </label>
          <textarea
            id={fieldId}
            className="ts-textarea"
            rows={3}
            maxLength={4000}
            placeholder={placeholder}
            value={body}
            aria-invalid={error === n.err}
            onChange={(e) => {
              setBody(e.target.value);
              if (error) setError(null);
            }}
          />
          {error && (
            <p className="fam-alert" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="fam-btn fam-btn--sm ts-start" disabled={busy !== null} aria-busy={busy === 'note'}>
            {busy === 'note' && <span className="spinner" aria-hidden="true" />}
            {n.submit}
          </button>
        </form>
      )}
    </section>
  );
}
