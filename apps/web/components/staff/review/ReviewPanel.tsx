'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/shell/Icon';
import { BankApiError, bankApi } from '@/lib/bank-api';
import type { ReviewOption, ReviewView } from '@/lib/bank-types';
import { fill, type Locale } from '@/lib/i18n';
import type { ReviewMessages } from '@/messages/review';
import { useAnnounce } from './live';

type Verdict = 'accept' | 'revise' | 'reject';
const VERDICTS: Verdict[] = ['accept', 'revise', 'reject'];
const LETTERS = 'ABCDEFGH';

function errorText(err: unknown, m: ReviewMessages): string {
  if (!(err instanceof BankApiError)) return m.errors.generic;
  const known = m.errors as Record<string, string>;
  const reason = typeof err.details.reason === 'string' ? err.details.reason : '';
  return known[reason] ?? known[err.code] ?? m.errors.generic;
}

/**
 * The right-hand side of design/13 for one item version: blind solve, then
 * the key and the verdict (task.md § 8.5 "Item reviewer").
 *
 * The key, misconceptions and rationales only exist in `view` once the API
 * has recorded the blind answer — this component never has them before, so
 * it cannot leak them. Keyed by version id by the page, so nothing carries
 * over from one item to the next.
 */
export function ReviewPanel({
  initial,
  m,
  locale,
  nextHref,
}: {
  initial: ReviewView;
  m: ReviewMessages;
  locale: Locale;
  /** Where "next item" goes: the next queue entry, or the queue itself. */
  nextHref: string;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const [view, setView] = useState(initial);
  const [lang, setLang] = useState<'uz' | 'ru'>(locale === 'ru' ? 'ru' : 'uz');
  const [pick, setPick] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const prevStep = useRef(view.step);
  const ids = { note: useId(), noteErr: useId(), hint: useId(), submitHint: useId() };

  // After the blind answer is stored, move focus to what was revealed so a
  // screen-reader user hears the outcome, not silence.
  useEffect(() => {
    if (prevStep.current === 'solve' && view.step !== 'solve') resultRef.current?.focus();
    prevStep.current = view.step;
  }, [view.step]);

  const options = [...view.options].sort((a, b) => a.position - b.position);
  const letterOf = (id: string | null) => {
    const i = options.findIndex((o) => o.id === id);
    return i >= 0 ? LETTERS[i] : '—';
  };
  const keyOption = options.find((o) => o.isKey);
  const solved = view.step !== 'solve';
  const disagreed = solved && view.agreed === false;
  const needsNote = verdict === 'revise' || verdict === 'reject';

  async function solve() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await bankApi.solve(view.versionId, pick);
      setView(next);
      announce(next.agreed === false ? fill(m.toast.auto, { code: next.code }) : m.toast.match);
    } catch (err) {
      setError(errorText(err, m));
      // Someone (maybe this reviewer in another tab) moved the item on: show the truth.
      if (err instanceof BankApiError && err.status === 409) {
        bankApi.review(view.versionId).then(setView, () => {});
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!verdict || busy) return;
    if (needsNote && !note.trim()) {
      setNoteErr(true);
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bankApi.verdict(view.versionId, verdict, note.trim() || undefined);
      announce(fill(m.toast[verdict], { code: view.code, author: view.authorName }));
      router.push(nextHref);
    } catch (err) {
      if (err instanceof BankApiError && err.details.reason === 'note_required') {
        setNoteErr(true);
        noteRef.current?.focus();
      } else {
        setError(errorText(err, m));
        if (err instanceof BankApiError && err.status === 409) {
          bankApi.review(view.versionId).then(setView, () => {});
        }
      }
      setBusy(false);
    }
  }

  const stem = lang === 'ru' ? view.stemRu : view.stemUz;
  const audio = lang === 'ru' ? view.audioRu : view.audioUz;
  const label = (o: ReviewOption) => (lang === 'ru' ? o.labelRu : o.labelUz);

  return (
    <section className="fam-panel rv-item" aria-labelledby="rv-item-code">
      <header className="rv-item__head">
        <div className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
          <h2 id="rv-item-code" className="rv-item__code mono">
            {view.code}
          </h2>
          <span className="fam-tag">{fill(m.item.gradeFmt, { g: view.grade })}</span>
          <span className="fam-tag">{m.cluster[view.cluster]}</span>
          <span className="fam-tag">{fill(m.item.versionFmt, { n: view.version })}</span>
          <span className="fam-tag">uz · ru</span>
        </div>
        <dl className="rv-item__who">
          <div>
            <dt>{m.item.authorLbl}</dt>
            <dd>{view.authorName}</dd>
          </div>
        </dl>
      </header>

      <ol className="rv-steps" aria-label={m.item.stepsLabel}>
        <li className="rv-step" data-on={!solved} aria-current={!solved ? 'step' : undefined}>
          <span className="rv-step__n">{solved ? <Icon name="check" size={14} /> : '1'}</span>
          {m.item.step1}
        </li>
        <li className="rv-step__sep" aria-hidden="true" />
        <li className="rv-step" data-on={solved} aria-current={solved ? 'step' : undefined}>
          <span className="rv-step__n">2</span>
          {m.item.step2}
        </li>
      </ol>

      <div className="rv-stem">
        <div className="rv-stem__top">
          <span className="card__kicker">{solved ? m.reveal.over : m.solve.over}</span>
          <div className="rv-seg" role="group" aria-label={m.item.langLabel}>
            {(['uz', 'ru'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className="rv-seg__btn"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
              >
                {l === 'uz' ? m.item.langUz : m.item.langRu}
              </button>
            ))}
          </div>
        </div>
        <p className="rv-stem__text" lang={lang === 'ru' ? 'ru' : 'uz'}>
          {stem}
        </p>
        {view.image && (
          <img className="rv-stem__img" src={view.image.url} alt={m.item.imageAlt} />
        )}
        {audio && (
          <audio className="rv-stem__audio" controls preload="none" src={audio.url} aria-label={m.item.audioLbl} />
        )}
        <p className="fam-small fam-muted">
          {m.item.constructLbl}: {view.construct}
        </p>
      </div>

      {!solved && (
        <>
          <p className="card__body">{m.solve.hint}</p>
          <fieldset className="rv-options" disabled={busy || view.decidedByOther}>
            <legend className="visually-hidden">{m.solve.optionsLabel}</legend>
            {options.map((o, i) => (
              <label key={o.id} className="rv-option" data-on={pick === o.id}>
                <input
                  type="radio"
                  name="rv-blind"
                  value={o.id}
                  checked={pick === o.id}
                  onChange={() => setPick(o.id)}
                  className="rv-option__input"
                />
                <span className="rv-option__letter" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <span className="visually-hidden">{LETTERS[i]}.</span>
                <span className="rv-option__label" lang={lang}>
                  {o.image && (
                    <img src={o.image.url} alt="" className="rv-option__img" />
                  )}
                  {label(o)}
                </span>
              </label>
            ))}
          </fieldset>
          {view.decidedByOther ? (
            <div className="fam-note fam-note--warn">
              <Icon name="info" size={18} />
              <span>
                {m.solve.decidedOther}{' '}
                <Link href={nextHref}>{m.done.next}</Link>
              </span>
            </div>
          ) : (
            <div className="fam-inline" style={{ '--gap': '16px' } as React.CSSProperties}>
              <button
                type="button"
                className="fam-btn fam-btn--primary"
                disabled={!pick || busy}
                aria-busy={busy}
                aria-describedby={ids.hint}
                onClick={solve}
              >
                {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="lock" size={18} />}
                {m.solve.reveal}
              </button>
              <span id={ids.hint} className="fam-small fam-muted">
                {pick ? m.solve.revealHint : m.solve.revealNeed}
              </span>
            </div>
          )}
        </>
      )}

      {disagreed && (
        <>
          <div className="rv-dis" role="group" aria-labelledby="rv-result">
            <h3 id="rv-result" ref={resultRef} tabIndex={-1} className="rv-dis__title">
              <Icon name="alert" size={20} />
              {m.dis.title}
            </h3>
            <p className="card__body">
              {fill(m.dis.body, {
                you: letterOf(view.myAnswer),
                key: keyOption ? letterOf(keyOption.id) : '—',
                author: view.authorName,
              })}
            </p>
          </div>
          <RevealedOptions options={options} myAnswer={view.myAnswer} lang={lang} m={m} />
          <div className="fam-actions">
            <Link href={nextHref} className="fam-btn fam-btn--primary">
              {m.dis.next}
              <Icon name="arrowRight" size={18} />
            </Link>
          </div>
        </>
      )}

      {solved && !disagreed && (
        <>
          <div className="fam-inline" style={{ '--gap': '8px' } as React.CSSProperties}>
            <h3 id="rv-result" ref={resultRef} tabIndex={-1} className="rv-chip rv-chip--ok">
              <Icon name="check" size={16} />
              {m.reveal.matchChip}
            </h3>
            {keyOption && <span className="rv-chip">{fill(m.reveal.keyChip, { l: letterOf(keyOption.id) })}</span>}
            <span className="rv-chip">{fill(m.reveal.yourChip, { l: letterOf(view.myAnswer) })}</span>
          </div>

          <RevealedOptions options={options} myAnswer={view.myAnswer} lang={lang} m={m} />

          {view.step === 'verdict' ? (
            <>
              <div className="rv-check">
                <span className="card__kicker">{m.reveal.checkOver}</span>
                <p className="card__body">
                  {view.expectedP !== null
                    ? fill(m.reveal.checkFmt, { p: Math.round(view.expectedP * 100), g: view.grade })
                    : m.reveal.checkNoP}
                </p>
              </div>

              <fieldset className="rv-verdicts" disabled={busy}>
                <legend className="fam-label">{m.verdict.label}</legend>
                {VERDICTS.map((v) => (
                  <label key={v} className="rv-verdict" data-kind={v} data-on={verdict === v}>
                    <input
                      type="radio"
                      name="rv-verdict"
                      value={v}
                      checked={verdict === v}
                      onChange={() => {
                        setVerdict(v);
                        setNoteErr(false);
                      }}
                      className="rv-option__input"
                    />
                    <span className="rv-verdict__title">{m.verdict[v]}</span>
                    <span className="rv-verdict__sub">{m.verdict[`${v}Sub`]}</span>
                  </label>
                ))}
              </fieldset>

              <div className="fam-field">
                <label className="fam-label" htmlFor={ids.note}>
                  {m.verdict.notesLbl}{' '}
                  <span className="fam-muted">· {needsNote ? m.verdict.notesReq : m.verdict.notesOpt}</span>
                </label>
                <textarea
                  id={ids.note}
                  ref={noteRef}
                  className="fam-input rv-note"
                  rows={4}
                  value={note}
                  placeholder={m.verdict.notesPh}
                  maxLength={2000}
                  required={needsNote}
                  aria-invalid={noteErr || undefined}
                  aria-describedby={noteErr ? ids.noteErr : undefined}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (e.target.value.trim()) setNoteErr(false);
                  }}
                />
                {noteErr && (
                  <span id={ids.noteErr} className="fam-caption fam-caption--bad">
                    {m.verdict.notesErr}
                  </span>
                )}
              </div>

              <div className="fam-inline" style={{ '--gap': '16px' } as React.CSSProperties}>
                <button
                  type="button"
                  className="fam-btn fam-btn--primary"
                  disabled={!verdict || busy}
                  aria-busy={busy}
                  aria-describedby={ids.submitHint}
                  onClick={submit}
                >
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {m.verdict.submit}
                </button>
                <span id={ids.submitHint} className="fam-small fam-muted">
                  {verdict ? m.verdict.submitReady : m.verdict.submitNeed}
                </span>
              </div>
            </>
          ) : (
            <div className="fam-note fam-note--brand rv-done">
              <Icon name="check" size={18} />
              <div className="fam-stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                <strong>{m.done.title}</strong>
                <span>
                  {fill(m.done.body, {
                    v: view.verdict === 'auto_reject' ? m.verdict.auto : view.verdict ? m.verdict[view.verdict] : '—',
                  })}
                </span>
                {view.note && (
                  <span>
                    {m.done.noteLbl}: “{view.note}”
                  </span>
                )}
                <Link href={nextHref}>{m.done.next}</Link>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="fam-alert" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Options after the blind solve: the key, the reviewer's answer, and per distractor its misconception + rationale. */
function RevealedOptions({
  options,
  myAnswer,
  lang,
  m,
}: {
  options: ReviewOption[];
  myAnswer: string | null;
  lang: 'uz' | 'ru';
  m: ReviewMessages;
}) {
  return (
    <ul className="rv-revealed">
      {options.map((o, i) => {
        const misconception = lang === 'ru' ? o.misconceptionNameRu : o.misconceptionNameUz;
        return (
          <li key={o.id} className="rv-revealed__row" data-key={o.isKey ? 'true' : undefined}>
            <span className="rv-option__letter" aria-hidden="true">
              {LETTERS[i]}
            </span>
            <div className="fam-stack" style={{ '--gap': '6px', flex: 1, minWidth: 0 } as React.CSSProperties}>
              <div className="fam-inline">
                <span className="visually-hidden">{LETTERS[i]}.</span>
                <strong lang={lang}>{lang === 'ru' ? o.labelRu : o.labelUz}</strong>
                {o.isKey && <span className="fam-tag fam-tag--ok">{m.reveal.keyTag}</span>}
                {o.id === myAnswer && <span className="fam-tag fam-tag--brand">{m.reveal.yourTag}</span>}
              </div>
              {!o.isKey && (
                <span className="fam-small">
                  <span className="fam-muted">{m.reveal.misconceptionLbl}: </span>
                  {misconception ?? o.misconceptionCode ?? m.reveal.noMisconception}
                </span>
              )}
              {o.rationale && (
                <span className="fam-small fam-muted">
                  {m.reveal.rationaleLbl}: {o.rationale}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
