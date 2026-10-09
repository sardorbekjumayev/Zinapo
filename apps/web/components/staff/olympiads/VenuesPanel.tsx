'use client';

import { Fragment, useId, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import type { Region } from '@/lib/family-types';
import { regionName } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { olympiadApi } from '@/lib/olympiad-api';
import type { OlympiadDetail, StaffVenue } from '@/lib/olympiad-types';
import type { OlympiadsMessages } from '@/messages/olympiads';
import { formatNum, formatWhen, fromLocalInput, toLocalInput } from './shared';
import { useOlympiadAction } from './useOlympiadAction';

type Stage = OlympiadDetail['stages'][number];

/**
 * Venues of the in-person stages (task.md § 8.5, § 11): capacity, who is
 * seated and checked in, proctors, and the one SMS with the address. Each
 * row opens a panel to edit it, manage its proctors and notify families.
 */
export function VenuesPanel({
  olympiadId,
  venues,
  stages,
  regions,
  locale,
  m,
}: {
  olympiadId: string;
  venues: StaffVenue[];
  /** The in-person stages that are set. */
  stages: Stage[];
  regions: Region[];
  locale: Locale;
  m: OlympiadsMessages;
}) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const region = (v: StaffVenue) =>
    v.regionUz ? regionName({ nameUz: v.regionUz, nameRu: v.regionRu ?? v.regionUz }, locale) : m.venues.regionAny;
  const cols = 10;

  return (
    <section className="fam-panel" id="oa-venues" aria-labelledby="oa-venues-title">
      <div className="fam-panel__head">
        <div>
          <h2 id="oa-venues-title" className="fam-panel__title">
            {m.venues.title}
          </h2>
          <p className="fam-panel__sub">{m.venues.sub}</p>
        </div>
        {!adding && stages.length > 0 && (
          <button type="button" className="fam-btn fam-btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            {m.venues.add}
          </button>
        )}
      </div>

      {stages.length === 0 && venues.length === 0 ? (
        <p className="fam-note">
          <Icon name="pin" size={18} />
          <span>{m.venues.noInPerson}</span>
        </p>
      ) : null}

      {adding && (
        <VenueForm olympiadId={olympiadId} stages={stages} regions={regions} locale={locale} m={m} onDone={() => setAdding(false)} />
      )}

      {venues.length === 0 ? (
        stages.length > 0 &&
        !adding && (
          <p className="fam-note">
            <Icon name="pin" size={18} />
            <span>
              <strong>{m.venues.emptyTitle}</strong> {m.venues.emptyBody}
            </span>
          </p>
        )
      ) : (
        <div className="oa-tableWrap">
          <table className="oa-table">
            <thead>
              <tr>
                <th scope="col">{m.venues.th.name}</th>
                <th scope="col">{m.venues.th.region}</th>
                <th scope="col">{m.venues.th.address}</th>
                <th scope="col">{m.venues.th.start}</th>
                <th scope="col" className="oa-num">
                  {m.venues.th.capacity}
                </th>
                <th scope="col" className="oa-num">
                  {m.venues.th.seated}
                </th>
                <th scope="col" className="oa-num">
                  {m.venues.th.checkedIn}
                </th>
                <th scope="col">{m.venues.th.proctors}</th>
                <th scope="col">{m.venues.th.stage}</th>
                <th scope="col">
                  <span className="visually-hidden">{m.venues.th.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {venues.map((v) => {
                const isOpen = open === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr className={isOpen ? 'oa-row--open' : undefined}>
                      <th scope="row">{v.name}</th>
                      <td>{region(v)}</td>
                      <td className="oa-wrap">{v.address}</td>
                      <td>{formatWhen(v.startsAt, locale, true)}</td>
                      <td className="oa-num">{formatNum(v.capacity)}</td>
                      <td className="oa-num">{v.seated}</td>
                      <td className="oa-num">{v.checkedIn}</td>
                      <td>
                        {v.proctors && v.proctors.length > 0 ? (
                          v.proctors.map((p) => p.name).join(', ')
                        ) : (
                          <span className="fam-tag fam-tag--warn">{m.venues.noProctors}</span>
                        )}
                      </td>
                      <td>{m.stage[v.stageKind]}</td>
                      <td>
                        <button
                          type="button"
                          className="fam-btn fam-btn--sm fam-btn--quiet"
                          aria-expanded={isOpen}
                          aria-controls={`oa-venue-${v.id}`}
                          aria-label={isOpen ? m.venues.close : fill(m.venues.manageAria, { name: v.name })}
                          onClick={() => setOpen(isOpen ? null : v.id)}
                        >
                          <Icon name={isOpen ? 'x' : 'settings'} size={16} />
                          {isOpen ? m.venues.close : m.venues.manage}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="oa-row--panel">
                        <td colSpan={cols} id={`oa-venue-${v.id}`}>
                          <VenueManager olympiadId={olympiadId} venue={v} regions={regions} locale={locale} m={m} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface Draft {
  stageId: string;
  regionId: string;
  name: string;
  address: string;
  capacity: string;
  startsAt: string;
}

type Errs = Partial<Record<keyof Draft, string>>;

function validate(d: Draft, m: OlympiadsMessages): Errs {
  const e: Errs = {};
  if (!d.regionId) e.regionId = m.venues.regionErr;
  if (d.name.trim().length < 2) e.name = m.venues.nameErr;
  if (d.address.trim().length < 2) e.address = m.venues.addressErr;
  const cap = Number(d.capacity.trim());
  if (!/^\d+$/.test(d.capacity.trim()) || cap < 1 || cap > 100_000) e.capacity = m.venues.capacityErr;
  if (!fromLocalInput(d.startsAt)) e.startsAt = m.venues.startErr;
  return e;
}

/** Add a venue (no `venue`) or edit one. Region is required: families only see venues of their own region. */
function VenueForm({
  olympiadId,
  stages,
  venue,
  regions,
  locale,
  m,
  onDone,
}: {
  olympiadId: string;
  stages?: Stage[];
  venue?: StaffVenue;
  regions: Region[];
  locale: Locale;
  m: OlympiadsMessages;
  onDone: () => void;
}) {
  const act = useOlympiadAction(m);
  const id = useId();
  const [d, setD] = useState<Draft>({
    stageId: venue?.stageId ?? stages?.[0]?.id ?? '',
    regionId: venue?.regionId ? String(venue.regionId) : '',
    name: venue?.name ?? '',
    address: venue?.address ?? '',
    capacity: venue ? String(venue.capacity) : '',
    startsAt: venue ? toLocalInput(venue.startsAt) : '',
  });
  const [errs, setErrs] = useState<Errs>({});
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(d, m);
    setErrs(found);
    if (Object.keys(found).length > 0) return;
    const body = {
      regionId: Number(d.regionId),
      name: d.name.trim(),
      address: d.address.trim(),
      capacity: Number(d.capacity.trim()),
      startsAt: fromLocalInput(d.startsAt)!,
    };
    const ok = venue
      ? await act.run(
          () => olympiadApi.updateVenue(olympiadId, venue.id, body),
          () => fill(m.venues.saved, { name: body.name }),
        )
      : await act.run(
          () => olympiadApi.createVenue(olympiadId, { stageId: d.stageId, ...body }),
          () => fill(m.venues.created, { name: body.name }),
        );
    if (ok && !venue) onDone();
  }

  const field = (k: keyof Draft) => ({
    id: `${id}-${k}`,
    'aria-invalid': !!errs[k] || undefined,
    'aria-describedby': errs[k] ? `${id}-${k}-e` : undefined,
  });
  const errOf = (k: keyof Draft) =>
    errs[k] && (
      <span id={`${id}-${k}-e`} className="fam-caption fam-caption--bad">
        {errs[k]}
      </span>
    );

  return (
    <form className={venue ? 'oa-form oa-form--flat' : 'oa-form'} onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="oa-form__title">
        {venue ? m.venues.editTitle : m.venues.addTitle}
      </h3>
      <fieldset className="oa-fieldset" disabled={act.busy}>
        <div className="fam-row">
          {!venue && stages && (
            <div className="fam-field">
              <label className="fam-label" htmlFor={`${id}-stageId`}>
                {m.venues.stageLbl}
              </label>
              <select className="fam-select" value={d.stageId} onChange={set('stageId')} {...field('stageId')}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {m.stage[s.kind]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-regionId`}>
              {m.venues.regionLbl}
            </label>
            <select className="fam-select" value={d.regionId} onChange={set('regionId')} {...field('regionId')}>
              <option value="" disabled>
                {m.venues.regionChoose}
              </option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {regionName(r, locale)}
                </option>
              ))}
            </select>
            {errOf('regionId')}
          </div>
        </div>
        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-name`}>
              {m.venues.nameLbl}
            </label>
            <input
              className="fam-input"
              value={d.name}
              maxLength={120}
              placeholder={m.venues.namePh}
              autoFocus={!venue}
              onChange={set('name')}
              {...field('name')}
            />
            {errOf('name')}
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-address`}>
              {m.venues.addressLbl}
            </label>
            <input className="fam-input" value={d.address} maxLength={300} onChange={set('address')} {...field('address')} />
            {errOf('address')}
          </div>
        </div>
        <div className="fam-row">
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-capacity`}>
              {m.venues.capacityLbl}
            </label>
            <input
              className="fam-input mono"
              inputMode="numeric"
              value={d.capacity}
              onChange={set('capacity')}
              {...field('capacity')}
              aria-describedby={[errs.capacity && `${id}-capacity-e`, venue && `${id}-seated`].filter(Boolean).join(' ') || undefined}
            />
            {errOf('capacity')}
            {venue && venue.seated > 0 && (
              <span id={`${id}-seated`} className="fam-caption">
                {fill(m.venues.seatedNote, { n: venue.seated })}
              </span>
            )}
          </div>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-startsAt`}>
              {m.venues.startLbl}
            </label>
            <input type="datetime-local" className="fam-input" value={d.startsAt} onChange={set('startsAt')} {...field('startsAt')} />
            {errOf('startsAt') ?? (
              <span className="fam-caption">
                <Icon name="clock" size={14} />
                {m.stages.tzHint}
              </span>
            )}
          </div>
        </div>
      </fieldset>

      {act.error && (
        <p className="fam-alert" role="alert">
          {act.error}
        </p>
      )}

      <div className="fam-actions">
        {!venue ? (
          <button type="button" className="fam-btn" disabled={act.busy} onClick={onDone}>
            {m.venues.cancel}
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="fam-btn fam-btn--primary" disabled={act.busy} aria-busy={act.busy}>
          {act.busy && <span className="spinner" aria-hidden="true" />}
          {venue ? m.venues.save : m.venues.create}
        </button>
      </div>
    </form>
  );
}

/** One venue opened: its details, its proctors, and "send venue details to families". */
function VenueManager({
  olympiadId,
  venue,
  regions,
  locale,
  m,
}: {
  olympiadId: string;
  venue: StaffVenue;
  regions: Region[];
  locale: Locale;
  m: OlympiadsMessages;
}) {
  const id = useId();
  const add = useOlympiadAction(m);
  const remove = useOlympiadAction(m);
  const notify = useOlympiadAction(m);
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function addProctor(e: React.FormEvent) {
    e.preventDefault();
    if (phone.replace(/\D/g, '').length < 7) return setPhoneErr(m.venues.proctorPhoneErr);
    setPhoneErr(null);
    const ok = await add.run(
      () => olympiadApi.addProctor(olympiadId, venue.id, phone.trim()),
      () => m.venues.proctorAdded,
    );
    if (ok) setPhone('');
  }

  async function send() {
    const ok = await notify.run(
      () => olympiadApi.notifyVenue(olympiadId, venue.id),
      (r) => fill(m.venues.notified, { sent: r.sent, already: r.already }),
    );
    if (ok) setConfirm(false);
  }

  return (
    <div className="oa-manager">
      <VenueForm olympiadId={olympiadId} venue={venue} regions={regions} locale={locale} m={m} onDone={() => {}} />

      <div className="oa-manager__side">
        <div className="fam-stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <h3 className="oa-form__title">{m.venues.proctorsTitle}</h3>
          <p className="fam-small fam-muted">{m.venues.proctorsSub}</p>
        </div>
        {venue.proctors && venue.proctors.length > 0 ? (
          <ul className="oa-proctors">
            {venue.proctors.map((p) => (
              <li key={p.personId}>
                <span>{p.name}</span>
                <button
                  type="button"
                  className="fam-btn fam-btn--sm fam-btn--quiet"
                  disabled={remove.busy}
                  aria-label={fill(m.venues.proctorRemoveAria, { name: p.name })}
                  onClick={() =>
                    remove.run(
                      () => olympiadApi.removeProctor(olympiadId, venue.id, p.personId),
                      () => fill(m.venues.proctorRemoved, { name: p.name }),
                    )
                  }
                >
                  <Icon name="trash" size={16} />
                  {m.venues.proctorRemove}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fam-small fam-muted">{m.venues.noProctors}</p>
        )}
        {remove.error && (
          <p className="fam-alert" role="alert">
            {remove.error}
          </p>
        )}
        <form className="oa-inlineForm" onSubmit={addProctor} noValidate>
          <div className="fam-field">
            <label className="fam-label" htmlFor={`${id}-ph`}>
              {m.venues.proctorPhoneLbl}
            </label>
            <input
              id={`${id}-ph`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="fam-input mono"
              value={phone}
              placeholder={m.venues.proctorPhonePh}
              disabled={add.busy}
              aria-invalid={!!phoneErr || undefined}
              aria-describedby={phoneErr ? `${id}-ph-e` : undefined}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <button type="submit" className="fam-btn" disabled={add.busy} aria-busy={add.busy}>
            {add.busy && <span className="spinner" aria-hidden="true" />}
            {m.venues.proctorAdd}
          </button>
        </form>
        {phoneErr && (
          <span id={`${id}-ph-e`} className="fam-caption fam-caption--bad">
            {phoneErr}
          </span>
        )}
        {add.error && (
          <p className="fam-alert" role="alert">
            {add.error}
          </p>
        )}

        <div className="oa-manager__notify">
          <button
            type="button"
            className="fam-btn"
            onClick={() => {
              notify.setError(null);
              setConfirm(true);
            }}
          >
            <Icon name="mail" size={18} />
            {m.venues.notify}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        danger={false}
        icon="mail"
        title={fill(m.venues.notifyTitle, { name: venue.name })}
        body={m.venues.notifyBody}
        list={m.venues.notifyList}
        confirmLabel={m.venues.notifyConfirm}
        cancelLabel={m.venues.cancel}
        busy={notify.busy}
        error={notify.error}
        onConfirm={send}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
