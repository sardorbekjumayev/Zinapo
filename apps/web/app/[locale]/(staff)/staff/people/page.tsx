import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { PeopleSearch } from '@/components/staff/admin/PeopleSearch';
import { PersonLookup } from '@/components/staff/admin/PersonLookup';
import { toE164 } from '@/components/staff/admin/shared';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import type { PersonLookup as Lookup } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { adminMessages } from '@/messages/admin';

export const dynamic = 'force-dynamic';

/**
 * `/staff/people?phone=` — support's person lookup (task.md § 8.5 Support):
 * relationships and statuses by phone, never a PINFL or an answer. Support
 * resends invites and cancels stuck sign-ins; trust & safety only reads (the
 * API answers 403 to their actions, so the buttons are not drawn).
 */
export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ phone?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const { phone: asked = '' } = await searchParams;
  const m = adminMessages(locale);
  const p = m.people;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={p.states.noAccessTitle}
      body={p.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.common.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'person.lookup')) return noAccess;
  const canResend = hasPermission(me, 'invite.resend');
  const canReset = hasPermission(me, 'login.reset');

  const phone = toE164(asked);
  const res = phone ? await apiGet<Lookup>(`/api/staff/people?phone=${encodeURIComponent(phone)}`) : null;
  if (res && !res.ok && res.status === 403) return noAccess;

  let body: React.ReactNode;
  if (!asked) {
    body = <StateBlock icon="user" title={p.startTitle} body={p.startBody} />;
  } else if (!phone || (res && !res.ok && res.status === 400)) {
    body = <StateBlock icon="alert" tone="error" title={p.invalidTitle} body={p.invalidBody} />;
  } else if (!res || !res.ok) {
    const self = `/${locale}/staff/people?phone=${encodeURIComponent(phone)}`;
    body = <ErrorState title={p.states.errTitle} body={p.states.errBody} retryHref={self} retryLabel={m.common.retry} />;
  } else {
    body = <PersonLookup data={res.data} m={m} locale={locale} canResend={canResend} canReset={canReset} />;
  }

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{p.title}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {p.subtitle}
            </p>
          </div>
        </div>

        <section className="fam-panel" aria-label={p.search}>
          {/* Keyed by the URL's phone so a back/forward navigation re-seeds the field. */}
          <PeopleSearch key={phone ?? asked} m={m} locale={locale} initial={phone ?? asked} />
          <p className="fam-note fam-note--teal">
            <Icon name="shield" size={18} />
            <span>{p.privacy}</span>
          </p>
          {!canResend && !canReset && <p className="fam-small fam-muted">{p.readOnly}</p>}
        </section>

        {body}
      </div>
    </LiveRegion>
  );
}
