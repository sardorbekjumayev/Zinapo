import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { AwardsPanel } from '@/components/staff/olympiads/AwardsPanel';
import { EntriesPanel } from '@/components/staff/olympiads/EntriesPanel';
import { ResultsPanel } from '@/components/staff/olympiads/ResultsPanel';
import { RulesPanel } from '@/components/staff/olympiads/RulesPanel';
import { gradeRange, gradesText, STAGE_KINDS, titleOf } from '@/components/staff/olympiads/shared';
import { StagesPanel } from '@/components/staff/olympiads/StagesPanel';
import { VenuesPanel } from '@/components/staff/olympiads/VenuesPanel';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { Region } from '@/lib/family-types';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import type { OlympiadDetail, OlympiadForm, StaffAward, StaffEntry } from '@/lib/olympiad-types';
import { requireWorkspace } from '@/lib/workspace-guard';
import { olympiadsMessages } from '@/messages/olympiads';

export const dynamic = 'force-dynamic';

/**
 * `/staff/olympiads/[id]?stage=` — one olympiad for its operator (task.md
 * § 8.5): rules, stages with the form per grade, final venues and proctors,
 * the entries of one stage, results and awards. Mutations refresh this page.
 */
export default async function OlympiadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { locale: raw, id } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const sp = await searchParams;
  const m = olympiadsMessages(locale);
  const list = `/${locale}/staff/olympiads`;
  const self = `${list}/${id}`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'olympiad.manage')) return noAccess;
  const canResults = hasPermission(me, 'olympiad.results');

  const [res, regionsRes] = await Promise.all([
    apiGet<OlympiadDetail>(`/api/staff/olympiads/${encodeURIComponent(id)}`),
    apiGet<Region[]>('/api/reference/regions'),
  ]);
  if (!res.ok && res.status === 403) return noAccess;
  if (!res.ok && res.status === 404) {
    return (
      <StateBlock
        icon="trophy"
        title={m.states.notFoundTitle}
        body={m.states.notFoundBody}
        links={[{ href: list, label: m.head.back, primary: true }]}
      />
    );
  }
  const retryHref = sp.stage ? `${self}?stage=${encodeURIComponent(sp.stage)}` : self;
  if (!res.ok || !regionsRes.ok) {
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={retryHref} retryLabel={m.states.retry} />;
  }
  const o = res.data;
  const stages = [...o.stages].sort((a, b) => STAGE_KINDS.indexOf(a.kind) - STAGE_KINDS.indexOf(b.kind));
  // Default tab: the first stage anyone entered, else the first stage set.
  const shown = stages.find((s) => s.id === sp.stage) ?? stages.find((s) => s.entries > 0) ?? stages[0] ?? null;
  const grades = gradeRange(o.gradeMin, o.gradeMax);

  const [entriesRes, awardsRes, ...formsRes] = await Promise.all([
    shown ? apiGet<StaffEntry[]>(`/api/staff/olympiads/${o.id}/stages/${shown.id}/entries`) : Promise.resolve(null),
    canResults ? apiGet<StaffAward[]>(`/api/staff/olympiads/${o.id}/awards`) : Promise.resolve(null),
    ...grades.map((g) => apiGet<OlympiadForm[]>(`/api/staff/olympiads/forms?grade=${g}`)),
  ]);
  if (formsRes.some((r) => !r.ok)) {
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={retryHref} retryLabel={m.states.retry} />;
  }
  const formsByGrade = Object.fromEntries(grades.map((g, i) => [g, formsRes[i].ok ? formsRes[i].data : []]));
  const entries = entriesRes ? (entriesRes.ok ? entriesRes.data : null) : [];
  const hrefFor = Object.fromEntries(stages.map((s) => [s.id, `${self}?stage=${s.id}#oa-entries`]));
  const hasEntries = stages.some((s) => s.entries > 0);
  const title = titleOf(o, locale);

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <Link href={list} className="oa-back">
          <Icon name="arrowLeft" size={16} />
          {m.head.back}
        </Link>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{title}</h1>
            <span className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
              <span className="chip chip--code mono">{o.slug}</span>
              <span className="chip chip--neutral">{gradesText(o.gradeMin, o.gradeMax, m)}</span>
              {o.isRanked ? (
                <span className="chip chip--success">{m.list.ranked}</span>
              ) : (
                <span className="chip chip--warning">{m.list.marathon}</span>
              )}
              <span className="chip chip--monitoring">{fill(m.list.seasonFmt, { code: o.seasonCode })}</span>
            </span>
          </div>
        </div>

        <RulesPanel o={o} hasEntries={hasEntries} locale={locale} m={m} />
        <StagesPanel o={o} formsByGrade={formsByGrade} formsHref={`/${locale}/staff/forms`} locale={locale} m={m} />
        <VenuesPanel
          olympiadId={o.id}
          venues={o.venues}
          stages={stages.filter((s) => s.inPerson)}
          regions={regionsRes.data}
          locale={locale}
          m={m}
        />
        <EntriesPanel
          stages={stages}
          shown={shown}
          entries={entries}
          hrefFor={hrefFor}
          retryHref={shown ? hrefFor[shown.id] : self}
          locale={locale}
          m={m}
        />
        {canResults && <ResultsPanel o={o} locale={locale} m={m} />}
        {canResults && (
          <AwardsPanel awards={awardsRes?.ok ? awardsRes.data : null} retryHref={`${retryHref}#oa-awards`} locale={locale} m={m} />
        )}
      </div>
    </LiveRegion>
  );
}
