import { displayPhone } from '@/components/educator/invites/shared';
import { ErrorState } from '@/components/family/ErrorState';
import { DecidedApplications, WaitingApplications } from '@/components/staff/cases/Applications';
import { Preapprovals } from '@/components/staff/cases/Preapprovals';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { CaseRows, QueueFilters, QueueTabs } from '@/components/staff/trust/CaseQueue';
import { BUCKETS, type Bucket, queueHref, TAB_KIND, TABS, type Tab } from '@/components/staff/trust/shared';
import { apiGet } from '@/lib/api-server';
import type { EducatorApplication, Preapproval } from '@/lib/educator-types';
import { hasPermission } from '@/lib/me';
import type { CaseList } from '@/lib/trust-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { casesMessages } from '@/messages/cases';
import { trustMessages } from '@/messages/trust';

export const dynamic = 'force-dynamic';

/**
 * `/staff/cases?tab=&status=&mine=1` — trust & safety's one queue (task.md
 * § 8.5, design/15): fraud flags, ownership disputes, fifth-child requests
 * and (M6) educator applications. Rules raise flags; people decide here.
 */
export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; status?: string; mine?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const sp = await searchParams;
  const t = trustMessages(locale);
  const m = casesMessages(locale);

  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'fraud';
  const asked: Bucket = (BUCKETS as readonly string[]).includes(sp.status ?? '') ? (sp.status as Bucket) : 'open';
  const status: Bucket = asked === 'waiting' && tab !== 'fraud' ? 'open' : asked;
  const mine = sp.mine === '1';
  const self = queueHref(locale, { tab, status, mine });

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={t.states.noAccessTitle}
      body={t.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: t.states.noAccessCta, primary: true }]}
    />
  );
  const canCases = hasPermission(me, 'case.read');
  const canApps = hasPermission(me, 'educator.decide');
  if (tab === 'applications' ? !canApps : !canCases) return noAccess;

  const q = new URLSearchParams({ kind: TAB_KIND[tab], bucket: status });
  if (mine) q.set('mine', '1');
  const casesRes = canCases ? await apiGet<CaseList>(`/api/staff/cases?${q}`) : null;
  if (casesRes && !casesRes.ok) {
    if (casesRes.status === 403) return noAccess;
    return <ErrorState title={t.states.errTitle} body={t.states.errBody} retryHref={self} retryLabel={t.states.retry} />;
  }
  const counts = casesRes?.ok ? casesRes.data.counts : {};

  const head = (
    <>
      <div className="pageHead">
        <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h1 className="pageHead__title">{t.head.title}</h1>
          <p className="card__body" style={{ maxWidth: '62ch' }}>
            {t.head.subtitle}
          </p>
        </div>
      </div>
      <QueueTabs locale={locale} m={t} tab={tab} counts={counts} status={status} mine={mine} />
    </>
  );

  if (tab !== 'applications') {
    return (
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        {head}
        <QueueFilters locale={locale} m={t} tab={tab} status={status} mine={mine} />
        <CaseRows locale={locale} m={t} tab={tab} status={status} mine={mine} list={casesRes?.ok ? casesRes.data.cases : []} />
      </div>
    );
  }

  // Educator applications: M6's panels, decided there (task.md § 8.5).
  const [waiting, decided, pre] = await Promise.all([
    apiGet<EducatorApplication[]>('/api/staff/educator-applications'),
    apiGet<EducatorApplication[]>('/api/staff/educator-applications?status=decided'),
    apiGet<Preapproval[]>('/api/staff/educator-preapprovals'),
  ]);
  if (!waiting.ok || !decided.ok || !pre.ok) {
    if ([waiting, decided, pre].some((r) => !r.ok && r.status === 403)) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }

  // Phones reach the client spaced ("+998 90 123 45 67"): the queue's HTML never
  // carries a bare number (task.md § 8.5 privacy), and these are display-only.
  const spaced = <T extends { phone: string }>(xs: T[]): T[] => xs.map((x) => ({ ...x, phone: displayPhone(x.phone) }));

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        {head}
        <div className="iv-casesGrid">
          <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            <section className="fam-panel iv-panel" aria-labelledby="iv-waiting-title">
              <div>
                <h2 id="iv-waiting-title" className="fam-panel__title">
                  {m.apps.waitingT}
                </h2>
                <p className="fam-panel__sub">{m.apps.waitingSub}</p>
              </div>
              <WaitingApplications locale={locale} m={m} list={spaced(waiting.data)} />
            </section>
            <section className="fam-panel iv-panel" aria-labelledby="iv-decided-title">
              <div>
                <h2 id="iv-decided-title" className="fam-panel__title">
                  {m.apps.decidedT}
                </h2>
                <p className="fam-panel__sub">{m.apps.decidedSub}</p>
              </div>
              <DecidedApplications locale={locale} m={m} list={spaced(decided.data)} />
            </section>
          </div>
          <Preapprovals locale={locale} m={m} list={spaced(pre.data)} />
        </div>
      </div>
    </LiveRegion>
  );
}
