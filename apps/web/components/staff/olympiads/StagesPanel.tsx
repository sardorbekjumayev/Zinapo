'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { olympiadApi } from '@/lib/olympiad-api';
import type { OlympiadDetail, OlympiadForm, StageKind } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { formatWhen, fromLocalInput, gradeName, gradeRange, IN_PERSON, STAGE_KINDS, toLocalInput } from './shared';
import { useOlympiadAction } from './useOlympiadAction';

type Stage = OlympiadDetail['stages'][number];

/**
 * The four stages in season order (task.md § 8.5): each either set — dates,
 * state, counts, and the form per grade — or "not set" with a form to plan
 * it. A published stage is history: no more date changes from here.
 */
export function StagesPanel({
  o,
  formsByGrade,
  formsHref,
  locale,
  m,
}: {
  o: OlympiadDetail;
  formsByGrade: Record<number, OlympiadForm[]>;
  formsHref: string;
  locale: Locale;
  m: OlympiadsMessages;
}) {
  return (
    <section className="fam-panel" id="oa-stages" aria-labelledby="oa-stages-title">
      <div>
        <h2 id="oa-stages-title" className="fam-panel__title">
          {m.stages.title}
        </h2>
        <p className="fam-panel__sub">{m.stages.sub}</p>
      </div>
      <ol className="oa-stages">
        {STAGE_KINDS.map((kind, i) => (
          <StageCard
            key={kind}
            n={i + 1}
            kind={kind}
            stage={o.stages.find((s) => s.kind === kind) ?? null}
            o={o}
            formsByGrade={formsByGrade}
            formsHref={formsHref}
            locale={locale}
            m={m}
          />
        ))}
      </ol>
    </section>
  );
}

