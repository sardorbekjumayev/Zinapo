'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { educatorApi } from '@/lib/educator-api';
import type { AssignResult, Misconception, PracticeForm, PracticeTopic } from '@/lib/educator-types';
import { fill, type Locale } from '@/lib/i18n';
import type { PracticeMessages } from '@/messages/practice';
import { SourceSwitch, type BuilderSource } from './SourceSwitch';
import { bankName, errorCode } from './util';

type Build =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'ready'; form: PracticeForm };

type Send =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; result: AssignResult; undoable: boolean }
  | { status: 'undoing'; result: AssignResult }
  | { status: 'undone' };

type Who = 'mistake' | 'all' | 'pick';

/**
 * design/09 builder, task.md § 8.4.6: pick a mistake (or topic) → the server
 * assembles a set without anchors (INV-08, enforced in the SQL) → swap what
 * you don't like → choose who gets it → assign, with a short undo.
 */
export function PracticeBuilder({
  locale,
  m,
  source,
  group,
  wave,
  took,
  mistakes,
  topics,
  groupChildren,
  initialCode,
}: {
  locale: Locale;
  m: Pick<PracticeMessages, 'builder' | 'common'>;
  source: BuilderSource;
  group: { id: string; name: string; grade: number };
  wave: { id: string; ordinal: number } | null;
  took: number;
  mistakes: Misconception[];
  /** null: the topics could not be loaded. */
  topics: PracticeTopic[] | null;
  groupChildren: { id: string; name: string }[];
  initialCode: string | null;
}) {
  const b = m.builder;
  const [code, setCode] = useState<string | null>(initialCode);
  const [build, setBuild] = useState<Build>(initialCode ? { status: 'loading' } : { status: 'idle' });
  const [swapping, setSwapping] = useState<number | null>(null);
  const [swapMsg, setSwapMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [who, setWho] = useState<Who>(source === 'misconception' ? 'mistake' : 'all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [send, setSend] = useState<Send>({ status: 'idle' });
  const [sendError, setSendError] = useState<string | null>(null);
  const seq = useRef(0);
  const started = useRef(false);

  const mistake = source === 'misconception' ? mistakes.find((x) => x.code === code) ?? null : null;
  const topic = source === 'topic' ? topics?.find((x) => x.code === code) ?? null : null;
  const whoOptions: Who[] = source === 'misconception' && mistake ? ['mistake', 'all'] : source === 'topic' ? ['all', 'pick'] : ['all'];
  const effectiveWho: Who = whoOptions.includes(who) ? who : whoOptions[0];
  const recipients =
    effectiveWho === 'mistake' && mistake
      ? mistake.childIds
      : effectiveWho === 'pick'
        ? [...picked]
        : groupChildren.map((c) => c.id);

  const runBuild = useCallback(
    async (next: string) => {
      const mine = ++seq.current;
      setCode(next);
      setBuild({ status: 'loading' });
      setSend({ status: 'idle' });
      setSendError(null);
      setSwapMsg(null);
      // Keep the choice in the URL, so a reload or a shared link lands here.
      const url = new URL(window.location.href);
      url.searchParams.set('code', next);
      window.history.replaceState(null, '', url.toString());
      try {
        const form = await educatorApi.buildPractice({ source, code: next, grade: group.grade });
        if (mine === seq.current) setBuild({ status: 'ready', form });
      } catch (err) {
        if (mine === seq.current) setBuild({ status: 'error', code: errorCode(err) });
      }
    },
    [source, group.grade],
  );

  useEffect(() => {
    // The cabinet's "build practice" link arrives with a code: build at once.
    // The ref keeps React's dev double-effect from assembling two sets.
    if (initialCode && !started.current) {
      started.current = true;
      void runBuild(initialCode);
    }
  }, [initialCode, runBuild]);

  // Undo is offered only until the server's deadline.
  const sentResult = send.status === 'sent' ? send.result : null;
  useEffect(() => {
    if (!sentResult) return;
    const ms = new Date(sentResult.undoUntil).getTime() - Date.now();
    const t = setTimeout(
      () => setSend((s) => (s.status === 'sent' ? { ...s, undoable: false } : s)),
      Math.max(0, ms),
    );
    return () => clearTimeout(t);
  }, [sentResult]);

  async function swap(position: number) {
    if (build.status !== 'ready') return;
    setSwapping(position);
    setSwapMsg(null);
    try {
      const form = await educatorApi.swap(build.form.id, position);
      setBuild({ status: 'ready', form });
      setSwapMsg({ text: fill(b.swapped, { n: position }), bad: false });
    } catch (err) {
      const c = errorCode(err);
      if (c === 'FORM_FROZEN') setBuild({ status: 'ready', form: { ...build.form, frozen: true } });
      const known = b.swapErrors[c as keyof typeof b.swapErrors];
      setSwapMsg({
        text: known ? fill(known, { n: position }) : c === 'NETWORK' ? m.common.networkError : m.common.genericError,
        bad: true,
      });
    } finally {
      setSwapping(null);
    }
  }

  async function assign() {
    if (build.status !== 'ready') return;
    if (recipients.length === 0) {
      setSendError(b.pickNone);
      return;
    }
    setSend({ status: 'sending' });
    setSendError(null);
    try {
      const result = await educatorApi.assign({ formId: build.form.id, childIds: recipients, groupId: group.id });
      // Assigning freezes the set (INV-09): no more swaps.
      setBuild({ status: 'ready', form: { ...build.form, frozen: true } });
      setSend({ status: 'sent', result, undoable: new Date(result.undoUntil).getTime() > Date.now() });
    } catch (err) {
      const c = errorCode(err);
      setSend({ status: 'idle' });
      setSendError(
        b.assignErrors[c as keyof typeof b.assignErrors] ?? (c === 'NETWORK' ? m.common.networkError : m.common.genericError),
      );
    }
  }

  async function undo() {
    if (send.status !== 'sent') return;
    const result = send.result;
    setSend({ status: 'undoing', result });
    setSendError(null);
    try {
      await educatorApi.undo(result.id);
      setSend({ status: 'undone' });
    } catch (err) {
      const c = errorCode(err);
      const known = b.undoErrors[c as keyof typeof b.undoErrors];
      setSend({ status: 'sent', result, undoable: !known });
      setSendError(known ?? (c === 'NETWORK' ? m.common.networkError : m.common.genericError));
    }
  }

  // ------------------------------------------------------------ head

  const title =
    build.status === 'ready' && build.form.source
      ? bankName(locale, build.form.source.nameUz, build.form.source.nameRu)
      : mistake
        ? bankName(locale, mistake.nameUz, mistake.nameRu)
        : topic
          ? bankName(locale, topic.nameUz, topic.nameRu)
          : b.titleDefault;
  const sub =
    source === 'topic'
      ? b.subTopic
      : mistake && wave
        ? fill(b.subMistakeChosen, { n: wave.ordinal, count: mistake.childCount, took })
        : wave
          ? fill(b.subMistake, { group: group.name, n: wave.ordinal })
          : fill(b.subMistakeNoWave, { group: group.name });

  return (
    <>
      <div className="pageHead">
        <div className="pr-head">
          <span className="card__kicker">
            {b.kicker} · {group.name}
          </span>
          <h1 className="pageHead__title">{title}</h1>
          <p className="card__body">{sub}</p>
          <Link href={`/${locale}/educator/practice/new?source=${source}`} className="pr-link fam-small">
            {b.changeGroup}
          </Link>
        </div>
        <SourceSwitch locale={locale} m={b} source={source} groupId={group.id} />
      </div>

      <div className="pr-builder">
        {/* ------------------------------------------------ choose */}
        <section className="fam-panel pr-choose" aria-labelledby="pr-choose-title">
          {source === 'misconception' ? (
            <>
              <div>
                <h2 id="pr-choose-title" className="fam-panel__title">
                  {wave ? fill(b.mistakesTitle, { n: wave.ordinal }) : b.mistakesTitleNoWave}
                </h2>
                <p className="fam-panel__sub">{b.mistakesSub}</p>
              </div>
              {mistakes.length === 0 ? (
                <div className="fam-stack">
                  <p className="fam-note">
                    <Icon name="info" size={18} />
                    <span>{b.mistakesEmpty}</span>
                  </p>
                  <Link
                    href={`/${locale}/educator/practice/new?source=topic&group=${group.id}`}
                    className="fam-btn fam-btn--sm"
                  >
                    {b.mistakesEmptyAlt}
                  </Link>
                </div>
              ) : (
                <ul className="pr-options">
                  {mistakes.map((x) => (
                    <li key={x.code}>
                      <button
                        type="button"
                        className="pr-option"
                        aria-pressed={code === x.code}
                        onClick={() => runBuild(x.code)}
                        disabled={build.status === 'loading' && code === x.code}
                      >
                        <span className="pr-option__name">{bankName(locale, x.nameUz, x.nameRu)}</span>
                        <span className="pr-option__desc">{bankName(locale, x.explainUz, x.explainRu)}</span>
                        <span className="pr-option__meta">
                          {bankName(locale, x.topic.nameUz, x.topic.nameRu)} ·{' '}
                          {fill(b.mistakeCount, { count: x.childCount, took })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div>
                <h2 id="pr-choose-title" className="fam-panel__title">
                  {b.topicsTitle}
                </h2>
                <p className="fam-panel__sub">{fill(b.topicsSub, { grade: group.grade })}</p>
              </div>
              {topics === null ? (
                <p className="fam-note fam-note--danger" role="alert">
                  <Icon name="alert" size={18} />
                  <span>
                    {b.topicsError}{' '}
                    <a href={`/${locale}/educator/practice/new?source=topic&group=${group.id}`} className="pr-link">
                      {m.common.retry}
                    </a>
                  </span>
                </p>
              ) : topics.length === 0 ? (
                <p className="fam-note">
                  <Icon name="info" size={18} />
                  <span>{b.topicsEmpty}</span>
                </p>
              ) : (
                <ul className="pr-topics">
                  {topics.map((x) => (
                    <li key={x.code}>
                      <button
                        type="button"
                        className="pr-option pr-option--topic"
                        aria-pressed={code === x.code}
                        disabled={x.items === 0}
                        onClick={() => runBuild(x.code)}
                      >
                        <span className="pr-option__name">{bankName(locale, x.nameUz, x.nameRu)}</span>
                        <span className="pr-option__meta">{m.common.clusters[x.cluster]}</span>
                        <span className="pr-option__meta">
                          {x.items === 0 ? b.topicNone : fill(b.topicItems, { n: x.items })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ------------------------------------------------ the set */}
        <section className="fam-panel pr-set" aria-labelledby="pr-set-title" aria-busy={build.status === 'loading'}>
          {build.status === 'idle' && (
            <div className="pr-idle">
              <span className="pr-idle__icon" aria-hidden="true">
                <Icon name="list" size={24} />
              </span>
              <h2 id="pr-set-title" className="fam-panel__title">
                {b.titleDefault}
              </h2>
              <p className="fam-panel__sub">{source === 'topic' ? b.pickTopicFirst : b.pickMistakeFirst}</p>
            </div>
          )}

          {build.status === 'loading' && (
            <div className="fam-stack" role="status">
              <div className="fam-inline">
                <span className="spinner" aria-hidden="true" />
                <h2 id="pr-set-title" className="fam-panel__title">
                  {b.loadTitle}
                </h2>
              </div>
              <p className="fam-panel__sub">{b.loadSub}</p>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="skel" style={{ width: '100%', height: 64, borderRadius: 20 }} />
              ))}
            </div>
          )}

          {build.status === 'error' && (
            <BuildError
              code={build.code}
              m={m}
              grade={group.grade}
              topicHref={`/${locale}/educator/practice/new?source=topic&group=${group.id}`}
              showTopicLink={source === 'misconception'}
              onRetry={code ? () => runBuild(code) : null}
            />
          )}

          {build.status === 'ready' && (
            <>
              <div>
                <h2 id="pr-set-title" className="fam-panel__title">
                  {fill(b.setTitle, { n: build.form.size })}
                </h2>
                <p className="fam-panel__sub">{b.setSub}</p>
              </div>

              <div className="fam-note fam-note--teal" role="note">
                <Icon name="shield" size={18} />
                <div>
                  <strong>{b.anchorTitle}</strong> {b.anchorNote}
                </div>
              </div>

              <ol className="pr-questions" aria-label={b.questionsLabel}>
                {build.form.items.map((q) => (
                  <li key={q.position} className={q.scored ? 'pr-q' : 'pr-q pr-q--trial'}>
                    <span className="pr-q__n" aria-hidden="true">
                      {q.position}
                    </span>
                    <div className="pr-q__body">
                      <p className="pr-q__stem">{locale === 'ru' ? q.stemRu : q.stemUz}</p>
                      <p className="pr-q__meta">
                        <span className="fam-tag">{m.common.difficulty[q.difficulty]}</span>
                        <span>{bankName(locale, q.topic.nameUz, q.topic.nameRu)}</span>
                        {q.hasImage && <span>· {b.withPicture}</span>}
                        {!q.scored && <span className="pr-q__trial">· {b.pretest}</span>}
                      </p>
                    </div>
                    {!build.form.frozen && (
                      <button
                        type="button"
                        className="fam-btn fam-btn--sm fam-btn--quiet pr-q__swap"
                        onClick={() => swap(q.position)}
                        disabled={swapping !== null}
                        aria-label={fill(b.swapAria, { n: q.position })}
                        aria-busy={swapping === q.position}
                      >
                        {swapping === q.position ? <span className="spinner" aria-hidden="true" /> : <Icon name="trend" size={16} />}
                        {b.swap}
                      </button>
                    )}
                  </li>
                ))}
              </ol>

              <p
                className={swapMsg?.bad ? 'fam-caption fam-caption--bad' : 'fam-caption fam-caption--ok'}
                role="status"
                aria-live="polite"
              >
                {swapMsg?.text ?? (build.form.frozen ? b.frozenNote : '')}
              </p>

              <hr className="fam-divider" />

              {/* ------------------------------------------ who + assign */}
              {groupChildren.length === 0 && !mistake ? (
                <p className="fam-note fam-note--warn">
                  <Icon name="info" size={18} />
                  <span>{b.noChildren}</span>
                </p>
              ) : (
                <fieldset className="pr-who" disabled={send.status === 'sending' || send.status === 'sent' || send.status === 'undoing'}>
                  <legend className="pr-who__label">{b.whoLabel}</legend>
                  <div className="pr-seg pr-seg--radio">
                    {whoOptions.map((w) => (
                      <label key={w} className={effectiveWho === w ? 'pr-seg__opt pr-seg__opt--on' : 'pr-seg__opt'}>
                        <input
                          type="radio"
                          name="pr-who"
                          className="visually-hidden"
                          checked={effectiveWho === w}
                          onChange={() => {
                            setWho(w);
                            setSendError(null);
                          }}
                        />
                        {w === 'mistake'
                          ? fill(b.whoMistake, { n: mistake?.childIds.length ?? 0 })
                          : w === 'all'
                            ? fill(b.whoAll, { n: groupChildren.length })
                            : b.whoPick}
                      </label>
                    ))}
                  </div>

                  {effectiveWho === 'pick' && (
                    <fieldset className="pr-pick">
                      <legend className="fam-small fam-muted">
                        {fill(b.pickLegend, { group: group.name })} · {fill(b.pickCount, { n: picked.size })}
                      </legend>
                      <ul className="pr-pick__list">
                        {groupChildren.map((c) => (
                          <li key={c.id}>
                            <label className="pr-pick__item">
                              <input
                                type="checkbox"
                                checked={picked.has(c.id)}
                                onChange={(e) => {
                                  const next = new Set(picked);
                                  if (e.target.checked) next.add(c.id);
                                  else next.delete(c.id);
                                  setPicked(next);
                                  setSendError(null);
                                }}
                              />
                              <span>{c.name}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </fieldset>
                  )}
                </fieldset>
              )}

              <div className="pr-assign">
                {send.status === 'sent' || send.status === 'undoing' ? (
                  <div className="pr-sent" role="status">
                    <p className="pr-sent__title">
                      <Icon name="check" size={18} />
                      {fill(b.sent, { n: send.result.assigned })}
                    </p>
                    {send.result.skipped > 0 && (
                      <p className="fam-small fam-muted">{fill(b.sentSkipped, { n: send.result.skipped })}</p>
                    )}
                    <p className="fam-small">{b.sentNote}</p>
                    <div className="fam-inline">
                      {(send.status === 'undoing' || send.undoable) && (
                        <button
                          type="button"
                          className="fam-btn fam-btn--sm"
                          onClick={undo}
                          disabled={send.status === 'undoing'}
                          aria-busy={send.status === 'undoing'}
                        >
                          {send.status === 'undoing' ? b.undoing : b.undo}
                        </button>
                      )}
                      <Link href={`/${locale}/educator/practice?group=${group.id}`} className="fam-btn fam-btn--sm fam-btn--quiet">
                        {b.toResults}
                        <Icon name="arrowRight" size={16} />
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    {send.status === 'undone' && (
                      <p className="fam-caption fam-caption--ok" role="status">
                        <Icon name="check" size={14} />
                        {b.undone}
                      </p>
                    )}
                    <button
                      type="button"
                      className="fam-btn fam-btn--primary"
                      onClick={assign}
                      disabled={send.status === 'sending' || (groupChildren.length === 0 && !mistake)}
                      aria-busy={send.status === 'sending'}
                    >
                      {send.status === 'sending' ? <span className="spinner" aria-hidden="true" /> : <Icon name="mail" size={18} />}
                      {send.status === 'sending' ? b.assigning : b.assign}
                    </button>
                  </>
                )}
                <p className="fam-alert" role="alert" hidden={!sendError}>
                  {sendError}
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function BuildError({
  code,
  m,
  grade,
  topicHref,
  showTopicLink,
  onRetry,
}: {
  code: string;
  m: Pick<PracticeMessages, 'builder' | 'common'>;
  grade: number;
  topicHref: string;
  showTopicLink: boolean;
  onRetry: (() => void) | null;
}) {
  const b = m.builder;
  const [title, body] =
    code === 'NO_ITEMS'
      ? [b.errNoItemsTitle, fill(b.errNoItemsBody, { grade })]
      : code === 'SOURCE_NOT_FOUND'
        ? [b.errNotFoundTitle, b.errNotFoundBody]
        : [b.errTitle, code === 'NETWORK' ? m.common.networkError : b.errBody];
  const retryable = code !== 'NO_ITEMS' && code !== 'SOURCE_NOT_FOUND';

  return (
    <div className="pr-error" role="alert">
      <span className="state__icon state__icon--error">
        <Icon name="alert" size={24} />
      </span>
      <h2 id="pr-set-title" className="fam-panel__title">
        {title}
      </h2>
      <p className="fam-panel__sub">{body}</p>
      <div className="fam-inline">
        {retryable && onRetry && (
          <button type="button" className="fam-btn fam-btn--sm" onClick={onRetry}>
            {m.common.retry}
          </button>
        )}
        {showTopicLink && code === 'NO_ITEMS' && (
          <Link href={topicHref} className="fam-btn fam-btn--sm">
            {b.mistakesEmptyAlt}
          </Link>
        )}
      </div>
    </div>
  );
}
