import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { DeletePanel } from '@/components/family/access/DeletePanel';
import { LiveRegion, type Copy } from '@/components/family/access/live';
import { ReadOnlyNote, StateBlock } from '@/components/family/access/parts';
import { Icon } from '@/components/shell/Icon';
import { apiGet } from '@/lib/api-server';
import type { AnonymisationRequest, ChildSummary } from '@/lib/family-types';
import { childDisplayName } from '@/lib/format';
import { isLocale } from '@/lib/i18n';
import { accessMessages } from '@/messages/access';
import { familyMessages } from '@/messages/family';

export const dynamic = 'force-dynamic';

/**
 * `/family/privacy` — anonymisation requests, one panel per child (task.md
 * § 8.1.7). Only the owner may request or cancel; a co-guardian sees the
 * state. Consents are withdrawn on /family/consents, which this links to.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = accessMessages(locale);
  const f = familyMessages(locale);
  const failed = (
    <ErrorState
      title={m.states.errTitle}
      body={m.states.errBody}
      retryHref={`/${locale}/family/privacy`}
      retryLabel={f.common.retry}
    />
  );

  const list = await apiGet<ChildSummary[]>('/api/family/children');
  if (!list.ok) return failed;
  if (list.data.length === 0) {
    return (
      <StateBlock
        title={m.states.noKidsTitle}
        body={m.states.noKidsBody}
        href={`/${locale}/family/children/new`}
        cta={m.states.noKidsCta}
      />
    );
  }

  const requests = await Promise.all(
    list.data.map((k) =>
      apiGet<{ request: AnonymisationRequest | null }>(
        `/api/family/children/${encodeURIComponent(k.id)}/anonymisation-request`,
      ),
    ),
  );
  // A child that 404s here was removed between the two calls; anything else
  // failing means the API is down.
  if (requests.some((r) => !r.ok && r.status !== 404)) return failed;

  const copy: Copy = { m, f, locale };

  return (
    <LiveRegion>
      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <h1 className="pageHead__title">{m.privacyPage.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {m.privacyPage.subtitle}
          </p>
        </div>
      </div>

      <p className="fam-note ac-linkNote">
        <Icon name="info" size={18} />
        <span className="ac-grow">{m.privacyPage.consentsNote}</span>
        <Link href={`/${locale}/family/consents`} className="fam-btn fam-btn--sm">
          {m.privacyPage.consentsLink}
        </Link>
      </p>

      <div className="ac-stackPage">
        {list.data.map((k, i) => {
          const r = requests[i];
          if (!r.ok) return null;
          const readOnly = k.via === 'co_guardian';
          return (
            <div key={k.id} className="fam-stack" style={{ ['--gap' as string]: '12px' }}>
              {readOnly && <ReadOnlyNote m={m} owner={k.ownerName} />}
              <DeletePanel
                copy={copy}
                childId={k.id}
                child={k.givenName}
                childFullName={childDisplayName(k)}
                request={r.data.request}
                readOnly={readOnly}
                title={childDisplayName(k)}
              />
            </div>
          );
        })}
      </div>
    </LiveRegion>
  );
}
