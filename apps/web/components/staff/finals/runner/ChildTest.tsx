'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { KidBar } from '@/components/kid/KidBar';
import { Navigator, type CellState } from '@/components/kid/Navigator';
import { QuestionCard } from '@/components/kid/QuestionCard';
import { ReviewScreen } from '@/components/kid/ReviewScreen';
import { formatRemaining, type StemLang } from '@/components/kid/util';
import { Icon } from '@/components/shell/Icon';
import { fill } from '@/lib/i18n';
import type { PackageForm } from '@/lib/olympiad-types';
import type { BundleItem } from '@/lib/session-types';
import type { FinalsMessages } from '@/messages/finals';
import type { KidMessages } from '@/messages/kid';
import type { RunRecord } from './db';
import { HoldButton } from './HoldButton';

type Phase = 'ready' | 'test' | 'review' | 'done';

const addUnique = <T,>(list: T[], v: T) => (list.includes(v) ? list : [...list, v]);
// Data URIs from the package: nothing to fetch, nothing to map.
const asIs = (u: string) => u;

/**
 * One child's final on the runner — kid mode's question, navigator and review
 * screens (components/kid), driven from the device store instead of the
 * session API. No request is made here: every change goes to IndexedDB at
 * once through `onChange` (task.md § 11), and the upload happens later from
 * the runner's outbox.
 *
 * The clock is absolute (`deadlineAt`), so it keeps running if the proctor
 * takes the child back to the list; time up hands the answers in.
 */
