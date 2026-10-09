import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { CheckIn } from '@/components/staff/finals/CheckIn';
import { olympiadTitle, stageLabel, whenOf } from '@/components/staff/finals/shared';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { Roster } from '@/lib/olympiad-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { finalsMessages, type FinalsMessages } from '@/messages/finals';

export const dynamic = 'force-dynamic';

type Child = Roster['children'][number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(c: Child, m: FinalsMessages): { label: string; tone: string } {
  const s = m.roster.status;
  if (c.sessionStatus === 'submitted')
    return c.syncSource === 'offline_sync' ? { label: s.submittedOffline, tone: 'ok' } : { label: s.submitted, tone: 'ok' };
  if (c.sessionStatus === 'started') return { label: s.started, tone: 'blue' };
  if (c.sessionStatus === 'expired') return { label: s.expired, tone: 'danger' };
  if (!c.checkedInAt) return { label: s.notCheckedIn, tone: '' };
  return { label: s.notStarted, tone: 'brand' };
}

/**
 * `/staff/finals/[venueId]` — the roster at the door (task.md § 8.5 "Proctor"):
 * check each child in and record whether the accompanying adult is the
 * profile owner. That record is for trust & safety, never a refusal. Names and
 * grades only — no PINFL, no phone (design/07).
 */
export default async function RosterPage({ params }: { params: Promise<{ locale: string; venueId: string }> }) {
  const { locale: raw, venueId } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = finalsMessages(locale);
  const home = `/${locale}/staff/finals`;
  const self = `${home}/${venueId}`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'final.proctor')) return noAccess;

  const notYours = (
    <StateBlock icon="pin" title={m.states.nfTitle} body={m.states.nfBody} links={[{ href: home, label: m.states.nfCta, primary: true }]} />
  );
  if (!UUID_RE.test(venueId)) return notYours;

  const res = await apiGet<Roster>(`/api/staff/finals/${venueId}`);
  if (!res.ok) {
    if (res.status === 404) return notYours;
    if (res.status === 403) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.common.retry} />;
  }
  const { venue, children } = res.data;
  const stage = stageLabel(venue.stageKind, m);

  const checkedIn = children.filter((c) => c.checkedInAt).length;
  const counts = [
    { label: m.roster.seated, n: children.length },
    { label: m.roster.checkedIn, n: checkedIn },
    { label: m.roster.notCheckedIn, n: children.length - checkedIn },
    { label: m.roster.inProgress, n: children.filter((c) => c.sessionStatus === 'started').length },
    { label: m.roster.submitted, n: children.filter((c) => c.sessionStatus === 'submitted').length },
  ];
  const missingGrades = [...new Set(children.filter((c) => !c.formReady).map((c) => c.grade))];

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <Link href={home} className="fn-back">
          <Icon name="arrowLeft" size={18} />
          {m.roster.back}
        </Link>

        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <span className="fn-over">
              {olympiadTitle(venue, locale)}
              {stage ? ` · ${stage}` : ''}
            </span>
            <h1 className="pageHead__title">{venue.name}</h1>
            <p className="fn-venue__meta">
              <span>
                <Icon name="pin" size={16} />
                {venue.address}
              </span>
              <span>
                <Icon name="calendar" size={16} />
                {fill(m.roster.startsFmt, { when: whenOf(venue.startsAt, locale, m) })}
              </span>
            </p>
          </div>
        </div>

        <dl className="fn-counts fn-counts--wide">
          {counts.map((c) => (
            <div key={c.label} className="fn-count">
              <dt>{c.label}</dt>
              <dd>
                <span className="fn-count__num">{c.n}</span>
              </dd>
            </div>
          ))}
        </dl>

        <section className="fam-panel fn-runnerCta" aria-labelledby="fn-runner-title">
          <span className="fn-runnerCta__icon" aria-hidden="true">
            <Icon name="play" size={26} />
          </span>
          <div className="fam-stack" style={{ '--gap': '6px', flex: 1 } as React.CSSProperties}>
            <h2 id="fn-runner-title" className="fam-panel__title">
              {m.roster.runnerTitle}
            </h2>
            <p className="fam-small fam-muted">{m.roster.runnerBody}</p>
          </div>
          <Link href={`${self}/runner`} className="fam-btn fam-btn--primary fn-btn--xl">
            {m.roster.runnerCta}
            <Icon name="arrowRight" size={20} />
          </Link>
        </section>

        {missingGrades.length > 0 && (
          <p className="fam-note fam-note--warn">
            <Icon name="alert" size={18} />
            <span>{fill(m.roster.formMissingFmt, { g: missingGrades.join(', ') })}</span>
          </p>
        )}

        <section className="fam-panel" aria-labelledby="fn-roster-title">
          <div>
            <h2 id="fn-roster-title" className="fam-panel__title">
              {m.roster.listTitle}
            </h2>
            <p className="fam-panel__sub">{m.roster.listSub}</p>
          </div>

          {children.length === 0 ? (
            <StateBlock icon="users" title={m.roster.emptyTitle} body={m.roster.emptyBody} />
          ) : (
            <>
              <p className="fam-note fam-note--brand">
                <Icon name="info" size={18} />
                <span>{m.roster.recordNote}</span>
              </p>
              <table className="fn-roster">
                <thead>
                  <tr>
                    <th scope="col">{m.roster.colChild}</th>
                    <th scope="col">{m.roster.colAdult}</th>
                    <th scope="col">{m.roster.colCheckIn}</th>
                    <th scope="col">{m.roster.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {children.map((c) => {
                    const st = statusOf(c, m);
                    return (
                      <tr key={c.entryId}>
                        <th scope="row" data-label={m.roster.colChild}>
                          <span className="fn-roster__name">{c.name}</span>
                          <span className="fn-roster__grade">{fill(m.common.gradeFmt, { n: c.grade })}</span>
                        </th>
                        <td data-label={m.roster.colAdult}>
                          {c.ownerName ? fill(m.roster.expectedAdult, { name: c.ownerName }) : m.roster.expectedUnknown}
                        </td>
                        <td data-label={m.roster.colCheckIn}>
                          <CheckIn
                            m={m}
                            venueId={venue.id}
                            entryId={c.entryId}
                            name={c.name}
                            checkedInAt={c.checkedInAt}
                            adultMatchesOwner={c.adultMatchesOwner}
                            started={c.sessionId !== null}
                          />
                        </td>
                        <td data-label={m.roster.colStatus}>
                          <span className={st.tone ? `fam-tag fam-tag--${st.tone}` : 'fam-tag'}>{st.label}</span>
                          {!c.formReady && (
                            <span className="fn-roster__warn">{fill(m.roster.formMissingFmt, { g: c.grade })}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </LiveRegion>
  );
}
