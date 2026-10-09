'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { BankApiError, bankApi } from '@/lib/bank-api';
import type { ItemCard, Taxonomy } from '@/lib/bank-types';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import type { EditorMessages } from '@/messages/editor';
import { ItemFields, type ItemFieldErrors } from './ItemFields';
import { OptionsSection } from './OptionsSection';
import { RolePanel } from './RolePanel';
import { CalibrationPanel, PayNote, VersionHistory } from './SidePanels';
import { StemSection, type StemValue } from './StemSection';
import {
  STATUS_CHIP,
  errorText,
  fieldLabel,
  fromVersion,
  needsSkill,
  parseP,
  toPatch,
  topicName,
  validate,
  type Draft,
} from './shared';

type Busy = 'save' | 'submit' | 'newVersion' | 'approve' | 'retire' | null;

/** Codes meaning our copy of the card is stale: re-read it from the server. */
const STALE = new Set(['ITEM_STATE', 'NOT_FOUND']);

const storageKey = (card: ItemCard) => `zinapo.itemDraft:${card.id}:v${card.versions[0]?.version ?? 0}`;

function readStored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode / quota: the guard still warns before leaving.
  }
}

/**
 * design/12 — the item card from first draft to approval (task.md § 8.5).
 *
 * The card lives in client state and every mutation answers with the fresh
 * card, so the screen always shows what the API now holds. Edits are mirrored
 * to sessionStorage per item + version: a dropped connection or a reload
 * loses nothing (design/12 error state), and leaving with unsaved edits asks.
 */
