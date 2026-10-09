'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { sessionApi } from '@/lib/session-api';
import type { Season } from '@/lib/session-types';
import type { SeasonsMessages } from '@/messages/seasons';
import { useSeasonAction } from './useSeasonAction';

interface Draft {
  code: string;
  nameUz: string;
  nameRu: string;
  startsOn: string;
  endsOn: string;
}

type Errs = Partial<Record<'code' | 'names' | 'dates', string>>;

function validate(d: Draft, m: SeasonsMessages, withCode: boolean): Errs {
  const errs: Errs = {};
  if (withCode && !/^\d{4}\/\d{2}$/.test(d.code.trim())) errs.code = m.seasons.codeErr;
  if (!d.nameUz.trim() || !d.nameRu.trim()) errs.names = m.seasons.nameErr;
  if (!d.startsOn || !d.endsOn || d.endsOn <= d.startsOn) errs.dates = m.seasons.datesErr;
  return errs;
}

/**
 * The season list (task.md § 8.5 "Creates the season"): create, edit names
 * and dates, make one current. `?season=<id>` picks whose calendar is shown.
 */
export function SeasonsPanel({
  seasons,
  shownId,
  hrefFor,
  locale,
  m,
}: {
  seasons: Season[];
  shownId: string | null;
  /** `?season=<id>` with the page's other params kept — built on the server. */
  hrefFor: Record<string, string>;
  locale: Locale;
  m: SeasonsMessages;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Season | null>(null);
  const current = seasons.find((s) => s.isCurrent) ?? null;
  const act = useSeasonAction(m);
  const name = (s: Season) => (locale === 'ru' ? s.nameRu : s.nameUz);

  async function makeCurrent() {
    if (!confirm) return;
    const ok = await act.run(
      () => sessionApi.makeCurrent(confirm.id),
      () => fill(m.seasons.currentDone, { code: confirm.code }),
    );
    if (ok) setConfirm(null);
  }

  return (
    <section className="fam-panel" aria-labelledby="ss-seasons-title">
      <div className="fam-panel__head">
        <div>
          <h2 id="ss-seasons-title" className="fam-panel__title">
            {m.seasons.title}
          </h2>
          <p className="fam-panel__sub">{m.seasons.sub}</p>
        </div>
        {!creating && (
          <button type="button" className="fam-btn fam-btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} />
            {m.seasons.newOpen}
          </button>
        )}
      </div>

      {creating && <SeasonForm m={m} onDone={() => setCreating(false)} />}

      {seasons.length === 0 ? (
        !creating && (
          <div className="fam-note">
            <Icon name="calendar" size={18} />
            <div>
              <strong>{m.seasons.emptyTitle}</strong> {m.seasons.emptyBody}
            </div>
          </div>
        )
      ) : (
        <ul className="ss-seasons">
          {seasons.map((s) =>
            editing === s.id ? (
              <li key={s.id}>
                <SeasonForm m={m} season={s} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={s.id} className="ss-season" data-shown={s.id === shownId}>
                <div className="ss-season__main">
                  <span className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
                    <span className="ss-season__code mono">{s.code}</span>
                    {s.isCurrent && <span className="chip chip--success">{m.seasons.current}</span>}
                  </span>
                  <span className="ss-season__name">{name(s)}</span>
                  <span className="fam-small fam-muted">
                    {locale === 'ru' ? s.nameUz : s.nameRu} ·{' '}
                    {fill(m.seasons.datesFmt, { from: formatDate(s.startsOn, locale), to: formatDate(s.endsOn, locale) })}
                  </span>
                </div>
                <div className="ss-season__actions">
                  {s.id === shownId ? (
                    <span className="fam-small fam-muted" aria-current="true">
                      <Icon name="calendar" size={14} /> {m.seasons.shown}
                    </span>
                  ) : (
                    <Link href={hrefFor[s.id]} className="fam-btn fam-btn--sm" scroll={false}>
                      {m.seasons.show}
                    </Link>
                  )}
                  <button type="button" className="fam-btn fam-btn--sm fam-btn--quiet" onClick={() => setEditing(s.id)}>
                    <Icon name="edit" size={16} />
                    {m.seasons.edit}
                  </button>
                  {!s.isCurrent && (
                    <button
                      type="button"
                      className="fam-btn fam-btn--sm"
                      onClick={() => {
                        act.setError(null);
                        setConfirm(s);
                      }}
                    >
                      {m.seasons.makeCurrent}
                    </button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <ConfirmDialog
        open={confirm !== null}
        danger={false}
        icon="calendar"
        title={fill(m.seasons.currentTitle, { code: confirm?.code ?? '' })}
        body={m.seasons.currentBody}
        list={m.seasons.currentList.map((line) =>
          fill(line, { code: confirm?.code ?? '', old: current?.code ?? '—' }),
        )}
        confirmLabel={m.seasons.currentConfirm}
        cancelLabel={m.seasons.cancel}
        busy={act.busy}
        error={act.error}
        onConfirm={makeCurrent}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
}

/** Create (no `season`) or edit names and dates of one season. The code never changes. */
function SeasonForm({ m, season, onDone }: { m: SeasonsMessages; season?: Season; onDone: () => void }) {
  const act = useSeasonAction(m);
  const [d, setD] = useState<Draft>({
    code: season?.code ?? '',
    nameUz: season?.nameUz ?? '',
    nameRu: season?.nameRu ?? '',
    startsOn: season?.startsOn ?? '',
    endsOn: season?.endsOn ?? '',
  });
  const [makeCurrent, setMakeCurrent] = useState(false);
  const [errs, setErrs] = useState<Errs>({});
  const id = useId();
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(d, m, !season);
    setErrs(found);
    if (Object.keys(found).length > 0) return;
    const body = { nameUz: d.nameUz.trim(), nameRu: d.nameRu.trim(), startsOn: d.startsOn, endsOn: d.endsOn };
    const ok = season
      ? await act.run(() => sessionApi.patchSeason(season.id, body), () => fill(m.seasons.saved, { code: season.code }))
      : await act.run(
          () => sessionApi.createSeason({ code: d.code.trim(), ...body, makeCurrent }),
          () => fill(m.seasons.created, { code: d.code.trim() }),
        );
    if (ok) onDone();
  }

  return (
    <form className="ss-form" onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="ss-form__title">
        {season ? season.code : m.seasons.newTitle}
      </h3>
      <fieldset className="ss-fieldset" disabled={act.busy}>
        {!season && (
          <div className="fam-field" style={{ maxWidth: 200 }}>
            <label className="fam-label" htmlFor={`${id}-code`}>
              {m.seasons.codeLbl}
            </label>
            <input
              id={`${id}-code`}
              className="fam-input mono"
              value={d.code}
              placeholder={m.seasons.codePh}
              inputMode="numeric"
              maxLength={7}
              autoFocus
              aria-invalid={!!errs.code || undefined}
              aria-describedby={errs.code ? `${id}-code-e` : undefined}
              onChange={set('code')}
            />
            {errs.code && (
              <span id={`${id}-code-e`} className="fam-caption fam-caption--bad">
                {errs.code}
              </span>
            )}
          </div>
        )}
        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-uz`}>
              {m.seasons.nameUzLbl}
            </label>
            <input
              id={`${id}-uz`}
              className="fam-input"
              value={d.nameUz}
              maxLength={120}
              autoFocus={!!season}
              aria-invalid={(!!errs.names && !d.nameUz.trim()) || undefined}
              aria-describedby={errs.names ? `${id}-names-e` : undefined}
              onChange={set('nameUz')}
            />
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-ru`}>
              {m.seasons.nameRuLbl}
            </label>
            <input
              id={`${id}-ru`}
              className="fam-input"
              value={d.nameRu}
              maxLength={120}
              aria-invalid={(!!errs.names && !d.nameRu.trim()) || undefined}
              aria-describedby={errs.names ? `${id}-names-e` : undefined}
              onChange={set('nameRu')}
            />
          </div>
        </div>
        {errs.names && (
          <span id={`${id}-names-e`} className="fam-caption fam-caption--bad">
            {errs.names}
          </span>
        )}
        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-from`}>
              {m.seasons.startsLbl}
            </label>
            <input
              id={`${id}-from`}
              type="date"
              className="fam-input"
              value={d.startsOn}
              aria-invalid={!!errs.dates || undefined}
              aria-describedby={errs.dates ? `${id}-dates-e` : undefined}
              onChange={set('startsOn')}
            />
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-to`}>
              {m.seasons.endsLbl}
            </label>
            <input
              id={`${id}-to`}
              type="date"
              className="fam-input"
              value={d.endsOn}
              min={d.startsOn || undefined}
              aria-invalid={!!errs.dates || undefined}
              aria-describedby={errs.dates ? `${id}-dates-e` : undefined}
              onChange={set('endsOn')}
            />
          </div>
        </div>
        {errs.dates && (
          <span id={`${id}-dates-e`} className="fam-caption fam-caption--bad">
            {errs.dates}
          </span>
        )}
        {!season && (
          <label className="fam-check" htmlFor={`${id}-cur`}>
            <input
              id={`${id}-cur`}
              type="checkbox"
              checked={makeCurrent}
              onChange={(e) => setMakeCurrent(e.target.checked)}
            />
            <span className="fam-stack" style={{ '--gap': '2px' } as React.CSSProperties}>
              <span>{m.seasons.makeCurrentLbl}</span>
              <span className="fam-small fam-muted">{m.seasons.makeCurrentHint}</span>
            </span>
          </label>
        )}
      </fieldset>

      {act.error && (
        <p className="fam-alert" role="alert">
          {act.error}
        </p>
      )}

      <div className="fam-actions">
        <button type="button" className="fam-btn" disabled={act.busy} onClick={onDone}>
          {m.seasons.cancel}
        </button>
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {season ? m.seasons.save : m.seasons.create}
        </button>
      </div>
    </form>
  );
}
