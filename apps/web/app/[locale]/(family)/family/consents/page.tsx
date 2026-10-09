import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { ConsentsPanel } from '@/components/family/access/ConsentsPanel';
import { LiveRegion, type Copy } from '@/components/family/access/live';
import { ReadOnlyNote, StateBlock } from '@/components/family/access/parts';
import { apiGet } from '@/lib/api-server';
import type { ChildConsents, ChildSummary } from '@/lib/family-types';
import { childDisplayName } from '@/lib/format';
import { isLocale } from '@/lib/i18n';
import { accessMessages } from '@/messages/access';
import { familyMessages } from '@/messages/family';

export const dynamic = 'force-dynamic';

/**
 * `/family/consents` — every child's consents on one page (task.md § 8.1.7:
 * "revoke consents"). The same panel as on /family/access; read-only for a
 * child the reader only co-guards (`canManage: false`, task.md § 8.2).
 */
export default async function ConsentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = accessMessages(locale);
  const f = familyMessages(locale);

  // The children list only adds nicer names and the owner's name for the
  // read-only note; the consents themselves come from one call.
  const [res, kidsRes] = await Promise.all([
    apiGet<ChildConsents[]>('/api/family/consents'),
    apiGet<ChildSummary[]>('/api/family/children'),
  ]);
  if (!res.ok) {
    return (
      <ErrorState
        title={m.states.errTitle}
        body={m.states.errBody}
        retryHref={`/${locale}/family/consents`}
        retryLabel={f.common.retry}
      />
    );
  }

  if (res.data.length === 0) {
    return (
      <StateBlock
        title={m.consentsPage.emptyTitle}
        body={m.consentsPage.emptyBody}
        href={`/${locale}/family/children/new`}
        cta={m.consentsPage.cta}
      />
    );
  }

  const kids = new Map((kidsRes.ok ? kidsRes.data : []).map((k) => [k.id, k]));
  const copy: Copy = { m, f, locale };

  return (
    <LiveRegion>
      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <h1 className="pageHead__title">{m.consentsPage.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {m.consentsPage.subtitle}
          </p>
        </div>
      </div>

      <div className="ac-stackPage">
        {res.data.map((c) => {
          const kid = kids.get(c.childId);
          const given = kid?.givenName ?? c.childName.split(' ')[0];
          const full = kid ? childDisplayName(kid) : c.childName;
          return (
            <div key={c.childId} className="fam-stack" style={{ ['--gap' as string]: '12px' }}>
              {!c.canManage && <ReadOnlyNote m={m} owner={kid?.ownerName ?? null} />}
              <ConsentsPanel
                copy={copy}
                childId={c.childId}
                child={given}
                consents={c.consents}
                readOnly={!c.canManage}
                title={full}
                headExtra={
                  <Link
                    key="open-access"
                    href={`/${locale}/family/access?child=${encodeURIComponent(c.childId)}`}
                    className="fam-btn fam-btn--sm"
                  >
                    {m.consentsPage.openAccess}
                  </Link>
                }
              />
            </div>
          );
        })}
      </div>
    </LiveRegion>
  );
}
