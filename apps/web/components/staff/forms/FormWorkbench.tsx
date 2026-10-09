'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { bankApi } from '@/lib/bank-api';
import type { Candidate, Cluster, FormSlot, FormView, PlanSlot, SlotRole } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { FormsMessages } from '@/messages/forms';
import { CandidatePicker } from './CandidatePicker';
import { AnchorGlyph } from './AnchorGlyph';
import { codeTail, difficultyText } from './shared';
import { useFormAction } from './useFormAction';

type Action = ReturnType<typeof useFormAction>;

/** Practice forms never get an anchor role (INV-08) — the API refuses one too. */
function rolesFor(form: FormView): SlotRole[] {
  return form.mode === 'practice' ? ['scored', 'pretest'] : ['scored', 'anchor', 'pretest'];
}

/**
 * design/14's position grid and the selected-position panel, plus the plan
 * edits (add / remove / change role). Everything shown comes from the server
 * page's `FormView`; each mutation goes to the API and then refreshes it.
 *
 * `main` and `side` are server-rendered cards (difficulty strip; rule checks
 * and freeze) placed under the grid and under the position panel.
 */
export function FormWorkbench({
  form,
  m,
  locale,
  main,
  side,
}: {
  form: FormView;
  m: FormsMessages;
  locale: Locale;
  main: React.ReactNode;
  side: React.ReactNode;
}) {
  const action = useFormAction(m);
  const draft = !form.frozenAt;
  const plan = [...form.plan].sort((a, b) => a.position - b.position);
  const byPos = new Map(form.slots.map((s) => [s.position, s]));
  const invalidRule = form.rules.find((r) => r.id === 'slots_valid');
  const invalid = new Set(
    ((invalidRule?.details.invalid as { position: number }[] | undefined) ?? []).map((x) => x.position),
  );

  const firstEmpty = plan.find((p) => !byPos.has(p.position))?.position;
  const [selected, setSelected] = useState<number | null>(firstEmpty ?? plan[0]?.position ?? null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [addRole, setAddRole] = useState<SlotRole>('scored');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const addId = useId();

  // A removed position falls back to the first one rather than a blank panel.
  const entry = plan.find((p) => p.position === selected) ?? plan[0] ?? null;
  const counts = { scored: 0, anchor: 0, pretest: 0 };
  for (const p of plan) counts[p.role] += 1;
  const last = plan[plan.length - 1];
  const lastSlot = last ? byPos.get(last.position) : undefined;

  // For a core slot, start the candidate list on the cluster that is furthest
  // from the "6–8 per cluster" floor (task.md § 8.5).
  const coverage = form.rules.find((r) => r.id === 'cluster_coverage')?.details.counts as
    | Record<string, number>
    | undefined;
  const thinnest = coverage
    ? (Object.entries(coverage).sort((a, b) => a[1] - b[1])[0]?.[0] as Cluster | undefined)
    : undefined;

  function select(position: number) {
    setAutoOpen(false);
    setSelected(position);
  }

  /** After filling an empty position, go straight to the next empty one. */
  function advanceFrom(position: number) {
    const empty = plan.filter((p) => !byPos.has(p.position) && p.position !== position);
    const next = empty.find((p) => p.position > position) ?? empty[0];
    if (next) {
      setSelected(next.position);
      setAutoOpen(true);
    }
  }

  async function addPosition() {
    const position = (last?.position ?? 0) + 1;
    await action.run(
      'plan',
      () => bankApi.setPlan(form.id, [...form.plan, { position, role: addRole }]),
      () => fill(m.plan.added, { n: position, role: m.role[addRole] }),
    );
  }

  async function removeLast() {
    if (!last) return;
    const ok = await action.run(
      'plan',
      () => bankApi.setPlan(form.id, form.plan.filter((p) => p.position !== last.position)),
      () => fill(m.plan.removed, { n: last.position }),
    );
    if (ok) setConfirmRemove(false);
  }

  return (
    <div className="fam-grid fb-grid">
      <div className="fam-col">
        <section className="fam-panel" aria-labelledby="fb-grid-title">
          <div className="fam-panel__head fb-gridHead">
            <h2 id="fb-grid-title" className="fam-panel__title">
              {fill(m.grid.titleFmt, { n: plan.length })}
            </h2>
            <span className="fam-small fam-muted">{m.grid.caption}</span>
          </div>
          <ul className="fb-legend">
            <li data-role="scored">
              <span className="fb-legend__sw" aria-hidden="true" />
              {m.grid.core} <span className="fam-muted">{counts.scored}</span>
            </li>
            {form.mode !== 'practice' && (
              <li data-role="anchor">
                <span className="fb-legend__sw" aria-hidden="true" />
                {m.grid.anchor} <span className="fam-muted">{counts.anchor}</span>
              </li>
            )}
            <li data-role="pretest">
              <span className="fb-legend__sw" aria-hidden="true" />
              {m.grid.pretest} <span className="fam-muted">{counts.pretest}</span>
            </li>
          </ul>
          {form.mode !== 'practice' && form.grade === 4 && <p className="fam-small fam-muted">{m.grid.noVertical}</p>}

          {plan.length === 0 ? (
            <p className="fam-note">{m.grid.noPositions}</p>
          ) : (
            <ul className="fb-tiles" aria-label={m.grid.label}>
              {plan.map((p) => {
                const s = byPos.get(p.position);
                return (
                  <li key={p.position}>
                    <button
                      type="button"
                      className="fb-tile"
                      data-role={p.role}
                      data-filled={s ? 'true' : 'false'}
                      data-invalid={invalid.has(p.position) ? 'true' : undefined}
                      aria-pressed={entry?.position === p.position}
                      aria-label={fill(m.grid.tileFmt, {
                        n: p.position,
                        role: m.role[p.role],
                        code: s ? s.code : m.grid.empty,
                      })}
                      onClick={() => select(p.position)}
                    >
                      <span className="fb-tile__top">
                        <span className="fb-tile__n">{p.position}</span>
                        {p.role === 'anchor' && <AnchorGlyph />}
                        {p.role === 'pretest' && <Icon name="ban" size={14} />}
                        {invalid.has(p.position) && <Icon name="alert" size={14} />}
                      </span>
                      <span className="fb-tile__code mono">{s ? codeTail(s.code) : '—'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {draft && (
            <div className="fb-plan">
              <div className="fb-plan__add">
                <div className="fam-field">
                  <label className="fam-label" htmlFor={addId}>
                    {m.plan.addLbl}
                  </label>
                  <select
                    id={addId}
                    className="fam-select"
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value as SlotRole)}
                  >
                    {rolesFor(form).map((r) => (
                      <option key={r} value={r}>
                        {m.role[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="fam-btn"
                  disabled={!!action.busy || (last?.position ?? 0) >= 60}
                  onClick={addPosition}
                >
                  <Icon name="plus" size={18} />
                  {m.plan.add}
                </button>
              </div>
              {last && (
                <button
                  type="button"
                  className="fam-btn fam-btn--quiet"
                  disabled={!!action.busy}
                  onClick={() => (lastSlot ? setConfirmRemove(true) : removeLast())}
                >
                  <Icon name="trash" size={18} />
                  {m.plan.removeLast}
                </button>
              )}
              {action.errorFor('plan') && !confirmRemove && (
                <p className="fam-alert" role="alert">
                  {action.errorFor('plan')}
                </p>
              )}
            </div>
          )}
        </section>
        {main}
      </div>

      <div className="fam-col">
        {entry ? (
          <SlotPanel
            key={entry.position}
            form={form}
            entry={entry}
            slot={byPos.get(entry.position)}
            invalid={invalid.has(entry.position)}
            draft={draft}
            autoOpen={autoOpen}
            suggestCluster={entry.role === 'scored' && form.mode !== 'practice' ? thinnest : undefined}
            m={m}
            locale={locale}
            action={action}
            onFilledEmpty={advanceFrom}
          />
        ) : (
          <section className="fam-panel">
            <p className="card__body">{m.grid.noPositions}</p>
          </section>
        )}
        {side}
      </div>

      {last && lastSlot && (
        <ConfirmDialog
          open={confirmRemove}
          title={m.plan.removeTitle}
          body={fill(m.plan.removeBody, { n: last.position, code: lastSlot.code })}
          confirmLabel={m.plan.removeConfirm}
          cancelLabel={m.freeze.cancel}
          busy={action.busy === 'plan'}
          error={action.errorFor('plan')}
          onConfirm={removeLast}
          onClose={() => {
            setConfirmRemove(false);
            action.clearError();
          }}
        />
      )}
    </div>
  );
}

function SlotPanel({
  form,
  entry,
  slot,
  invalid,
  draft,
  autoOpen,
  suggestCluster,
  m,
  locale,
  action,
  onFilledEmpty,
}: {
  form: FormView;
  entry: PlanSlot;
  slot: FormSlot | undefined;
  invalid: boolean;
  draft: boolean;
  autoOpen: boolean;
  suggestCluster: Cluster | undefined;
  m: FormsMessages;
  locale: Locale;
  action: Action;
  onFilledEmpty: (position: number) => void;
}) {
  const pos = entry.position;
  const [picking, setPicking] = useState(draft && autoOpen && !slot);
  const [role, setRole] = useState<SlotRole>(entry.role);
  const roleId = useId();
  const busy = !!action.busy;

  async function use(c: Candidate) {
    const ok = await action.run(
      'fill',
      () => bankApi.fill(form.id, pos, c.itemVersionId),
      () =>
        slot ? fill(m.slot.replaced, { old: slot.code, new: c.code }) : fill(m.slot.filled, { n: pos, code: c.code }),
    );
    if (!ok) return;
    setPicking(false);
    if (!slot) onFilledEmpty(pos);
  }

  async function clear() {
    await action.run('fill', () => bankApi.fill(form.id, pos, null), () => fill(m.slot.cleared, { n: pos }));
  }

  async function changeRole() {
    await action.run(
      'role',
      () => bankApi.setPlan(form.id, form.plan.map((p) => (p.position === pos ? { ...p, role } : p))),
      () => fill(m.plan.roleChanged, { n: pos, role: m.role[role] }),
    );
  }

  return (
    <section className="fam-panel fb-slot" data-role={entry.role} aria-labelledby="fb-slot-title">
      <div className="fb-slot__head">
        <span className="card__kicker">{fill(m.slot.posFmt, { n: pos })}</span>
        <span className="fb-roleTag" data-role={entry.role}>
          {m.role[entry.role]}
        </span>
      </div>

      {slot ? (
        <>
          <div className="fam-inline" style={{ '--gap': '10px' } as React.CSSProperties}>
            <h3 id="fb-slot-title" className="fb-slot__code mono">
              {slot.code}
            </h3>
            <span className="fam-tag">{fill(m.slot.versionFmt, { n: slot.version })}</span>
          </div>
          <dl className="fb-facts">
            <div>
              <dt>{m.slot.cluster}</dt>
              <dd>{m.cluster[slot.cluster]}</dd>
            </div>
            <div>
              <dt>{m.slot.difficulty}</dt>
              <dd>{difficultyText(slot, m, locale)}</dd>
            </div>
            <div>
              <dt>{m.slot.scored}</dt>
              <dd>{slot.isScored ? m.slot.yes : m.slot.noPretest}</dd>
            </div>
            <div>
              <dt>{m.slot.langs}</dt>
              <dd>{slot.bilingual ? m.slot.bothLangs : m.slot.uzOnly}</dd>
            </div>
            <div>
              <dt>{m.slot.used}</dt>
              <dd>
                {slot.usedInWaves && slot.usedInWaves.length > 0
                  ? fill(m.slot.usedFmt, { list: slot.usedInWaves.join(', ') })
                  : m.slot.usedNew}
              </dd>
            </div>
          </dl>
          <p className="fam-small fam-muted fb-slot__stem" lang="uz">
            {slot.stemUz}
          </p>
          {invalid && (
            <p className="fam-note fam-note--danger">
              <Icon name="alert" size={18} />
              <span>{m.slot.invalid}</span>
            </p>
          )}
        </>
      ) : (
        <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <h3 id="fb-slot-title" className="fam-panel__title">
            {m.slot.emptyTitle}
          </h3>
          {draft && <p className="fam-small fam-muted">{m.slot.emptyBody}</p>}
        </div>
      )}

      {!draft ? (
        <>
          <p className="fam-note">
            <Icon name="lock" size={18} />
            <span>{m.slot.frozenNote}</span>
          </p>
          {slot && (
            <Link href={`/${locale}/staff/items/${slot.itemId}`} className="fam-btn">
              {m.slot.openItem}
            </Link>
          )}
        </>
      ) : (
        <>
          <div className="fam-inline" style={{ '--gap': '10px' } as React.CSSProperties}>
            <button
              type="button"
              className={slot ? 'fam-btn' : 'fam-btn fam-btn--primary'}
              aria-expanded={picking}
              onClick={() => setPicking((v) => !v)}
            >
              <Icon name={picking ? 'x' : slot ? 'edit' : 'plus'} size={18} />
              {picking ? m.slot.replaceClose : slot ? m.slot.replace : m.slot.choose}
            </button>
            {slot && (
              <>
                <button type="button" className="fam-btn fam-btn--quiet" disabled={busy} onClick={clear}>
                  {m.slot.clear}
                </button>
                <Link href={`/${locale}/staff/items/${slot.itemId}`} className="fam-btn fam-btn--quiet">
                  {m.slot.openItem}
                </Link>
              </>
            )}
          </div>
          {action.errorFor('fill') && (
            <p className="fam-alert" role="alert">
              {action.errorFor('fill')}
            </p>
          )}
          {picking && (
            <CandidatePicker
              formId={form.id}
              position={pos}
              mode={form.mode}
              initialCluster={slot?.cluster ?? suggestCluster ?? ''}
              m={m}
              locale={locale}
              busy={busy}
              onUse={use}
            />
          )}

          <div className="fb-roleEdit">
            <div className="fam-field">
              <label className="fam-label" htmlFor={roleId}>
                {m.plan.changeRoleLbl}
              </label>
              <select
                id={roleId}
                className="fam-select"
                value={role}
                onChange={(e) => setRole(e.target.value as SlotRole)}
              >
                {rolesFor(form).map((r) => (
                  <option key={r} value={r}>
                    {m.role[r]}
                  </option>
                ))}
              </select>
            </div>
            {role !== entry.role && (
              <>
                {slot && (
                  <p className="fam-note fam-note--warn">
                    <Icon name="alert" size={18} />
                    <span>{m.plan.changeRoleWarn}</span>
                  </p>
                )}
                <button type="button" className="fam-btn" disabled={busy} onClick={changeRole}>
                  {m.plan.changeRole}
                </button>
              </>
            )}
            {action.errorFor('role') && (
              <p className="fam-alert" role="alert">
                {action.errorFor('role')}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
