'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { InviteList, InviteState } from '@/lib/educator-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { InvitesMessages } from '@/messages/invites';
import { displayPhone, errorText } from './shared';

type Filter = 'all' | InviteState;
const PAGE = 8;

/** design/10 "Invitation status": counts, filter, rows, remind, resend. */
export function InviteStatus({ locale, m, list }: { locale: Locale; m: InvitesMessages; list: InviteList }) {
  const t = m.status;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { counts, remind, invites } = list;
  const shared = invites.filter((i) => i.shared).length;
  const total = counts.sent || 1;
  const pct = (n: number) => `${(n / total) * 100}%`;

  const rows = invites.filter((i) => filter === 'all' || i.state === filter);
  const shown = showAll ? rows : rows.slice(0, PAGE);
  const more = rows.length - shown.length;

  const resend = async (id: string, phone: string) => {
    setBusyId(id);
    setMsg(null);
    try {
      await educatorApi.resendInvite(id);
      setMsg({ ok: true, text: fill(t.resent, { phone: displayPhone(phone) }) });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, m.common.errors) });
    } finally {
      setBusyId(null);
    }
  };

  const sendReminders = async () => {
    setReminding(true);
    setMsg(null);
    try {
      const res = await educatorApi.remindInvites();
      setReminded(res.reminded);
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, m.common.errors) });
    } finally {
      setReminding(false);
    }
  };

  const remindNote =
    reminded !== null
      ? fill(t.remindedNote, { n: reminded, days: remind.everyDays })
      : remind.eligible > 0
        ? fill(t.remindNote, { n: remind.eligible })
        : remind.nextAt
          ? fill(t.remindWait, { date: formatDate(remind.nextAt, locale, false) })
          : fill(t.remindNone, { days: remind.everyDays });

  const filters: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: t.fAll, n: counts.sent },
    { key: 'joined', label: t.fJoined, n: counts.joined },
    { key: 'waiting', label: t.fWaiting, n: counts.waiting },
    { key: 'expired', label: t.fExpired, n: counts.expired },
  ];
  const chip: Record<InviteState, { cls: string; label: string }> = {
    joined: { cls: 'fam-tag fam-tag--ok', label: t.chJoined },
    waiting: { cls: 'fam-tag fam-tag--warn', label: t.chWaiting },
    expired: { cls: 'fam-tag', label: t.chExpired },
  };

  return (
    <div className="iv-status">
      <div className="iv-status__side">
        <div className="iv-tiles">
          <div className="iv-tile">
            <span className="iv-tile__n">{counts.sent}</span>
            <span className="iv-tile__l">{t.tSent}</span>
          </div>
          <div className="iv-tile iv-tile--ok">
            <span className="iv-tile__n">{counts.joined}</span>
            <span className="iv-tile__l">{t.tJoined}</span>
            <span className="iv-tile__s">{fill(t.tShared, { n: shared })}</span>
          </div>
          <div className="iv-tile iv-tile--warn">
            <span className="iv-tile__n">{counts.waiting}</span>
            <span className="iv-tile__l">{t.tWaiting}</span>
          </div>
          <div className="iv-tile iv-tile--muted">
            <span className="iv-tile__n">{counts.expired}</span>
            <span className="iv-tile__l">{t.tExpired}</span>
          </div>
        </div>
        <div className="iv-bar" aria-hidden="true">
          <span className="iv-bar__ok" style={{ width: pct(counts.joined) }} />
          <span className="iv-bar__warn" style={{ width: pct(counts.waiting) }} />
        </div>
        <p className="fam-small fam-muted" aria-live="polite">
          {remindNote}
        </p>
        <button
          type="button"
          className="fam-btn iv-start"
          disabled={remind.eligible === 0 || reminding || reminded !== null}
          aria-busy={reminding}
          onClick={sendReminders}
        >
          {reminding ? <span className="spinner" aria-hidden="true" /> : <Icon name="bell" size={18} />}
          {reminding ? t.reminding : fill(t.remind, { n: reminded !== null ? 0 : remind.eligible })}
        </button>
      </div>

      <div className="iv-status__main">
        <div className="iv-filters" role="group" aria-label={t.filterLabel}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="iv-filter"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setShowAll(false);
              }}
            >
              {f.label} · {f.n}
            </button>
          ))}
        </div>

        {msg && (
          <p className={msg.ok ? 'fam-alert fam-alert--ok' : 'fam-alert'} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="fam-small fam-muted iv-filterEmpty">{t.filterEmpty}</p>
        ) : (
          <ul className="iv-rows" aria-label={t.listLabel}>
            {shown.map((i) => (
              <li key={i.id} className="iv-row">
                <div className="iv-row__who">
                  <span className="mono iv-row__phone">{displayPhone(i.phone)}</span>
                  <span className="fam-small fam-muted">{fill(t.sentOn, { date: formatDate(i.sentAt, locale, false) })}</span>
                </div>
                <span className={chip[i.state].cls}>{chip[i.state].label}</span>
                <div className="iv-row__detail">
                  {i.state === 'joined' && (
                    <span>
                      {i.joinedAt ? fill(t.joinedOn, { date: formatDate(i.joinedAt, locale, false) }) : ''}
                      {' · '}
                      {i.shared ? t.shared : t.notShared}
                    </span>
                  )}
                  {i.state === 'waiting' && (
                    <span>
                      {fill(t.until, { date: formatDate(i.expiresAt, locale, false) })}
                      {i.remindedAt ? ` · ${t.reminded}` : ''}
                    </span>
                  )}
                  {i.state === 'expired' && (
                    <>
                      <span>{t.noReply}</span>
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm"
                        disabled={busyId !== null}
                        aria-busy={busyId === i.id}
                        aria-label={fill(t.resendLabel, { phone: displayPhone(i.phone) })}
                        onClick={() => resend(i.id, i.phone)}
                      >
                        {busyId === i.id && <span className="spinner" aria-hidden="true" />}
                        {t.resend}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && (
          <button type="button" className="fam-btn fam-btn--quiet fam-btn--sm iv-start" onClick={() => setShowAll(true)}>
            {fill(t.more, { n: more })} · {t.showAll}
          </button>
        )}
      </div>
    </div>
  );
}
