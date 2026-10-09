'use client';

import { useState } from 'react';
import { Icon, type IconName } from '@/components/shell/Icon';
import { familyApi } from '@/lib/family-api';
import type { ChangeAction, ChangeLogEntry, ChangeLogPage } from '@/lib/family-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { errorText, type Copy } from './live';

type Kind = 'grant' | 'req' | 'off' | 'doc';

/** The four looks of a log row in design/06: granted, asked, closed, paperwork. */
const KIND: Partial<Record<ChangeAction, Kind>> = {
  'access.granted': 'grant',
  'access.restored': 'grant',
  'guardian.invite_accepted': 'grant',
  'ownership.transferred': 'grant',
  'access.requested': 'req',
  'guardian.invited': 'req',
  'ownership.transfer_offered': 'req',
  'access.revoked': 'off',
  'access.declined': 'off',
  'access.suspended': 'off',
  'consent.revoked': 'off',
  'guardian.removed': 'off',
  'privacy.anonymisation_requested': 'off',
};
const ICON: Record<Kind, IconName> = { grant: 'check', req: 'inbox', off: 'ban', doc: 'file' };

/** One localized sentence per action; "You …" when the reader did it. */
function sentence(e: ChangeLogEntry, { m, f, locale }: Copy): string {
  const mine = m.log.me as Partial<Record<ChangeAction, string>>;
  const all = m.log.a as Record<ChangeAction, string>;
  const template = (e.by.isMe && mine[e.action]) || all[e.action] || e.action;
  let text = fill(template, {
    subject: e.subject ?? e.by.name ?? m.log.someone,
    date: formatDate(e.details.validUntil, locale),
    consent: e.details.type ? f.consent[e.details.type].title : '',
    grade:
      e.details.grade !== undefined
        ? f.grade[String(e.details.grade) as keyof typeof f.grade] ?? fill(f.gradeShort, { n: e.details.grade })
        : '',
  });
  if (e.details.documentVersion && (e.action === 'child.created' || e.action === 'consent.given')) {
    text += ` · ${e.details.documentVersion}`;
  }
  return text;
}

/**
 * design/06 "Change log": every change to access and consents, newest first
 * (task.md § 8.1.5: each one is also sent by Telegram/SMS — "notified").
 * The first page comes from the server; "Show more" pages on the client.
 */
export function ChangeLog({
  copy,
  childId,
  initial,
}: {
  copy: Copy;
  childId: string;
  initial: ChangeLogPage;
}) {
  const { m, locale } = copy;
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await familyApi.changelog(childId, cursor);
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorText(err, copy));
    } finally {
      setLoading(false);
    }
  }

  const today = formatDate(new Date().toISOString(), locale);

  return (
    <section className="fam-panel" aria-labelledby="ac-log-h">
      <div>
        <h2 id="ac-log-h" className="fam-panel__title">
          {m.log.title}
        </h2>
        <p className="fam-panel__sub">{m.log.sub}</p>
      </div>

      {entries.length === 0 ? (
        <p className="ac-none">{m.log.empty}</p>
      ) : (
        <ol className="ac-log">
          {entries.map((e) => {
            const kind = KIND[e.action] ?? 'doc';
            const day = formatDate(e.at, locale) === today ? m.log.today : formatDate(e.at, locale, false);
            const who = e.by.isMe ? m.log.byMe : e.by.name;
            return (
              <li key={e.id} className="ac-log__item">
                <span className={`ac-log__icon ac-log__icon--${kind}`}>
                  <Icon name={ICON[kind]} size={18} strokeWidth={kind === 'grant' ? 1.8 : 1.5} />
                </span>
                <div className="ac-grow">
                  <span className="ac-log__text">{sentence(e, copy)}</span>
                  <span className="ac-log__meta">
                    <time dateTime={e.at}>{day}</time>
                    {who && !(e.by.isMe && (m.log.me as Record<string, string>)[e.action]) && ` · ${who}`}
                    {` · ${m.log.notified}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      {initial.total > 0 && (
        <div className="fam-actions">
          <span className="fam-small fam-muted" aria-live="polite">
            {fill(m.log.count, { n: entries.length, m: initial.total })}
          </span>
          {cursor && (
            <button
              type="button"
              className="fam-btn fam-btn--sm"
              onClick={more}
              disabled={loading}
              aria-busy={loading}
            >
              {loading && <span className="spinner" aria-hidden="true" />}
              {m.log.more}
              <Icon name="chevronDown" size={18} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
