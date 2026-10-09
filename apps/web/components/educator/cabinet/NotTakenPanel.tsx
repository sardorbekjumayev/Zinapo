'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAnnounce } from '@/components/staff/review/live';
import { educatorApi } from '@/lib/educator-api';
import type { GroupOverview } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import { educatorMessages } from '@/messages/educator';
import { errorText } from './errors';

/**
 * "Haven't taken wave N yet" (design/08). Reminders go to the child's OWNER,
 * never to the child, and only while the wave is open; the API sends at most
 * one per child per day from anyone, so a repeat press is a no-op that we
 * explain rather than hide (task.md § 8.4.5, § 10).
 */
export function NotTakenPanel({
  locale,
  groupId,
  rows,
  canRemind,
}: {
  locale: Locale;
  groupId: string;
  rows: GroupOverview['notTaken'];
  canRemind: boolean;
}) {
  const m = educatorMessages(locale);
  const g = m.group;
  const router = useRouter();
  const announce = useAnnounce();
  const [done, setDone] = useState<Set<string>>(() => new Set(rows.filter((r) => r.remindedToday).map((r) => r.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allDone = rows.every((r) => done.has(r.id));

  async function remind(ids?: string[]) {
    setBusy(ids ? ids[0] : 'all');
    setError(null);
    try {
      const res = await educatorApi.remind(groupId, ids);
      setDone((prev) => new Set([...prev, ...(ids ?? rows.map((r) => r.id))]));
      announce(
        [fill(g.toast, { n: res.reminded }), res.alreadyToday > 0 ? fill(g.toastAlready, { n: res.alreadyToday }) : '']
          .filter(Boolean)
          .join(' '),
      );
      router.refresh();
    } catch (err) {
      const text = errorText(err, m, { NO_OPEN_WAVE: g.errNoOpenWave });
      setError(text);
      announce(text);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {canRemind && rows.length > 1 && (
        <button
          type="button"
          className="fam-btn fam-btn--sm ed-selfStart"
          onClick={() => void remind()}
          disabled={allDone || busy !== null}
          aria-busy={busy === 'all'}
        >
          {busy === 'all' && <span className="spinner" aria-hidden="true" />}
          {allDone ? g.remindAllDone : g.remindAll}
        </button>
      )}
      <ul className="ed-miss">
        {rows.map((r) => {
          const sent = done.has(r.id);
          return (
            <li key={r.id} className="ed-miss__row">
              <span className="ed-miss__who">
                <strong>{r.name}</strong>
                <span className="fam-muted fam-small">{r.inProgress ? g.inProgress : g.notYet}</span>
              </span>
              {canRemind &&
                (sent ? (
                  <span className="chip chip--success">{g.reminded}</span>
                ) : (
                  <button
                    type="button"
                    className="fam-btn fam-btn--sm"
                    onClick={() => void remind([r.id])}
                    disabled={busy !== null}
                    aria-busy={busy === r.id}
                  >
                    {busy === r.id && <span className="spinner" aria-hidden="true" />}
                    {g.remind}
                    <span className="visually-hidden"> — {r.name}</span>
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
