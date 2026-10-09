import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { DifficultyStrip } from '@/components/staff/forms/DifficultyStrip';
import { FormWorkbench } from '@/components/staff/forms/FormWorkbench';
import { FreezeCard } from '@/components/staff/forms/FreezeCard';
import { RuleChecks } from '@/components/staff/forms/RuleChecks';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { FormView } from '@/lib/bank-types';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { formsMessages } from '@/messages/forms';

export const dynamic = 'force-dynamic';

/**
 * `/staff/forms/[id]` — design/14, one form: positions by role, the selected
 * position, rule checks, difficulty spread and freeze (task.md § 8.5 "Bank
 * editor"). Practice and monitoring differ in colour, wording and layout
 * (task.md § 7.1): practice has no anchor row or slots and says why.
 */
export default async function FormPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const m = formsMessages(locale);
  const list = `/${locale}/staff/forms`;
  const self = `${list}/${encodeURIComponent(id)}`;

  const noAccess = (
    <StateBlock
      icon="lock"
      tone="error"
      title={m.states.noAccessTitle}
      body={m.states.noAccessBody}
      links={[{ href: `/${locale}/staff`, label: m.states.noAccessCta, primary: true }]}
    />
  );
  if (!hasPermission(me, 'form.build')) return noAccess;

  const res = await apiGet<FormView>(`/api/staff/forms/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    if (res.status === 404) {
      return (
        <StateBlock
          icon="alert"
          title={m.states.notFoundTitle}
          body={m.states.notFoundBody}
          links={[{ href: list, label: m.states.toList, primary: true }]}
        />
      );
    }
    return <ErrorState title={m.states.errTitle} body={m.states.errBody} retryHref={self} retryLabel={m.states.retry} />;
  }
  const form = res.data;
  const practice = form.mode === 'practice';
  const n = { scored: 0, anchor: 0, pretest: 0 };
  for (const p of form.plan) n[p.role] += 1;
  const sub = fill(practice ? m.head.subPr : m.head.subMon, {
    n: form.plan.length,
    a: n.anchor,
    p: n.pretest,
    c: n.scored,
  });

  return (
    <LiveRegion>
      <div className="fam-stack fb-root" data-mode={form.mode} style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px', flex: 1, minWidth: 0 } as React.CSSProperties}>
            <Link href={list} className="fb-back">
              <Icon name="arrowLeft" size={16} />
              {m.head.back}
            </Link>
            <div className="fam-inline" style={{ '--gap': '12px' } as React.CSSProperties}>
              <h1 className="pageHead__title fb-title">{form.label}</h1>
              <span className={`chip chip--${form.mode === 'olympiad' ? 'neutral' : form.mode}`}>{m.mode[form.mode]}</span>
              <span className="chip chip--neutral">{fill(m.head.gradeFmt, { g: form.grade })}</span>
              {form.frozenAt ? (
                <span className="chip chip--neutral">
                  <Icon name="lock" size={14} />
                  {m.head.chipFrozen}
                </span>
              ) : (
                <span className="chip chip--warning">{m.head.chipDraft}</span>
              )}
            </div>
            <p className="card__body" style={{ maxWidth: '72ch' }}>
              {sub}
              {form.copiedFrom && <span className="fam-muted"> · {m.head.copiedFrom}</span>}
            </p>
          </div>
        </div>

        {practice && (
          <div className="fb-practiceNote" role="note">
            <Icon name="info" size={20} />
            <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
              <strong>{m.head.prTitle}</strong>
              <span className="fam-small">{m.head.prBody}</span>
            </div>
          </div>
        )}

        <FormWorkbench
          form={form}
          m={m}
          locale={locale}
          main={<DifficultyStrip form={form} m={m} locale={locale} />}
          side={
            <>
              <RuleChecks form={form} m={m} />
              <FreezeCard form={form} m={m} locale={locale} />
            </>
          }
        />
      </div>
    </LiveRegion>
  );
}