export function ItemEditor({
  initial,
  tax,
  m,
  locale,
}: {
  initial: ItemCard;
  tax: Taxonomy;
  m: EditorMessages;
  locale: Locale;
}) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [viewIdx, setViewIdx] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => fromVersion(initial, initial.versions[0], tax, locale));
  const [baseline, setBaseline] = useState(() => JSON.stringify(fromVersion(initial, initial.versions[0], tax, locale)));
  const [tab, setTab] = useState<'uz' | 'ru'>('uz');
  const [busy, setBusy] = useState<Busy>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [incomplete, setIncomplete] = useState<string[] | null>(null);
  const [editedSince, setEditedSince] = useState(false);
  const [itemErr, setItemErr] = useState<ItemFieldErrors>({});
  const [sent, setSent] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const summaryRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const [focusTarget, setFocusTarget] = useState<'summary' | 'sent' | null>(null);

  const key = storageKey(card);
  const editable = card.can.edit && viewIdx === 0;
  const dirty = card.can.edit && JSON.stringify(draft) !== baseline;
  const liveCodes = useMemo(
    () => new Set(tax.misconceptions.filter((x) => !x.retiredAt).map((x) => x.code)),
    [tax],
  );

  const announce = useCallback((text: string) => {
    setLive('');
    requestAnimationFrame(() => setLive(text));
  }, []);

  const adopt = useCallback(
    (next: ItemCard) => {
      const d = fromVersion(next, next.versions[0], tax, locale);
      setCard(next);
      setViewIdx(0);
      setDraft(d);
      setBaseline(JSON.stringify(d));
      setRestored(false);
    },
    [tax, locale],
  );

  // A server re-read (router.refresh after a stale-state error) hands a new card.
  const lastInitial = useRef(initial);
  useEffect(() => {
    if (lastInitial.current === initial) return;
    lastInitial.current = initial;
    adopt(initial);
  }, [initial, adopt]);

  // Restore edits this device kept but the server never got.
  useEffect(() => {
    if (!card.can.edit) return;
    const raw = readStored(key);
    if (raw && raw !== baseline) {
      try {
        setDraft(JSON.parse(raw) as Draft);
        setRestored(true);
      } catch {
        writeStored(key, null);
      }
    }
    // Only when the open version changes — not on every baseline update.
  }, [key]);

  useEffect(() => {
    if (!card.can.edit) return;
    writeStored(key, dirty ? JSON.stringify(draft) : null);
  }, [draft, dirty, key, card.can.edit]);

  // Unsaved-changes guard: reload/close, and in-app links (captured before
  // Next's router sees the click).
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      if (a.getAttribute('href')?.startsWith('#')) return;
      if (!window.confirm(m.save.leave)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, m.save.leave]);

  useEffect(() => {
    if (focusTarget === 'summary') summaryRef.current?.focus();
    if (focusTarget === 'sent') sentRef.current?.focus();
    if (focusTarget) setFocusTarget(null);
  }, [focusTarget]);

  function edit(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    if (incomplete) setEditedSince(true);
    setSavedAt(null);
  }

  function fail(err: unknown) {
    if (err instanceof BankApiError && err.code === 'NETWORK') {
      setSaveFailed(true);
      return;
    }
    setActionError(errorText(err, m));
    if (err instanceof BankApiError && STALE.has(err.code)) router.refresh();
  }

  async function save(): Promise<ItemCard | null> {
    setActionError(null);
    setSaveFailed(false);
    if (parseP(draft.expectedP) === undefined) {
      document.getElementById('ie-expected')?.focus();
      return null;
    }
    if (card.can.editItemFields) {
      const e: ItemFieldErrors = {};
      if (!draft.topicCode) e.topic = m.newForm.eTopic;
      if (needsSkill(draft.grade) && !draft.skillCode) e.skill = m.newForm.eSkill;
      setItemErr(e);
      if (Object.keys(e).length) {
        document.getElementById(e.topic ? 'ie-card-topic' : 'ie-card-skill')?.focus();
        return null;
      }
    }
    setBusy('save');
    try {
      const next = await bankApi.saveDraft(card.id, toPatch(draft, card.can.editItemFields));
      writeStored(key, null);
      adopt(next);
      setSavedAt(new Date());
      announce(m.save.saved);
      return next;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (dirty && !(await save())) return;
    setActionError(null);
    setBusy('submit');
    try {
      const next = await bankApi.submit(card.id);
      adopt(next);
      setIncomplete(null);
      setSavedAt(null);
      setSent(true);
      announce(m.sent.title);
      setFocusTarget('sent');
    } catch (err) {
      if (err instanceof BankApiError && err.code === 'ITEM_INCOMPLETE') {
        const fields = Array.isArray(err.details.fields) ? (err.details.fields as string[]) : [];
        setIncomplete(fields);
        setEditedSince(false);
        if (!fields.includes('stemUz') && fields.includes('stemRu')) setTab('ru');
        else if (fields.includes('stemUz')) setTab('uz');
        setFocusTarget('summary');
      } else {
        fail(err);
      }
    } finally {
      setBusy(null);
    }
  }

  async function act(kind: 'newVersion' | 'approve' | 'retire') {
    setActionError(null);
    setRetireError(null);
    setBusy(kind);
    try {
      const next = await (kind === 'newVersion'
        ? bankApi.newVersion(card.id)
        : kind === 'approve'
          ? bankApi.approve(card.id)
          : bankApi.retire(card.id));
      adopt(next);
      setSent(false);
      setIncomplete(null);
      setRetireOpen(false);
      announce(
        kind === 'newVersion'
          ? fill(m.done.newVersion, { n: next.versions[0].version })
          : kind === 'approve'
            ? m.done.approved
            : m.done.retired,
      );
    } catch (err) {
      if (kind === 'retire') setRetireError(errorText(err, m));
      else fail(err);
    } finally {
      setBusy(null);
    }
  }

  function discardRestored() {
    writeStored(key, null);
    setDraft(JSON.parse(baseline) as Draft);
    setRestored(false);
  }

  // ------------------------------------------------------------ derived

  const viewed = card.versions[viewIdx] ?? card.versions[0];
  const shown: Draft = editable ? draft : fromVersion(card, viewed, tax, locale);
  const errList = incomplete === null ? [] : editedSince ? validate(draft, liveCodes) : incomplete;
  const errors = new Set(editable ? errList : []);
  const pTyped = editable ? parseP(draft.expectedP) : null;
  const pBad = (editable && pTyped === undefined) || errors.has('expectedP');
  const topic = tax.topics.find((t) => t.code === shown.topicCode);
  const skill = tax.skills.find((s) => s.code === shown.skillCode);
  const clusterName = shown.cluster ? m.cluster[shown.cluster] : '';
  const statusLabel = viewIdx === 0 ? m.status[card.status] : m.frozenChip;
  const busyAny = busy !== null;

  const stemValue: StemValue = {
    stemFormat: shown.stemFormat,
    stemUz: shown.stemUz,
    stemRu: shown.stemRu,
    image: shown.image,
    audioUz: shown.audioUz,
    audioRu: shown.audioRu,
  };

  return (
    <div className="fam-stack ie" style={{ ['--gap' as string]: '24px' }}>
      <nav className="ie-crumb" aria-label={m.crumbBack}>
        <Link href={`/${locale}/staff/items`} className="ie-crumb__back">
          <span aria-hidden="true">‹</span> {m.crumbBack}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="mono">{card.code}</span>
      </nav>

      <header className="pageHead ie-head">
        <div className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
          <div className="ie-titleRow">
            <h1 className="pageHead__title mono">{card.code}</h1>
            <span className={`chip ${viewIdx === 0 ? STATUS_CHIP[card.status] : 'chip--monitoring'}`}>
              {fill(m.versionChip, { n: viewed.version, status: statusLabel })}
            </span>
            {viewIdx === 0 && viewed.frozenAt && (
              <span className="chip chip--neutral">
                <Icon name="lock" size={14} />
                {m.frozenChip}
              </span>
            )}
            {card.isAnchor && (
              <span className="chip chip--warning">
                <Icon name="pin" size={14} />
                {card.anchorKind === 'vertical' ? m.role.v : m.role.h}
              </span>
            )}
          </div>
          <p className="card__body">
            {fill(m.subtitle, { grade: card.grade, cluster: clusterName, author: card.authorName })}
            {topic && ` · ${topicName(topic, locale)}`}
          </p>
        </div>
        <div className="ie-actions">
          {dirty && editable && (
            <span className="fam-small fam-muted ie-dirty">
              <span className="ie-dot" aria-hidden="true" />
              {m.save.dirty}
            </span>
          )}
          {editable && (
            <button type="button" className="fam-btn" onClick={() => void save()} disabled={busyAny} aria-busy={busy === 'save'}>
              {busy === 'save' && <span className="spinner" aria-hidden="true" />}
              {busy === 'save' ? m.actions.saving : m.actions.save}
            </button>
          )}
          {editable && card.can.submit && (
            <button
              type="button"
              className="fam-btn fam-btn--primary"
              onClick={() => void submit()}
              disabled={busyAny}
              aria-busy={busy === 'submit'}
            >
              {busy === 'submit' && <span className="spinner" aria-hidden="true" />}
              {busy === 'submit' ? m.actions.submitting : m.actions.submit}
            </button>
          )}
          {card.can.newVersion && (
            <button
              type="button"
              className={editable ? 'fam-btn' : 'fam-btn fam-btn--primary'}
              onClick={() => void act('newVersion')}
              disabled={busyAny}
              aria-busy={busy === 'newVersion'}
            >
              {busy === 'newVersion' && <span className="spinner" aria-hidden="true" />}
              {m.actions.newVersion}
            </button>
          )}
          {card.can.approve && (
            <button
              type="button"
              className="fam-btn fam-btn--primary"
              onClick={() => void act('approve')}
              disabled={busyAny}
              aria-busy={busy === 'approve'}
            >
              {busy === 'approve' && <span className="spinner" aria-hidden="true" />}
              {m.actions.approve}
            </button>
          )}
          {card.can.retire && (
            <button type="button" className="fam-btn fam-btn--danger" onClick={() => setRetireOpen(true)} disabled={busyAny}>
              {m.actions.retire}
            </button>
          )}
        </div>
      </header>

      <div className="fam-grid ie-grid">
        <div className="fam-col">
          {saveFailed && (
            <div className="fam-note fam-note--danger" role="alert">
              <Icon name="alert" size={18} />
              <span className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
                <strong>{m.save.errTitle}</strong>
                <span>{m.save.errBody}</span>
                <span>
                  <button type="button" className="fam-btn fam-btn--sm" onClick={() => void save()} disabled={busyAny}>
                    {m.save.retry}
                  </button>
                </span>
              </span>
            </div>
          )}
          {actionError && (
            <p className="fam-alert" role="alert">
              {actionError}
            </p>
          )}
          {savedAt && !saveFailed && (
            <div className="fam-alert fam-alert--ok ie-toast">
              <Icon name="check" size={18} />
              <span>
                <strong>{m.save.saved}</strong>
                <br />
                {fill(m.save.savedSub, {
                  time: `${formatDate(savedAt.toISOString(), locale, false)}, ${new Intl.DateTimeFormat('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Tashkent',
                  }).format(savedAt)}`,
                })}
              </span>
              <button type="button" className="fam-btn fam-btn--sm fam-btn--quiet" onClick={() => setSavedAt(null)}>
                {m.save.close}
              </button>
            </div>
          )}
          {restored && editable && (
            <p className="fam-note fam-note--brand">
              <Icon name="info" size={18} />
              <span>
                {m.save.restored}{' '}
                <button type="button" className="ie-link" onClick={discardRestored}>
                  {m.save.discard}
                </button>
              </span>
            </p>
          )}

          {editable && incomplete !== null && (
            <div ref={summaryRef} tabIndex={-1} className={errList.length ? 'ie-sum' : 'ie-sum ie-sum--ok'} role="alert">
              {errList.length ? (
                <>
                  <strong className="ie-sum__title">
                    <Icon name="alert" size={18} />
                    {fill(m.sum.title, { n: errList.length })}
                  </strong>
                  <p className="fam-small">{m.sum.body}</p>
                  <ul className="ie-sum__list">
                    {errList.map((k) => (
                      <li key={k} className="fam-tag fam-tag--danger">
                        {fieldLabel(k, m)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <strong className="ie-sum__title">
                  <Icon name="check" size={18} />
                  {m.sum.fixed}
                </strong>
              )}
            </div>
          )}

          {sent && card.status === 'in_review' && (
            <div ref={sentRef} tabIndex={-1} className="fam-panel ie-sent" role="status">
              <span className="ie-sent__icon" aria-hidden="true">
                <Icon name="check" size={24} />
              </span>
              <h2 className="fam-panel__title">{m.sent.title}</h2>
              <p className="card__body">{m.sent.body}</p>
              <div className="fam-actions">
                <Link href={`/${locale}/staff/items`} className="fam-btn">
                  {m.sent.back}
                </Link>
              </div>
            </div>
          )}

          {!editable && viewed.frozenAt && !sent && (
            <div className="fam-note fam-note--brand ie-frozen">
              <Icon name="lock" size={18} />
              <span className="fam-stack" style={{ ['--gap' as string]: '8px' }}>
                <strong>{fill(m.frozen.title, { n: viewed.version })}</strong>
                <span>
                  {viewIdx === 0 && card.status === 'in_review'
                    ? m.frozen.inReview
                    : fill(m.frozen.body, { n: viewed.version })}
                </span>
                {(card.can.newVersion || viewIdx > 0) && (
                  <span className="ie-inline">
                    {card.can.newVersion && (
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm fam-btn--primary"
                        onClick={() => void act('newVersion')}
                        disabled={busyAny}
                      >
                        {m.actions.newVersion}
                      </button>
                    )}
                    {viewIdx > 0 && (
                      <button type="button" className="fam-btn fam-btn--sm" onClick={() => setViewIdx(0)}>
                        {m.frozen.toCurrent}
                      </button>
                    )}
                  </span>
                )}
              </span>
            </div>
          )}

          <section className="fam-panel" aria-labelledby="ie-card-h">
            <div className="fam-panel__head">
              <h2 id="ie-card-h" className="fam-panel__title">
                {m.card.title}
              </h2>
              {editable && <span className="fam-small fam-muted">{m.card.hint}</span>}
            </div>

            {editable && card.can.editItemFields ? (
              <ItemFields
                value={draft}
                onChange={(v) => {
                  edit({
                    grade: v.grade ?? draft.grade,
                    cluster: v.cluster,
                    topicCode: v.topicCode,
                    skillCode: v.skillCode,
                    construct: v.construct,
                  });
                  if (Object.keys(itemErr).length) setItemErr({});
                }}
                tax={tax}
                m={m}
                locale={locale}
                errors={{ ...itemErr, ...(errors.has('construct') ? { construct: m.newForm.eConstruct } : {}) }}
                idPrefix="ie-card"
              />
            ) : (
              <dl className="ie-dl">
                <div>
                  <dt>{m.card.grade}</dt>
                  <dd>{fill(m.gradeN, { n: card.grade })}</dd>
                </div>
                <div>
                  <dt>{m.card.cluster}</dt>
                  <dd>{clusterName || m.card.none}</dd>
                </div>
                <div>
                  <dt>{m.card.topic}</dt>
                  <dd>{topic ? topicName(topic, locale) : shown.topicCode}</dd>
                </div>
                {needsSkill(card.grade) && (
                  <div>
                    <dt>{m.card.skill}</dt>
                    <dd>{skill ? (locale === 'ru' ? skill.nameRu : skill.nameUz) : shown.skillCode || m.card.none}</dd>
                  </div>
                )}
                <div className="ie-dl__wide">
                  <dt>{m.card.construct}</dt>
                  <dd>{card.construct || m.card.none}</dd>
                </div>
              </dl>
            )}
            {editable && !card.can.editItemFields && (
              <p className="fam-small fam-muted ie-inline">
                <Icon name="lock" size={14} />
                {m.card.locked}
              </p>
            )}

            <div className="fam-field ie-expected">
              <label className="fam-label" htmlFor="ie-expected">
                {m.card.expected}
              </label>
              <input
                id="ie-expected"
                className="fam-input"
                inputMode="decimal"
                value={shown.expectedP}
                readOnly={!editable}
                placeholder={m.card.phExpected}
                aria-invalid={pBad ? 'true' : undefined}
                aria-describedby="ie-expected-hint"
                onChange={(e) => edit({ expectedP: e.target.value })}
              />
              <p id="ie-expected-hint" className={pBad ? 'fam-caption fam-caption--bad' : 'fam-caption'}>
                {pBad ? m.card.eExpected : m.card.expectedHint}
              </p>
            </div>
          </section>

          <StemSection
            value={stemValue}
            onChange={(patch) => edit(patch)}
            grade={editable ? draft.grade : card.grade}
            m={m}
            readOnly={!editable}
            errors={errors}
            tab={tab}
            onTab={setTab}
          />

          <OptionsSection
            options={shown.options}
            onChange={(options) => edit({ options })}
            topicCode={shown.topicCode}
            tax={tax}
            m={m}
            locale={locale}
            readOnly={!editable}
            keysHidden={viewed.keysHidden}
            errors={errors}
          />
        </div>

        <div className="fam-col">
          <VersionHistory card={card} viewIdx={viewIdx} onPick={setViewIdx} m={m} locale={locale} />
          <CalibrationPanel version={viewed} m={m} locale={locale} />
          <RolePanel key={`${card.isAnchor}:${card.anchorKind}:${card.status}`} card={card} onCard={setCard} announce={announce} m={m} locale={locale} />
          <PayNote card={card} m={m} />
        </div>
      </div>

      <ConfirmDialog
        open={retireOpen}
        title={fill(m.retireDlg.title, { code: card.code })}
        body={m.retireDlg.body}
        confirmLabel={m.retireDlg.confirm}
        cancelLabel={m.actions.cancel}
        busy={busy === 'retire'}
        error={retireError}
        onConfirm={() => void act('retire')}
        onClose={() => {
          setRetireOpen(false);
          setRetireError(null);
        }}
      />

      <p className="visually-hidden" role="status" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
