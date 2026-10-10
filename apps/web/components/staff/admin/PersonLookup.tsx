import { displayPhone } from '@/components/educator/invites/shared';
import { Icon } from '@/components/shell/Icon';
import type { PersonLookup as Lookup } from '@/lib/admin-types';
import { formatDate } from '@/lib/format';
import { fill, getMessages, type Locale } from '@/lib/i18n';
import type { AdminMessages } from '@/messages/admin';
import { formatStamp } from './shared';
import { CancelLoginButton, ResendInviteButton } from './SupportActions';

type State = 'waiting' | 'accepted' | 'cancelled' | 'expired';
const STATE_TONE: Record<State, string> = { waiting: 'fam-tag--brand', accepted: 'fam-tag--ok', cancelled: '', expired: 'fam-tag--warn' };
/** Login statuses that still move; the others are history (apps/api auth/login-request.types.ts). */
const LIVE_LOGIN = ['PENDING', 'TG_LINKED', 'CODE_SENT'];

function StateTag({ state, m }: { state: State; m: AdminMessages }) {
  return <span className={`fam-tag ${STATE_TONE[state]}`}>{m.common.inviteState[state]}</span>;
}

function lookupText<T extends Record<string, string>>(map: T, key: string): string {
  return (map as Record<string, string>)[key] ?? key;
}

/**
 * Everything `GET /api/staff/people` returns for one phone (task.md § 8.5
 * Support). Names of children arrive masked; recipients' phones arrive masked;
 * only the number support typed is shown in full.
 */
