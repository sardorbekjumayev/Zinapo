import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { AssignPanel } from '@/components/staff/trust/AssignPanel';
import { DisputeDecision } from '@/components/staff/trust/DisputeDecision';
import { FifthDecision } from '@/components/staff/trust/FifthDecision';
import { FraudDecision } from '@/components/staff/trust/FraudDecision';
import { EducatorPanel, EvidencePanel, WhyPanel } from '@/components/staff/trust/FraudPanels';
import { NotesPanel } from '@/components/staff/trust/NotesPanel';
import { ApplicationPanel, DisputePanel, FifthPanel, ResolutionPanel } from '@/components/staff/trust/OtherPanels';
import { KIND_TAB, queueHref, ruleTitle, sevChip, statusChip, when } from '@/components/staff/trust/shared';
import { apiGet } from '@/lib/api-server';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { CaseDetail, CaseStaff } from '@/lib/trust-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { trustMessages } from '@/messages/trust';

export const dynamic = 'force-dynamic';

/**
 * `/staff/cases/[id]` — one case (design/15): what raised it, the evidence,
 * the people involved (masked), the notes, and the decision. Closed cases are
 * read-only with the outcome in words. Mutations refresh this page.
 */
export default async function CasePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = trustMessages(locale);
  const self = `/${locale}/staff/cases/${encodeURIComponent(id)}`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'case.read')) return noAccess;

  const [res, staffRes] = await Promise.all([
    apiGet<CaseDetail>(`/api/staff/cases/${encodeURIComponent(id)}`),
    apiGet<CaseStaff[]>('/api/staff/cases/staff'),
  ]);
  if (!res.ok && res.status === 403) return noAccess;
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    return (
      <StateBlock
        icon="shield"
        title={m.states.notFoundTitle}
        body={m.states.notFoundBody}
        links={[{ href: queueHref(locale), label: m.head.back, primary: true }]}
      />
    );
  }
  if (!res.ok) return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;

  const c = res.data;
  const f = c.fraud;
  const closed = c.status === 'resolved' || c.status === 'dismissed';
  const canResolve = hasPermission(me, 'case.resolve');
  const sev = sevChip(f?.severity ?? null, m);
  const st = statusChip(c.kind, c.status, c.resolution, m);
  const title = c.kind === 'fraud_flag' ? ruleTitle(f?.rule ?? null, m) : m.kindTitle[c.kind];
  const back = queueHref(locale, { tab: KIND_TAB[c.kind], status: closed ? 'closed' : c.status === 'waiting_owner' ? 'waiting' : 'open' });
  const isDispute = c.kind === 'ownership_dispute';

  let decision: React.ReactNode = null;
  if (closed) decision = <ResolutionPanel c={c} locale={locale} m={m} />;
  else if (canResolve && c.kind === 'fraud_flag' && f) decision = <FraudDecision c={c} m={m} />;
  else if (canResolve && isDispute && c.dispute) decision = <DisputeDecision c={c} m={m} />;
  else if (canResolve && c.kind === 'fifth_child' && c.fifthChild) decision = <FifthDecision c={c} m={m} />;

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <Link href={back} className="ts-back">
          <Icon name="arrowLeft" size={16} />
          {m.head.back}
        </Link>

        <header className="fam-panel ts-head">
          <div className="ts-head__top">
            <span className="mono ts-head__code">{f?.rule ?? c.kind}</span>
            <span className="ts-head__chips">
              {sev && <span className={sev.cls}>{sev.label}</span>}
              <span className="chip chip--code">{c.reference}</span>
              <span className={st.cls}>{st.label}</span>
            </span>
          </div>
          <h1 className="ts-head__title">{title}</h1>
          <p className="fam-small fam-muted">
            {f?.subject && `${f.subject.name} · `}
            {f?.raisedAt ? fill(m.detail.raised, { when: when(f.raisedAt, locale, true) }) : fill(m.detail.opened, { when: when(c.openedAt, locale, true) })}
          </p>
        </header>

        <div className="fam-grid">
          <div className="fam-col">
            {f && (
              <>
                <WhyPanel f={f} m={m} />
                <EvidencePanel f={f} locale={locale} m={m} />
                <EducatorPanel c={c} f={f} locale={locale} m={m} />
              </>
            )}
            {c.dispute && <DisputePanel c={c} locale={locale} m={m} />}
            {c.fifthChild && <FifthPanel c={c} locale={locale} m={m} />}
            {c.kind === 'educator_application' && <ApplicationPanel c={c} locale={locale} m={m} />}
            <NotesPanel
              c={c}
              locale={locale}
              m={m}
              title={isDispute ? m.dispute.statementsT : m.notes.title}
              sub={isDispute ? m.dispute.statementsSub : undefined}
              addLabel={isDispute ? m.dispute.callNote : m.notes.add}
              placeholder={isDispute ? m.dispute.callNotePh : m.notes.ph}
            />
          </div>
          <div className="fam-col">
            {decision}
            <AssignPanel c={c} staff={staffRes.ok ? staffRes.data : []} meId={me.person.id} m={m} />
          </div>
        </div>
      </div>
    </LiveRegion>
  );
}
