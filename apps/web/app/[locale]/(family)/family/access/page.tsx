import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/family/ErrorState';
import { ChangeLog } from '@/components/family/access/ChangeLog';
import { ConsentsPanel } from '@/components/family/access/ConsentsPanel';
import { DeletePanel } from '@/components/family/access/DeletePanel';
import { LiveRegion, type Copy } from '@/components/family/access/live';
import { AccessEmpty, ChildPicker, ReadOnlyNote, StateBlock } from '@/components/family/access/parts';
import { RequestsPanel } from '@/components/family/access/RequestsPanel';
import { WhoPanel } from '@/components/family/access/WhoPanel';
import { apiGet } from '@/lib/api-server';
import type {
  AnonymisationRequest,
  ChangeLogPage,
  ChildSummary,
  ConsentState,
  EducatorAccess,
  GuardianView,
  PendingInvite,
  UntilOptions,
} from '@/lib/family-types';
import { childDisplayName } from '@/lib/format';
import { isLocale } from '@/lib/i18n';
import { accessMessages } from '@/messages/access';
import { familyMessages } from '@/messages/family';

export const dynamic = 'force-dynamic';

/** Statuses that belong under "Who can see"; declined/expired links are history only. */
const VISIBLE = new Set(['active', 'suspended', 'revoked']);

/**
 * `/family/access?child=<id>` — design/06, the whole board for one child:
 * educator requests, who can see, change log, consents and deletion
 * (task.md § 8.1.5–8.1.7).
 *
 * Everything is fetched here and handed to small client panels that call
 * `familyApi` and then `router.refresh()`, so after any change the page is
 * re-read from the API rather than patched locally.
 */
export default async function AccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ child?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { child: wanted } = await searchParams;
  const m = accessMessages(locale);
  const f = familyMessages(locale);
  const self = `/${locale}/family/access`;
  const retryHref = wanted ? `${self}?child=${encodeURIComponent(wanted)}` : self;
  const failed = (
    <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={retryHref} retryLabel={f.common.retry} />
  );

  const list = await apiGet<ChildSummary[]>('/api/family/children');
  if (!list.ok) return failed;
  const kids = list.data;

  if (kids.length === 0) {
    return (
      <StateBlock
        title={m.states.noKidsTitle}
        body={m.states.noKidsBody}
        href={`/${locale}/family/children/new`}
        cta={m.states.noKidsCta}
      />
    );
  }

  const kid = wanted ? kids.find((k) => k.id === wanted) : kids[0];
  // An id that isn't in this person's list is "not yours / gone" — the same
  // 404 the API would give, without asking it.
  if (!kid) {
    return (
      <StateBlock
        icon="alert"
        title={f.common.notFoundTitle}
        body={f.common.notFoundBody}
        href={self}
        cta={f.common.toChildren}
      />
    );
  }

  const base = `/api/family/children/${encodeURIComponent(kid.id)}`;
  const [edu, grd, cons, log, anon] = await Promise.all([
    apiGet<{ links: EducatorAccess[]; until: UntilOptions }>(`${base}/educators`),
    apiGet<{ guardians: GuardianView[]; pending: PendingInvite[] }>(`${base}/guardians`),
    apiGet<ConsentState[]>(`${base}/consents`),
    apiGet<ChangeLogPage>(`${base}/changelog?limit=6`),
    apiGet<{ request: AnonymisationRequest | null }>(`${base}/anonymisation-request`),
  ]);
  const results = [edu, grd, cons, log, anon];
  if (results.some((r) => !r.ok && r.status === 404)) {
    return (
      <StateBlock
        icon="alert"
        title={f.common.notFoundTitle}
        body={f.common.notFoundBody}
        href={self}
        cta={f.common.toChildren}
      />
    );
  }
  if (!edu.ok || !grd.ok || !cons.ok || !log.ok || !anon.ok) return failed;

  const copy: Copy = { m, f, locale };
  const readOnly = kid.via === 'co_guardian';
  const child = kid.givenName;
  const requests = edu.data.links.filter((l) => l.status === 'requested');
  const educators = edu.data.links.filter((l) => VISIBLE.has(l.status));
  const nobody = requests.length === 0 && educators.length === 0;

  return (
    <LiveRegion>
      <div className="pageHead">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <h1 className="pageHead__title">{m.page.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {m.page.subtitle}
          </p>
        </div>
        {kids.length > 1 && (
          <ChildPicker
            kids={kids}
            selected={kid.id}
            href={(id) => `${self}?child=${encodeURIComponent(id)}`}
            label={m.page.kidsLabel}
            locale={locale}
          />
        )}
      </div>

      {readOnly && <ReadOnlyNote m={m} owner={kid.ownerName} />}

      {/* Keyed by child so panel state (an open approve form, loaded log
          pages) never leaks from one child to the next. */}
      <div className="fam-grid ac-grid" key={kid.id}>
        <div className="fam-col">
          {nobody ? (
            <AccessEmpty
              m={m}
              schoolYearEnd={edu.data.until.schoolYearEnd}
              reportHref={`/${locale}/family/children/${kid.id}`}
              locale={locale}
            />
          ) : (
            <RequestsPanel
              copy={copy}
              child={child}
              requests={requests}
              until={edu.data.until}
              readOnly={readOnly}
            />
          )}
          <WhoPanel
            copy={copy}
            childId={kid.id}
            child={child}
            guardians={grd.data.guardians}
            pending={grd.data.pending}
            educators={educators}
            readOnly={readOnly}
          />
          <ChangeLog
            key={`${log.data.total}:${log.data.entries[0]?.id ?? ''}`}
            copy={copy}
            childId={kid.id}
            initial={log.data}
          />
        </div>
        <div className="fam-col">
          <ConsentsPanel
            copy={copy}
            childId={kid.id}
            child={child}
            consents={cons.data}
            readOnly={readOnly}
          />
          <DeletePanel
            copy={copy}
            childId={kid.id}
            child={child}
            childFullName={childDisplayName(kid)}
            request={anon.data.request}
            readOnly={readOnly}
          />
        </div>
      </div>
    </LiveRegion>
  );
}