export function PersonLookup({
  data,
  m,
  locale,
  canResend,
  canReset,
}: {
  data: Lookup;
  m: AdminMessages;
  locale: Locale;
  canResend: boolean;
  canReset: boolean;
}) {
  const p = m.people;
  const roleName = getMessages(locale).staffRole as Record<string, string>;
  const searched = displayPhone(data.phone);
  const incoming = data.invitesForThisPhone;
  const limitMin = Math.ceil(data.login.startLimitedForSec / 60);

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      {!data.found && (
        <section className="state ad-notFound" aria-labelledby="ad-nf-title">
          <span className="state__icon state__icon--empty">
            <Icon name="user" size={26} />
          </span>
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h2 id="ad-nf-title" className="state__title">
              {fill(p.notFoundTitle, { phone: searched })}
            </h2>
            <p className="card__body">{p.notFoundBody}</p>
          </div>
        </section>
      )}

      {data.person && (
        <div className="ad-grid">
          <section className="fam-panel" aria-labelledby="ad-person-title">
            <div>
              <p className="card__kicker">{p.person.title}</p>
              <h2 id="ad-person-title" className="fam-panel__title">
                {data.person.name}
              </h2>
            </div>
            <dl className="ad-facts">
              <div>
                <dt>{p.person.phone}</dt>
                <dd>
                  <span className="ad-mono">{searched}</span>
                  <span className="fam-small fam-muted">
                    {data.person.phoneVerifiedAt
                      ? fill(p.person.verifiedFmt, {
                          how: lookupText(p.person.via, data.person.verifiedVia ?? ''),
                          when: formatStamp(data.person.phoneVerifiedAt, locale),
                        })
                      : p.person.notVerified}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{p.person.language}</dt>
                <dd>{lookupText(m.common.lang, data.person.locale)}</dd>
              </div>
              <div>
                <dt>{p.person.registered}</dt>
                <dd>{formatDate(data.person.createdAt, locale)}</dd>
              </div>
              <div>
                <dt>{p.person.telegram}</dt>
                <dd>
                  <span className={data.person.telegramLinked ? 'fam-tag fam-tag--ok' : 'fam-tag'}>
                    {data.person.telegramLinked ? p.person.tgLinked : p.person.tgNot}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="fam-panel" aria-labelledby="ad-ws-title">
            <h2 id="ad-ws-title" className="fam-panel__title">
              {p.workspaces.title}
            </h2>
            <ul className="ad-tags">
              {data.workspaces?.family && <li className="fam-tag fam-tag--teal">{p.workspaces.family}</li>}
              {data.workspaces?.educator && (
                <li className="fam-tag fam-tag--blue">
                  {fill(p.workspaces.educatorFmt, { status: lookupText(p.workspaces.educatorStatus, data.workspaces.educator) })}
                </li>
              )}
              {data.workspaces && data.workspaces.staff.length > 0 && (
                <li className="fam-tag fam-tag--brand">
                  {fill(p.workspaces.staffFmt, { roles: data.workspaces.staff.map((r) => roleName[r] ?? r).join(', ') })}
                </li>
              )}
              {data.workspaces && !data.workspaces.family && !data.workspaces.educator && data.workspaces.staff.length === 0 && (
                <li className="fam-muted fam-small">{p.workspaces.none}</li>
              )}
            </ul>

            {data.educator && (
              <>
                <hr className="fam-divider" />
                <h3 className="ad-subTitle">{p.educator.title}</h3>
                <dl className="ad-facts">
                  <div>
                    <dt>{p.educator.status}</dt>
                    <dd>{lookupText(p.workspaces.educatorStatus, data.educator.status)}</dd>
                  </div>
                  <div>
                    <dt>{p.educator.kindLabel}</dt>
                    <dd>{lookupText(p.educator.kind, data.educator.kind)}</dd>
                  </div>
                  <div>
                    <dt>{p.educator.code}</dt>
                    <dd className="ad-mono">{data.educator.publicCode}</dd>
                  </div>
                  <div>
                    <dt>{p.educator.links}</dt>
                    <dd>{data.educator.activeLinks}</dd>
                  </div>
                </dl>
              </>
            )}
          </section>
        </div>
      )}

      {data.guardianships && (
        <section className="fam-panel" aria-labelledby="ad-children-title">
          <h2 id="ad-children-title" className="fam-panel__title">
            {p.children.title}
          </h2>
          {data.guardianships.length === 0 ? (
            <p className="fam-small fam-muted">{p.children.none}</p>
          ) : (
            <ul className="fam-people">
              {data.guardianships.map((g, i) => (
                <li key={i} className="fam-person">
                  <span className="fam-avatar" aria-hidden="true">
                    <Icon name="child" size={18} />
                  </span>
                  <div className="fam-person__body">
                    <p className="fam-person__name">
                      <span className="ad-mono">{g.child}</span>
                      <span className={g.role === 'owner' ? 'fam-tag fam-tag--brand' : 'fam-tag fam-tag--blue'}>{p.children.role[g.role]}</span>
                      {g.revokedAt && <span className="fam-tag fam-tag--danger">{fill(p.children.revokedFmt, { d: formatDate(g.revokedAt, locale) })}</span>}
                    </p>
                    <p className="fam-person__desc">
                      {g.grade === null ? p.children.noGrade : fill(p.children.gradeFmt, { g: g.grade })} ·{' '}
                      {fill(p.children.sinceFmt, { d: formatDate(g.since, locale) })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.invitesSent && (
        <section className="fam-panel" aria-labelledby="ad-sent-title">
          <h2 id="ad-sent-title" className="fam-panel__title">
            {p.sent.title}
          </h2>
          {data.invitesSent.length === 0 ? (
            <p className="fam-small fam-muted">{p.sent.none}</p>
          ) : (
            <div className="ad-tableWrap">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th scope="col">{p.sent.to}</th>
                    <th scope="col">{p.sent.child}</th>
                    <th scope="col">{p.sent.kindCol}</th>
                    <th scope="col">{p.sent.state}</th>
                    <th scope="col">{p.sent.expires}</th>
                    {canResend && <th scope="col">{p.sent.actions}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.invitesSent.map((s) => (
                    <tr key={s.id}>
                      <td className="ad-mono">{s.to}</td>
                      <td className="ad-mono">{s.child}</td>
                      <td>{lookupText(p.sent.kind, s.kind)}</td>
                      <td>
                        <StateTag state={s.state} m={m} />
                      </td>
                      <td>{formatDate(s.expiresAt, locale)}</td>
                      {canResend && (
                        <td>{s.state === 'waiting' && <ResendInviteButton m={m} id={s.id} kind="guardian" to={s.to} />}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="fam-panel" aria-labelledby="ad-in-title">
        <div>
          <h2 id="ad-in-title" className="fam-panel__title">
            {p.incoming.title}
          </h2>
          <p className="fam-panel__sub">{p.incoming.sub}</p>
        </div>
        {incoming.guardian.length + incoming.educator.length === 0 ? (
          <p className="fam-small fam-muted">{p.incoming.none}</p>
        ) : (
          <ul className="fam-people">
            {incoming.guardian.map((g) => (
              <li key={g.id} className="fam-person">
                <span className="fam-avatar" aria-hidden="true">
                  <Icon name="users" size={18} />
                </span>
                <div className="fam-person__body">
                  <p className="fam-person__name">
                    <span>{fill(p.incoming.familyFmt, { from: g.from, kind: lookupText(p.sent.kind, g.kind), child: g.child })}</span>
                    <StateTag state={g.state} m={m} />
                  </p>
                  <p className="fam-person__desc">{fill(p.incoming.expiresFmt, { d: formatDate(g.expiresAt, locale) })}</p>
                </div>
                {canResend && g.state === 'waiting' && <ResendInviteButton m={m} id={g.id} kind="guardian" to={searched} />}
              </li>
            ))}
            {incoming.educator.map((e) => (
              <li key={e.id} className="fam-person">
                <span className="fam-avatar" aria-hidden="true">
                  <Icon name="mail" size={18} />
                </span>
                <div className="fam-person__body">
                  <p className="fam-person__name">
                    <span>{fill(p.incoming.educatorFmt, { educator: e.educator })}</span>
                    <StateTag state={e.state} m={m} />
                  </p>
                  <p className="fam-person__desc">
                    {fill(p.incoming.sentFmt, { d: formatDate(e.sentAt, locale) })} · {fill(p.incoming.expiresFmt, { d: formatDate(e.expiresAt, locale) })}
                  </p>
                </div>
                {canResend && e.state === 'waiting' && <ResendInviteButton m={m} id={e.id} kind="educator" to={searched} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fam-panel" aria-labelledby="ad-signin-title">
        <h2 id="ad-signin-title" className="fam-panel__title">
          {p.signin.title}
        </h2>
        <dl className="ad-facts ad-facts--row">
          {data.sessions && (
            <>
              <div>
                <dt>{p.signin.sessions}</dt>
                <dd>{data.sessions.active}</dd>
              </div>
              <div>
                <dt>{p.signin.lastUsed}</dt>
                <dd>{data.sessions.lastUsedAt ? formatStamp(data.sessions.lastUsedAt, locale) : p.signin.never}</dd>
              </div>
            </>
          )}
        </dl>
        {limitMin > 0 ? (
          <p className="fam-note fam-note--warn">
            <Icon name="clock" size={18} />
            <span>{fill(p.signin.limitFmt, { min: limitMin })}</span>
          </p>
        ) : (
          <p className="fam-small fam-muted">{p.signin.limitNone}</p>
        )}

        <h3 className="ad-subTitle">{p.signin.requests}</h3>
        {data.login.requests.length === 0 ? (
          <p className="fam-small fam-muted">{p.signin.requestsNone}</p>
        ) : (
          <div className="ad-tableWrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th scope="col">{p.signin.status}</th>
                  <th scope="col">{p.signin.codes}</th>
                  <th scope="col">{p.signin.attempts}</th>
                  <th scope="col">{p.signin.telegram}</th>
                  <th scope="col">{p.signin.created}</th>
                  <th scope="col">{p.signin.expires}</th>
                  {canReset && <th scope="col">{p.sent.actions}</th>}
                </tr>
              </thead>
              <tbody>
                {data.login.requests.map((r) => {
                  const live = LIVE_LOGIN.includes(r.status);
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className={live ? 'fam-tag fam-tag--brand' : 'fam-tag'}>{lookupText(p.signin.statusName, r.status)}</span>
                      </td>
                      <td>{r.codesIssued}</td>
                      <td>{r.attempts}</td>
                      <td>{r.telegramLinked ? p.person.tgLinked : p.person.tgNot}</td>
                      <td>{formatStamp(r.createdAt, locale)}</td>
                      <td>{formatStamp(r.expiresAt, locale)}</td>
                      {canReset && (
                        // A finished request can still be cancelled while the start limit holds: that lifts the limit.
                        <td>{(live || limitMin > 0) && <CancelLoginButton m={m} id={r.id} phone={data.phone} />}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
