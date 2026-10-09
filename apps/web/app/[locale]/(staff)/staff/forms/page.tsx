import Link from 'next/link';
import { ErrorState } from '@/components/family/ErrorState';
import { Icon } from '@/components/shell/Icon';
import { NewFormPanel } from '@/components/staff/forms/NewFormPanel';
import { LiveRegion } from '@/components/staff/review/live';
import { StateBlock } from '@/components/staff/review/StateBlock';
import { apiGet } from '@/lib/api-server';
import type { FormListRow, FormMode } from '@/lib/bank-types';
import { formatDate } from '@/lib/format';
import { fill } from '@/lib/i18n';
import { hasPermission } from '@/lib/me';
import { requireWorkspace } from '@/lib/workspace-guard';
import { formsMessages } from '@/messages/forms';

export const dynamic = 'force-dynamic';

const MODES: FormMode[] = ['monitoring', 'practice', 'olympiad'];
const GRADES = [0, 1, 2, 3, 4];

/**
 * `/staff/forms?mode&grade` — the bank editor's list of forms (task.md § 8.5
 * "Builds wave forms"), with "New form" from a template (design/14).
 * Filters are a plain GET form so the choice lives in the URL.
 */
export default async function FormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string; grade?: string }>;
}) {
  const { locale: raw } = await params;
  const { locale, me } = await requireWorkspace(raw, 'staff');
  const sp = await searchParams;
  const m = formsMessages(locale);
  const self = `/${locale}/staff/forms`;

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

  const mode = MODES.find((x) => x === sp.mode);
  const gradeNum = sp.grade !== undefined && sp.grade !== '' ? Number(sp.grade) : NaN;
  const grade = GRADES.includes(gradeNum) ? gradeNum : undefined;
  const query = new URLSearchParams();
  if (mode) query.set('mode', mode);
  if (grade !== undefined) query.set('grade', String(grade));
  const filtered = query.size > 0;

  const res = await apiGet<FormListRow[]>(`/api/staff/forms${filtered ? `?${query}` : ''}`);
  if (!res.ok) {
    if (res.status === 403) return noAccess;
    return (
      <ErrorState
        title={m.states.listErrTitle}
        body={m.states.listErrBody}
        retryHref={filtered ? `${self}?${query}` : self}
        retryLabel={m.states.retry}
      />
    );
  }
  const forms = res.data;

  return (
    <LiveRegion>
      <div className="fam-stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="pageHead">
          <div className="fam-stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h1 className="pageHead__title">{m.list.title}</h1>
            <p className="card__body" style={{ maxWidth: '62ch' }}>
              {m.list.subtitle}
            </p>
          </div>
        </div>

        <NewFormPanel m={m} locale={locale}>
          <form method="get" action={self} className="fb-filters" aria-label={m.list.filtersLabel}>
            <div className="fam-field">
              <label className="fam-label" htmlFor="fb-f-mode">
                {m.list.modeLbl}
              </label>
              <select id="fb-f-mode" name="mode" className="fam-select" defaultValue={mode ?? ''}>
                <option value="">{m.list.all}</option>
                {MODES.map((x) => (
                  <option key={x} value={x}>
                    {m.mode[x]}
                  </option>
                ))}
              </select>
            </div>
            <div className="fam-field">
              <label className="fam-label" htmlFor="fb-f-grade">
                {m.list.gradeLbl}
              </label>
              <select id="fb-f-grade" name="grade" className="fam-select" defaultValue={grade ?? ''}>
                <option value="">{m.list.all}</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="fam-btn">
              {m.list.apply}
            </button>
            {filtered && (
              <Link href={self} className="fam-btn fam-btn--quiet">
                {m.list.clear}
              </Link>
            )}
          </form>
        </NewFormPanel>

        {forms.length === 0 ? (
          filtered ? (
            <StateBlock
              icon="inbox"
              title={m.list.filterEmptyTitle}
              body={m.list.filterEmptyBody}
              links={[{ href: self, label: m.list.clear, primary: true }]}
            />
          ) : (
            <StateBlock
              icon="file"
              title={m.list.emptyTitle}
              body={m.list.emptyBody}
              links={[{ href: `/${locale}/staff/items`, label: m.list.bankCta }]}
            />
          )
        ) : (
          <ul className="fb-list">
            {forms.map((f) => (
              <li key={f.id}>
                <Link href={`${self}/${f.id}`} className="fb-row" data-mode={f.mode}>
                  <span className="fb-row__main">
                    <span className="fb-row__label">{f.label}</span>
                    <span className="fam-small fam-muted">
                      {fill(m.head.gradeFmt, { g: f.grade })} ·{' '}
                      {f.seasonCode ? fill(m.list.seasonFmt, { s: f.seasonCode }) : m.list.noSeason} ·{' '}
                      {fill(m.list.createdFmt, { d: formatDate(f.createdAt, locale) })}
                    </span>
                  </span>
                  <span className="fam-inline" style={{ '--gap': '6px' } as React.CSSProperties}>
                    <span className={`chip chip--${f.mode === 'olympiad' ? 'neutral' : f.mode}`}>{m.mode[f.mode]}</span>
                    {f.frozenAt ? (
                      <span className="chip chip--neutral">
                        <Icon name="lock" size={14} />
                        {m.head.chipFrozen}
                      </span>
                    ) : (
                      <span className="chip chip--warning">{m.head.chipDraft}</span>
                    )}
                    {f.waveOrdinal !== null && (
                      <span className="chip chip--neutral">{fill(m.list.waveFmt, { n: f.waveOrdinal })}</span>
                    )}
                  </span>
                  <span className="fb-row__fill">
                    {f.planned > 0 ? (
                      <>
                        <span className="fam-small">{fill(m.list.filledFmt, { f: f.filled, p: f.planned })}</span>
                        <span className="fb-bar" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, (f.filled / f.planned) * 100)}%` }} />
                        </span>
                      </>
                    ) : (
                      <span className="fam-small fam-muted">{m.list.noPlan}</span>
                    )}
                  </span>
                  <Icon name="arrowRight" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LiveRegion>
  );
}
