import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { AuditFilters, type AuditQuery } from '@/components/staff/admin/AuditFilters';
import { formatStamp, shortAgent, toE164 } from '@/components/staff/admin/shared';
import { StateBlock } from '@/components/staff/review/StateBlock';
import type { AuditPage as Page } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { adminMessages } from '@/messages/admin';

export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACTION = /^[a-z0-9_.]{1,80}$/;

/** "2026-10-10" → the start of that day in Tashkent, so the filter means the staff member's calendar day. */
const dayStart = (d: string) => `${d}T00:00:00+05:00`;
function nextDayStart(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return dayStart(t.toISOString().slice(0, 10));
}

function pretty(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'object' && Object.keys(payload).length === 0) return null;
  return JSON.stringify(payload, null, 2);
}

/**
 * `/staff/audit?action=&phone=&from=&to=&before=` — the super admin's audit
 * log viewer (task.md § 8.5 Super admin): newest first, keyset-paged by id.
 * Payloads are rendered as text in a <pre>, never as HTML.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string; phone?: string; from?: string; to?: string; before?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const sp = await searchParams;
  const m = adminMessages(locale);
  const a = m.audit;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={a.states.noAccessTitle}
      body={a.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.common.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'audit.read')) return noAccess;

  const q: AuditQuery = {
    action: sp.action && ACTION.test(sp.action) ? sp.action : '',
    phone: sp.phone ?? '',
    from: sp.from && DAY.test(sp.from) ? sp.from : '',
    to: sp.to && DAY.test(sp.to) ? sp.to : '',
  };
  const before = sp.before && /^\d{1,18}$/.test(sp.before) ? sp.before : '';
  const phone = q.phone ? toE164(q.phone) : null;

  const href = (extra: Record<string, string> = {}) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, phone: phone ?? q.phone, ...extra })) if (v) u.set(k, v);
    const s = u.toString();
    return `/${locale}/staff/audit${s ? `?${s}` : ''}`;
  };

  const api = new URLSearchParams({ limit: '50' });
  if (q.action) api.set('action', q.action);
  if (phone) api.set('phone', phone);
  if (q.from) api.set('from', dayStart(q.from));
  if (q.to) api.set('to', nextDayStart(q.to));
  if (before) api.set('before', before);

  const [actionsRes, pageRes] = await Promise.all([
    apiGet<{ action: string; n: number }[]>('/api/staff/audit/actions'),
    q.phone && !phone ? Promise.resolve(null) : apiGet<Page>(`/api/staff/audit?${api}`),
  ]);
  if ((!actionsRes.ok && actionsRes.status === 403) || (pageRes && !pageRes.ok && pageRes.status === 403)) return noAccess;

  let body: React.ReactNode;
  if (!pageRes || (!pageRes.ok && pageRes.status === 400)) {
    body = <StateBlock icon="alert" tone="error" title={a.states.badPhoneTitle} body={a.states.badPhoneBody} />;
  } else if (!pageRes.ok || !actionsRes.ok) {
    body = <ErrorState title={a.states.errTitle} body={a.states.errBody} retryHref={href({ before })} retryLabel={m.common.retry} />;
  } else if (pageRes.data.entries.length === 0) {
    body = (
      <StateBlock
        icon="file"
        title={a.emptyTitle}
        body={a.emptyBody}
        links={before ? [{ href: href(), label: a.newest }] : [{ href: `/${locale}/staff/audit`, label: a.reset }]}
      />
    );
  } else {
    const { entries, nextBefore } = pageRes.data;
    body = (
      <section className="fam-panel" aria-label={a.title}>
        <div className="ad-tableWrap">
          <table className="ad-table ad-table--audit">
            <thead>
              <tr>
                <th scope="col">{a.time}</th>
                <th scope="col">{a.action}</th>
                <th scope="col">{a.person}</th>
                <th scope="col">{a.ip}</th>
                <th scope="col">{a.agent}</th>
                <th scope="col">{a.payload}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const json = pretty(e.payload);
                return (
                  <tr key={e.id}>
                    <td className="ad-nowrap">{formatStamp(e.at, locale, true)}</td>
                    <td className="ad-mono">{e.action}</td>
                    <td>
                      {e.person ? (
                        <span className="ad-holder">
                          <span>{e.person.name}</span>
                          {e.person.phone && <span className="ad-mono fam-small fam-muted">{e.person.phone}</span>}
                        </span>
                      ) : (
                        <span className="fam-muted">{m.common.system}</span>
                      )}
                    </td>
                    <td className="ad-mono">{e.ip ?? '—'}</td>
                    <td title={e.userAgent ?? undefined}>{e.userAgent ? shortAgent(e.userAgent) : '—'}</td>
                    <td className="ad-payloadCell">
                      {json ? (
                        <details className="ad-payload">
                          <summary>{a.showPayload}</summary>
                          <pre>{json}</pre>
                        </details>
                      ) : (
                        a.emptyPayload
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ad-pager">
          <span className="fam-small fam-muted">
            {fill(a.pageNote, { n: entries.length })} {nextBefore === null && a.endNote}
          </span>
          <span className="fam-inline" style={{ '--gap': '12px' } as React.CSSProperties}>
            {before && (
              <Link href={href()} className="fam-btn fam-btn--sm">
                {a.newest}
              </Link>
            )}
            {nextBefore !== null && (
              <Link href={href({ before: String(nextBefore) })} className="fam-btn fam-btn--sm">
                {a.older}
                <Icon name="arrowRight" size={16} />
              </Link>
            )}
          </span>
        </div>
      </section>
    );
  }

  return (
    <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1 className="pageHead__title">{a.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {a.subtitle}
          </p>
        </div>
      </div>

      <p className="fam-note fam-note--teal">
        <Icon name="shield" size={18} />
        <span>{a.scrubbed}</span>
      </p>

      <section className="fam-panel" aria-label={a.filters}>
        <AuditFilters key={href()} m={m} locale={locale} actions={actionsRes.ok ? actionsRes.data : []} initial={{ ...q, phone: phone ?? q.phone }} />
      </section>

      {body}
    </div>
  );
}