function StageCard({
  n,
  kind,
  stage,
  o,
  formsByGrade,
  formsHref,
  locale,
  m,
}: {
  n: number;
  kind: StageKind;
  stage: Stage | null;
  o: OlympiadDetail;
  formsByGrade: Record<number, OlympiadForm[]>;
  formsHref: string;
  locale: Locale;
  m: OlympiadsMessages;
}) {
  const [editing, setEditing] = useState(false);
  const inPerson = IN_PERSON.includes(kind);
  const titleId = useId();

  return (
    <li className="oa-stage" data-set={stage ? 'true' : 'false'} aria-labelledby={titleId}>
      <div className="oa-stage__head">
        <span className="oa-stage__n" aria-hidden="true">
          {n}
        </span>
        <div className="fam-stack" style={{ '--gap': '4px', flex: 1, minWidth: 0 } as React.CSSProperties}>
          <h3 id={titleId} className="oa-stage__title">
            {m.stage[kind]}
          </h3>
          <span className="fam-inline" style={{ '--gap': '6px' } as React.CSSProperties}>
            <span className={inPerson ? 'fam-tag fam-tag--brand' : 'fam-tag fam-tag--blue'}>
              <Icon name={inPerson ? 'pin' : 'home'} size={14} />
              {inPerson ? m.stages.inPerson : m.stages.online}
            </span>
            {stage ? (
              <span className={`chip oa-chip--${stage.state}`}>{m.stageState[stage.state]}</span>
            ) : (
              <span className="chip chip--neutral">{m.stages.notSet}</span>
            )}
            {stage?.resultsPublishedAt && (
              <span className="fam-tag fam-tag--ok">
                <Icon name="check" size={14} />
                {m.list.published}
              </span>
            )}
          </span>
        </div>
        {!editing && !stage?.resultsPublishedAt && (
          <button type="button" className="fam-btn fam-btn--sm" onClick={() => setEditing(true)}>
            <Icon name={stage ? 'edit' : 'calendar'} size={16} />
            {stage ? m.stages.edit : m.stages.set}
          </button>
        )}
      </div>

      {editing ? (
        <StageForm o={o} kind={kind} stage={stage} m={m} onDone={() => setEditing(false)} />
      ) : !stage ? (
        <p className="fam-small fam-muted">{m.stages.notSetBody}</p>
      ) : (
        <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <span className="oa-stage__when">
            <Icon name="calendar" size={16} />
            {fill(m.stages.windowFmt, { from: formatWhen(stage.opensAt, locale, true), to: formatWhen(stage.closesAt, locale, true) })}
          </span>
          {stage.registrationClosesAt && (
            <span className="fam-small fam-muted">{fill(m.stages.regFmt, { date: formatWhen(stage.registrationClosesAt, locale) })}</span>
          )}
          <span className="fam-small">
            {fill(m.stages.entriesFmt, { n: stage.entries })} · {fill(m.stages.submittedFmt, { n: stage.submitted })}
          </span>
        </div>
      )}

      {stage && (
        <div className="oa-stage__forms">
          <h4 className="oa-stage__sub">{m.stages.formsTitle}</h4>
          <ul className="oa-formRows">
            {gradeRange(o.gradeMin, o.gradeMax).map((g) => (
              <FormRow key={g} o={o} stage={stage} grade={g} forms={formsByGrade[g] ?? []} formsHref={formsHref} m={m} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function StageForm({
  o,
  kind,
  stage,
  m,
  onDone,
}: {
  o: OlympiadDetail;
  kind: StageKind;
  stage: Stage | null;
  m: OlympiadsMessages;
  onDone: () => void;
}) {
  const act = useOlympiadAction(m);
  const id = useId();
  const [opens, setOpens] = useState(stage ? toLocalInput(stage.opensAt) : '');
  const [closes, setCloses] = useState(stage ? toLocalInput(stage.closesAt) : '');
  const [reg, setReg] = useState(stage?.registrationClosesAt ? toLocalInput(stage.registrationClosesAt) : '');
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const op = fromLocalInput(opens);
    const cl = fromLocalInput(closes);
    const rg = reg ? fromLocalInput(reg) : null;
    if (!op || !cl || (reg && !rg)) return setErr(m.stages.dateErr);
    if (cl <= op) return setErr(m.stages.closesErr);
    if (rg && rg > cl) return setErr(m.stages.regErr);
    setErr(null);
    const ok = await act.run(
      () => olympiadApi.setStage(o.id, kind, { opensAt: op, closesAt: cl, registrationClosesAt: rg }),
      () => fill(m.stages.saved, { stage: m.stage[kind] }),
    );
    if (ok) onDone();
  }

  const error = err ?? act.error;

  return (
    <form className="oa-form oa-form--flat" onSubmit={submit} noValidate aria-label={m.stage[kind]}>
      <fieldset className="oa-fieldset" disabled={act.busy}>
        <div className="fam-row" style={{ '--cols': 3 } as React.CSSProperties}>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-o`}>
              {m.stages.opensLbl}
            </label>
            <input
              id={`${id}-o`}
              type="datetime-local"
              className="fam-input"
              value={opens}
              required
              autoFocus
              aria-describedby={`${id}-tz`}
              onChange={(e) => setOpens(e.target.value)}
            />
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-c`}>
              {m.stages.closesLbl}
            </label>
            <input
              id={`${id}-c`}
              type="datetime-local"
              className="fam-input"
              value={closes}
              min={opens || undefined}
              required
              aria-describedby={`${id}-tz`}
              onChange={(e) => setCloses(e.target.value)}
            />
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-r`}>
              {m.stages.regLbl}
            </label>
            <input
              id={`${id}-r`}
              type="datetime-local"
              className="fam-input"
              value={reg}
              max={closes || undefined}
              aria-describedby={`${id}-rh`}
              onChange={(e) => setReg(e.target.value)}
            />
            <span id={`${id}-rh`} className="fam-caption">
              {m.stages.regHint}
            </span>
          </div>
        </div>
        <span id={`${id}-tz`} className="fam-caption">
          <Icon name="clock" size={14} />
          {m.stages.tzHint}
        </span>
      </fieldset>

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}

      <div className="fam-actions">
        <button type="button" className="fam-btn" disabled={act.busy} onClick={onDone}>
          {m.stages.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {m.stages.save}
        </button>
      </div>
    </form>
  );
}

/** One grade of one stage: its form, or a pick from the frozen olympiad forms of that grade. */
function FormRow({
  o,
  stage,
  grade,
  forms,
  formsHref,
  m,
}: {
  o: OlympiadDetail;
  stage: Stage;
  grade: number;
  forms: OlympiadForm[];
  formsHref: string;
  m: OlympiadsMessages;
}) {
  const act = useOlympiadAction(m);
  const id = useId();
  const current = stage.forms.find((f) => f.grade === grade) ?? null;
  const [formId, setFormId] = useState(current?.formId ?? '');
  const gName = gradeName(grade, m);

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    if (!formId || formId === current?.formId) return;
    await act.run(
      () => olympiadApi.setForm(o.id, stage.id, grade, formId),
      () => fill(m.stages.formSaved, { grade: gName }),
    );
  }

  return (
    <li className="oa-formRow">
      <span className="oa-formRow__grade">{gName}</span>
      {stage.state === 'closed' ? (
        <span className="fam-stack" style={{ '--gap': '2px' } as React.CSSProperties}>
          <span className={current ? 'oa-formRow__label' : 'fam-muted'}>{current?.label ?? m.stages.formNone}</span>
          <span className="fam-small fam-muted">
            <Icon name="lock" size={14} /> {m.stages.formLocked}
          </span>
        </span>
      ) : forms.length === 0 ? (
        <span className="fam-stack" style={{ '--gap': '2px' } as React.CSSProperties}>
          <span className={current ? 'oa-formRow__label' : 'fam-muted'}>{current?.label ?? m.stages.formNone}</span>
          <span className="fam-small">
            {m.stages.formsEmpty}{' '}
            <Link href={formsHref} className="oa-link">
              {m.stages.formsEmptyLink}
            </Link>
          </span>
        </span>
      ) : (
        <form className="oa-formRow__pick" onSubmit={attach}>
          <label className="visually-hidden" htmlFor={`${id}-f`}>
            {fill(m.stages.formSelectLbl, { grade: gName })}
          </label>
          <select id={`${id}-f`} className="fam-select" value={formId} disabled={act.busy} onChange={(e) => setFormId(e.target.value)}>
            {!current && <option value="">{m.stages.formChoose}</option>}
            {current && !forms.some((f) => f.id === current.formId) && <option value={current.formId}>{current.label}</option>}
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {fill(m.stages.formFmt, { label: f.label, n: f.items })}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="fam-btn fam-btn--sm"
            disabled={act.busy || !formId || formId === current?.formId}
            aria-busy={act.busy}
          >
            {act.busy && <span className="spinner" aria-hidden="true" />}
            {m.stages.formAttach}
          </button>
          {!current && (
            <span className="fam-caption fam-caption--bad oa-formRow__note">
              <Icon name="alert" size={14} />
              {m.stages.formNone}
            </span>
          )}
          {act.error && (
            <p className="fam-alert oa-formRow__note" role="alert">
              {act.error}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