export function ChildTest({
  t,
  m,
  brand,
  run: initial,
  form,
  skewMs,
  gradeLabel,
  onChange,
  onSubmitted,
  onExit,
}: {
  t: KidMessages;
  m: FinalsMessages;
  brand: string;
  run: RunRecord;
  form: PackageForm;
  skewMs: number;
  gradeLabel: string;
  onChange: (r: RunRecord) => void;
  onSubmitted: () => void;
  onExit: () => void;
}) {
  const items = form.items as unknown as BundleItem[];
  const [r, setR] = useState<RunRecord>(initial);
  const rRef = useRef<RunRecord>(initial);
  const [phase, setPhase] = useState<Phase>(initial.submittedAt ? 'done' : 'ready');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const spent = useRef<Record<string, number>>(
    Object.fromEntries(Object.values(initial.answers).map((a) => [a.itemVersionId, a.responseMs])),
  );
  const enteredAt = useRef<number | null>(null);

  const stamp = () => new Date(Date.now() + skewMs).toISOString();

  const update = (fn: (cur: RunRecord) => RunRecord) => {
    const next = fn(rRef.current);
    if (next === rRef.current) return;
    rRef.current = next;
    setR(next);
    onChange(next);
  };

  // ------------------------------------------------------------- time spent

  const currentId = () => items[rRef.current.current]?.itemVersionId ?? null;
  const spentOn = (id: string) =>
    (spent.current[id] ?? 0) + (enteredAt.current !== null && currentId() === id ? Date.now() - enteredAt.current : 0);
  const enter = () => {
    enteredAt.current = Date.now();
  };
  /** Banks the time on the open question; an answered one gets its responseMs updated. */
  const leave = () => {
    const id = currentId();
    if (!id || enteredAt.current === null) return;
    spent.current[id] = (spent.current[id] ?? 0) + (Date.now() - enteredAt.current);
    enteredAt.current = null;
    const a = rRef.current.answers[id];
    if (a) update((c) => ({ ...c, answers: { ...c.answers, [id]: { ...a, responseMs: spent.current[id] } } }));
  };

  // ------------------------------------------------------------- clock

  const deadline = r.deadlineAt ? Date.parse(r.deadlineAt) : null;
  const remaining = deadline === null ? null : deadline - (now + skewMs);
  const ticking = phase === 'test' || phase === 'review' || (phase === 'ready' && !!r.startedAt);

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const finish = (timeUp: boolean) => {
    const cur = rRef.current;
    if (cur.submittedAt) return;
    leave();
    setConfirmOpen(false);
    const at = stamp();
    // Time up while the child was away: the sitting ended at the deadline, not now.
    const submittedAt = timeUp && cur.deadlineAt && Date.parse(cur.deadlineAt) < Date.parse(at) ? cur.deadlineAt : at;
    update((c) => ({ ...c, submittedAt, timeUp, upload: 'pending', reason: null }));
    setPhase('done');
    onSubmitted();
  };

  useEffect(() => {
    if (ticking && remaining !== null && remaining <= 0) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticking, remaining]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase, r.current]);

  // ------------------------------------------------------------- actions

  function record(patch: { chosenOptionId?: string; flagged?: boolean }) {
    const cur = rRef.current;
    const id = currentId();
    if (!id || cur.submittedAt || (remaining !== null && remaining <= 0)) return;
    const prev = cur.answers[id];
    const chosen = patch.chosenOptionId ?? prev?.chosenOptionId ?? null;
    const flagged = patch.flagged ?? prev?.flagged ?? false;
    const choiceChanged = chosen !== (prev?.chosenOptionId ?? null);
    if (!choiceChanged && flagged === (prev?.flagged ?? false)) return;
    update((c) => ({
      ...c,
      answers: {
        ...c.answers,
        [id]: {
          itemVersionId: id,
          chosenOptionId: chosen,
          flagged,
          // The first pick is not a revision; every later change of choice is.
          revisionCount: (prev?.revisionCount ?? 0) + (choiceChanged && prev?.chosenOptionId ? 1 : 0),
          responseMs: spentOn(id),
          clientRecordedAt: stamp(),
        },
      },
    }));
  }

  const choose = (optionId: string) => record({ chosenOptionId: optionId });
  const toggleFlag = () => {
    const id = currentId();
    if (id) record({ flagged: !rRef.current.answers[id]?.flagged });
  };

  const goTo = (index: number) => {
    leave();
    update((c) => ({ ...c, current: index, visited: addUnique(c.visited, index) }));
    enter();
    setPhase('test');
  };

  const next = () => {
    const cur = rRef.current;
    if (cur.current >= items.length - 1) {
      leave();
      setPhase('review');
    } else {
      goTo(cur.current + 1);
    }
  };

  const start = () => {
    const cur = rRef.current;
    if (!cur.startedAt) {
      const startedAt = stamp();
      const deadlineAt = form.timeLimitSec ? new Date(Date.parse(startedAt) + form.timeLimitSec * 1000).toISOString() : null;
      update((c) => ({ ...c, startedAt, deadlineAt, visited: addUnique(c.visited, c.current) }));
    }
    enter();
    setPhase('test');
  };

  const exit = () => {
    leave();
    onExit();
  };

  // Keyboard: 1–6 / A–F choose, ← → move (as kid mode, design/05).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (phase !== 'test' || confirmOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, dialog, .fn-hold')) return;
      const cur = rRef.current;
      const item = items[cur.current];
      if (!item) return;
      const k = e.key.toLowerCase();
      const n = /^[1-6]$/.test(k) ? Number(k) - 1 : /^[a-f]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
      if (n >= 0) {
        const opt = item.options[n];
        if (opt) {
          e.preventDefault();
          choose(opt.id);
        }
        return;
      }
      if (e.key === 'ArrowLeft' && cur.current > 0) {
        e.preventDefault();
        goTo(cur.current - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------- render

  const answeredIdx = items.map((it, i) => (r.answers[it.itemVersionId]?.chosenOptionId ? i : -1)).filter((i) => i >= 0);
  const answeredCount = answeredIdx.length;
  const unanswered = items.length - answeredCount;

  const timer =
    remaining !== null && phase !== 'done' && r.startedAt ? (
      <div className={remaining < 5 * 60_000 ? 'kd-timer kd-timer--low' : 'kd-timer'} role="timer" aria-label={t.timeLabel}>
        <Icon name="clock" size={20} />
        <span className="kd-timer__label">{t.timeLabel}</span>
        <span className="kd-timer__value">{formatRemaining(remaining, t)}</span>
      </div>
    ) : null;

  const langToggle = (
    <div className="kd-lang fn-lang" role="radiogroup" aria-label={t.stemLang}>
      {(['uz', 'ru'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={r.stemLang === l}
          className="kd-lang__opt"
          lang={l === 'uz' ? 'uz-Latn' : 'ru'}
          onClick={() => update((c) => ({ ...c, stemLang: l as StemLang }))}
        >
          {l === 'uz' ? t.stemLangUz : t.stemLangRu}
        </button>
      ))}
    </div>
  );

  const bar = (
    <KidBar
      brand={brand}
      mode="monitoring"
      modeLabel={t.modeOlympiad}
      who={`${r.childName} · ${gradeLabel}`}
      timer={timer}
      action={
        <>
          {phase !== 'done' && phase !== 'ready' && langToggle}
          <HoldButton label={m.runner.hold.label} hint={m.runner.hold.hint} onDone={exit} />
        </>
      }
    />
  );

  const saved = (
    <div className="kd-sync" role="status">
      <Icon name="check" size={18} />
      <span>{m.runner.child.saved}</span>
    </div>
  );

  let body: React.ReactNode = null;
  if (phase === 'ready') {
    const minutes = form.timeLimitSec == null ? null : remaining === null ? Math.round(form.timeLimitSec / 60) : Math.max(0, Math.ceil(remaining / 60_000));
    body = (
      <section className="kd-card kd-main fn-child" aria-labelledby="fn-ready-title">
        <div className="kd-head">
          <span className="kd-over">{m.runner.child.over}</span>
          <h1 id="fn-ready-title" className="kd-title" ref={headingRef} tabIndex={-1}>
            {fill(m.runner.child.readyTitle, { name: r.childName })}
          </h1>
          <p className="kd-sub">{m.runner.child.readySub}</p>
          {r.startedAt && (
            <p className="kd-sub kd-sub--strong">{fill(m.runner.child.resumeFmt, { n: answeredCount, m: items.length })}</p>
          )}
        </div>
        <div className="kd-facts">
          <div className="kd-fact">
            <span className="kd-fact__big">{fill(m.runner.child.fQ, { n: items.length })}</span>
            <span className="kd-fact__small">{m.runner.child.fQs}</span>
          </div>
          <div className="kd-fact">
            <span className="kd-fact__big">{minutes === null ? m.runner.child.fTnone : fill(m.runner.child.fT, { n: minutes })}</span>
            <span className="kd-fact__small">{minutes === null ? m.runner.child.fTnoneSub : m.runner.child.fTs}</span>
          </div>
        </div>
        <div className="kd-lang" role="radiogroup" aria-label={t.stemLang}>
          <span className="kd-lang__label" aria-hidden="true">
            {t.stemLang}
          </span>
          {(['uz', 'ru'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={r.stemLang === l}
              className="kd-lang__opt"
              lang={l === 'uz' ? 'uz-Latn' : 'ru'}
              onClick={() => update((c) => ({ ...c, stemLang: l }))}
            >
              {l === 'uz' ? t.stemLangUz : t.stemLangRu}
            </button>
          ))}
        </div>
        <div className="kd-startRow">
          <button type="button" className="fam-btn fam-btn--primary kd-btn--xl" onClick={start}>
            {r.startedAt ? m.runner.child.resume : m.runner.child.start}
            <Icon name="arrowRight" size={20} />
          </button>
          <span className="kd-note">{fill(m.runner.child.notYouFmt, { name: r.childName })}</span>
        </div>
      </section>
    );
  } else if (phase === 'test' || phase === 'review') {
    const cells = items.map((it, i) => {
      const a = r.answers[it.itemVersionId];
      const state: CellState =
        phase === 'test' && i === r.current
          ? 'current'
          : a?.chosenOptionId
            ? 'answered'
            : r.visited.includes(i)
              ? 'skipped'
              : 'notYet';
      return { state, flagged: !!a?.flagged };
    });
    const item = items[r.current];
    body = (
      <div className="kd-work">
        <div className="kd-work__main">
          {phase === 'test' && item ? (
            <QuestionCard
              key={item.itemVersionId}
              t={t}
              item={item}
              index={r.current}
              total={items.length}
              answer={r.answers[item.itemVersionId]}
              answeredCount={answeredCount}
              stemLang={r.stemLang}
              media={asIs}
              locked={remaining !== null && remaining <= 0}
              headingRef={headingRef}
              onChoose={choose}
              onFlag={toggleFlag}
              onPrev={() => r.current > 0 && goTo(r.current - 1)}
              onNext={next}
              onSkip={next}
              sync={saved}
            />
          ) : (
            <ReviewScreen
              t={t}
              answered={answeredCount}
              unanswered={items.map((_, i) => i).filter((i) => !answeredIdx.includes(i))}
              flagged={items.map((it, i) => (r.answers[it.itemVersionId]?.flagged ? i : -1)).filter((i) => i >= 0)}
              headingRef={headingRef}
              onPick={goTo}
              onBack={() => goTo(r.current)}
              onSubmit={() => setConfirmOpen(true)}
              sync={saved}
            />
          )}
        </div>
        <Navigator
          t={t}
          cells={cells}
          answeredCount={answeredCount}
          showReview={phase === 'test'}
          onPick={goTo}
          onReview={() => {
            leave();
            setPhase('review');
          }}
        />
      </div>
    );
  } else {
    body = (
      <section className="kd-card kd-main fn-child" aria-labelledby="fn-done-title">
        <div className="kd-doneHead">
          <span className="kd-doneMark" aria-hidden="true">
            <Icon name="check" size={30} strokeWidth={2.2} />
          </span>
          <div className="kd-head">
            <span className="kd-over">{m.runner.child.over}</span>
            <h1 id="fn-done-title" className="kd-title" ref={headingRef} tabIndex={-1}>
              {fill(m.runner.child.doneTitle, { name: r.childName })}
            </h1>
            <p className="kd-sub">{m.runner.child.doneSub}</p>
            {r.timeUp && <p className="kd-sub kd-sub--strong">{m.runner.child.doneTimeUp}</p>}
          </div>
        </div>
        <div className="kd-fact kd-fact--text">
          <span className="kd-muted">{m.runner.child.doneNoScore}</span>
        </div>
        <p className="kd-sub kd-sub--strong">{m.runner.child.doneHand}</p>
      </section>
    );
  }

  return (
    <>
      {bar}
      <main className="kid__stage kd-stage">{body}</main>
      <ConfirmDialog
        open={confirmOpen}
        title={t.cfTitle}
        body={unanswered > 0 ? fill(t.cfBody, { n: unanswered }) : t.cfBodyAll}
        confirmLabel={t.cfYes}
        cancelLabel={t.cfNo}
        danger={false}
        icon="check"
        onConfirm={() => finish(false)}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
