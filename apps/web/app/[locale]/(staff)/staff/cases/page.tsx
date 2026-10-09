import { ErrorState } from '@/components/family/ErrorState';
import { DecidedApplications, WaitingApplications } from '@/components/staff/cases/Applications';
import { Preapprovals } from '@/components/staff/cases/Preapprovals';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { EducatorApplication, Preapproval } from '@/lib/educator-types';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { casesMessages } from '@/messages/cases';

export const dynamic = 'force-dynamic';

/**
 * `/staff/cases` — trust & safety's queue (task.md § 8.5). M6 builds the
 * educator applications tab; fraud flags, ownership disputes and the fifth
 * child arrive in M8 and are shown disabled so the shape is visible now.
 */
export default async function CasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = casesMessages(locale);
  const self = `/${locale}/staff/cases`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'educator.decide')) return noAccess;

  const [waiting, decided, pre] = await Promise.all([
    apiGet<EducatorApplication[]>('/api/staff/educator-applications'),
    apiGet<EducatorApplication[]>('/api/staff/educator-applications?status=decided'),
    apiGet<Preapproval[]>('/api/staff/educator-preapprovals'),
  ]);
  if (!waiting.ok || !decided.ok || !pre.ok) {
    if ([waiting, decided, pre].some((r) => !r.ok && r.status === 403)) return noAccess;
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }

  const later = [m.tabs.fraud, m.tabs.ownership, m.tabs.fifth];

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{m.head.title}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {m.head.subtitle}
            </p>
          </div>
        </div>

        <div className="iv-tabs" role="tablist" aria-label={m.tabs.label}>
          <button type="button" role="tab" id="iv-tab-apps" aria-selected="true" aria-controls="iv-panel-apps" className="iv-tab">
            {m.tabs.applications}
            <span className="iv-tab__count">{waiting.data.length}</span>
          </button>
          {later.map((label) => (
            <button key={label} type="button" role="tab" aria-selected="false" disabled className="iv-tab">
              {label}
              <span className="iv-tab__soon">{m.tabs.soon}</span>
            </button>
          ))}
        </div>

        <div id="iv-panel-apps" role="tabpanel" aria-labelledby="iv-tab-apps" className="iv-casesGrid">
          <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            <section className="fam-panel iv-panel" aria-labelledby="iv-waiting-title">
              <div>
                <h2 id="iv-waiting-title" className="fam-panel__title">
                  {m.apps.waitingT}
                </h2>
                <p className="fam-panel__sub">{m.apps.waitingSub}</p>
              </div>
              <WaitingApplications locale={locale} m={m} list={waiting.data} />
            </section>
            <section className="fam-panel iv-panel" aria-labelledby="iv-decided-title">
              <div>
                <h2 id="iv-decided-title" className="fam-panel__title">
                  {m.apps.decidedT}
                </h2>
                <p className="fam-panel__sub">{m.apps.decidedSub}</p>
              </div>
              <DecidedApplications locale={locale} m={m} list={decided.data} />
            </section>
          </div>
          <Preapprovals locale={locale} m={m} list={pre.data} />
        </div>
      </div>
    </LiveRegion>
  );
}
