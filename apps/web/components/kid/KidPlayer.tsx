'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { Icon } from '@/components/shell/Icon';
import { formatDate } from '@/lib/format';
import { fill, type Locale } from '@/lib/i18n';
import { SessionApiError, sessionApi } from '@/lib/session-api';
import type { Bundle, SessionStatus } from '@/lib/session-types';
import { familyMessages } from '@/messages/family';
import { kidMessages } from '@/messages/kid';
import { DoneScreen, type SubmitState } from './DoneScreen';
import { KidBar } from './KidBar';
import { KidState } from './KidState';
import { MediaNetworkError, prefetchMedia } from './media';
import { Navigator, type CellState } from './Navigator';
import { QuestionCard } from './QuestionCard';
import { ReadyScreen, WifiOff, WifiOn } from './ReadyScreen';
import { ReviewScreen } from './ReviewScreen';
import { loadLocal, saveLocal, type LocalAnswer, type LocalSession } from './storage';
import { deviceInfo, formatRemaining, toInput, type StemLang } from './util';

type Phase =
  | 'loading'
  | 'notFound'
  | 'signedOut'
  | 'fetchError'
  | 'error'
  | 'download'
  | 'downloadError'
  | 'empty'
  | 'ready'
  | 'test'
  | 'review'
  | 'done'
  | 'expired';

const SYNC_EVERY_MS = 5_000;
const BACKOFF_CAP_MS = 60_000;

const addUnique = <T,>(list: T[], v: T) => (list.includes(v) ? list : [...list, v]);
const later = (a: string, b: string) => Date.parse(a) >= Date.parse(b);

/**
 * Builds the device copy of a session from a (fresh or stored) bundle and the
 * local buffer. Per item the newest `clientRecordedAt` wins — the same rule the
 * server applies — so a reload never undoes a later change from either side.
 */
function merge(bundle: Bundle, local: LocalSession | null, skewMs: number, stemLang: StemLang): LocalSession {
  const ids = new Set(bundle.items.map((i) => i.itemVersionId));
  const answers: Record<string, LocalAnswer> = {};
  const unsent = new Set<string>();
  for (const [id, a] of Object.entries(local?.answers ?? {})) {
    if (ids.has(id)) answers[id] = a;
  }
  for (const id of local?.unsent ?? []) if (answers[id]) unsent.add(id);
  for (const sa of bundle.answers) {
    const mine = answers[sa.itemVersionId];
    if (!ids.has(sa.itemVersionId)) continue;
    if (!mine || later(sa.clientRecordedAt, mine.clientRecordedAt)) {
      answers[sa.itemVersionId] = {
        itemVersionId: sa.itemVersionId,
        chosenOptionId: sa.chosenOptionId,
        flagged: !!sa.flagged,
        revisionCount: sa.revisionCount ?? 0,
        responseMs: sa.responseMs ?? 0,
        clientRecordedAt: new Date(sa.clientRecordedAt).toISOString(),
      };
      unsent.delete(sa.itemVersionId);
    }
  }
  const firstOpen = bundle.items.findIndex((it) => !answers[it.itemVersionId]?.chosenOptionId);
  const current = Math.min(local?.current ?? Math.max(0, firstOpen), Math.max(0, bundle.items.length - 1));
  const submitted = bundle.status === 'submitted';
  return {
    v: 1,
    bundle,
    skewMs,
    answers,
    unsent: submitted ? [] : [...unsent],
    visited: local?.visited ?? bundle.items.map((_, i) => i).filter((i) => answers[bundle.items[i].itemVersionId]),
    current,
    started: !!local?.started || Object.keys(answers).length > 0,
    stemLang: local?.stemLang ?? stemLang,
    finalPending: !submitted && !!local?.finalPending,
    finalOffline: !!local?.finalOffline,
    timeUp: !!local?.timeUp,
    result: local?.result ?? null,
  };
}

/**
 * Kid mode (task.md § 8.3, design/05): download → ready → test → review →
 * done. The whole form and its media are pulled onto the device first; answers
 * go into a local buffer at once and a retrying loop replays them to the API
 * (idempotent, newest wins). Nothing here ever sees a key: the bundle has none.
 */
export function KidPlayer({
  locale,
  sessionId,
  brand,
  initial,
}: {
  locale: Locale;
  sessionId: string;
  brand: string;
  /** The server's read of the bundle, so the first paint needs no extra round trip. */
  initial: Bundle | null;
}) {
  const t = kidMessages(locale);
  const fam = familyMessages(locale);
  const router = useRouter();
  const home = `/${locale}/dashboard`;

  const [phase, setPhase] = useState<Phase>(initial ? 'download' : 'loading');
  const [s, setS] = useState<LocalSession | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [online, setOnline] = useState(true);
  const [warn, setWarn] = useState<null | 'warn' | 'signedOut'>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('sending');
  const [exitOpen, setExitOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const sRef = useRef<LocalSession | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const media = useRef(new Map<string, string>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const spent = useRef<Record<string, number>>({});
  const enteredAt = useRef<number | null>(null);
  const backoff = useRef({ delay: 0, at: 0 });
  const inFlight = useRef(false);
  const submitting = useRef(false);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const update = (fn: (cur: LocalSession) => LocalSession) => {
    const cur = sRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    sRef.current = next;
    setS(next);
    saveLocal(next);
  };

  const okay = () => {
    backoff.current = { delay: 0, at: 0 };
  };
  const fail = () => {
    const delay = backoff.current.delay ? Math.min(BACKOFF_CAP_MS, backoff.current.delay * 2) : SYNC_EVERY_MS;
    backoff.current = { delay, at: Date.now() + delay };
  };

  // ------------------------------------------------------------- time spent

  const currentId = () => {
    const cur = sRef.current;
    return cur?.bundle.items[cur.current]?.itemVersionId ?? null;
  };
  const spentOn = (id: string) =>
    (spent.current[id] ?? 0) + (enteredAt.current !== null && currentId() === id ? Date.now() - enteredAt.current : 0);

  const enter = () => {
    enteredAt.current = Date.now();
  };

  /** Banks the time spent on the open question; an answered one gets its new responseMs synced. */
  const leave = () => {
    const id = currentId();
    if (!id || enteredAt.current === null) return;
    const delta = Date.now() - enteredAt.current;
    enteredAt.current = null;
    spent.current[id] = (spent.current[id] ?? 0) + delta;
    const a = sRef.current?.answers[id];
    if (!a || delta < 1000 || sRef.current?.finalPending) return;
    update((cur) => ({
      ...cur,
      answers: { ...cur.answers, [id]: { ...a, responseMs: spent.current[id], clientRecordedAt: new Date().toISOString() } },
      unsent: addUnique(cur.unsent, id),
    }));
  };

  // ------------------------------------------------------------------ sync

  const serverFinal = (status: SessionStatus) => {
    if (status === 'submitted') {
      update((cur) => ({ ...cur, finalPending: false, unsent: [], timeUp: cur.timeUp || !cur.finalPending, bundle: { ...cur.bundle, status } }));
      setSubmitState('sent');
      go('done');
      void loadResult();
    } else {
      update((cur) => ({ ...cur, finalPending: false, bundle: { ...cur.bundle, status } }));
      go('expired');
    }
  };

  const loadResult = async () => {
    const cur = sRef.current;
    if (!cur || cur.bundle.mode !== 'practice' || typeof cur.result?.solved === 'number') return;
    try {
      const r = await sessionApi.result(sessionId);
      update((c) => ({ ...c, result: r }));
    } catch {
      // The count is a nicety; "answers sent" is already on screen.
    }
  };

  const submitNow = async (force: boolean) => {
    const cur = sRef.current;
    if (!cur || !cur.finalPending || submitting.current) return;
    if (!force && Date.now() < backoff.current.at) return;
    submitting.current = true;
    try {
      const r = await sessionApi.submit(sessionId, Object.values(cur.answers).map(toInput), {
        ...deviceInfo(),
        offline: cur.finalOffline,
      });
      okay();
      setOnline(true);
      setWarn(null);
      update((c) => ({ ...c, finalPending: false, unsent: [], result: r, bundle: { ...c.bundle, status: r.status } }));
      setSubmitState('sent');
    } catch (e) {
      const err = e instanceof SessionApiError ? e : new SessionApiError('UNKNOWN', 0);
      if (err.code === 'SESSION_EXPIRED') {
        update((c) => ({ ...c, finalPending: false, bundle: { ...c.bundle, status: 'expired' } }));
        go('expired');
        return;
      }
      fail();
      if (err.code === 'NETWORK') {
        setOnline(false);
        // Finished without a connection: the server records it as an offline sync (§ 11).
        update((c) => (c.finalOffline ? c : { ...c, finalOffline: true }));
      } else {
        setWarn(err.status === 401 ? 'signedOut' : 'warn');
      }
      setSubmitState('waiting');
    } finally {
      submitting.current = false;
    }
  };

  const flush = async (force: boolean) => {
    const cur = sRef.current;
    if (!cur || inFlight.current) return;
    if (cur.finalPending) return submitNow(force);
    if (cur.bundle.status !== 'started' || cur.unsent.length === 0) return;
    if (!force && Date.now() < backoff.current.at) return;
    inFlight.current = true;
    const batch = cur.unsent.map((id) => cur.answers[id]).filter(Boolean).map(toInput);
    try {
      const res = await sessionApi.saveAnswers(sessionId, batch, deviceInfo());
      okay();
      setOnline(true);
      setWarn(null);
      const sent = new Map(batch.map((b) => [b.itemVersionId, b.clientRecordedAt]));
      // Only what is still exactly what we sent is confirmed; a change made
      // while the request was in flight stays queued.
      update((c) => ({ ...c, unsent: c.unsent.filter((id) => sent.get(id) !== c.answers[id]?.clientRecordedAt) }));
      if (res.status !== 'started') serverFinal(res.status as SessionStatus);
    } catch (e) {
      const err = e instanceof SessionApiError ? e : new SessionApiError('UNKNOWN', 0);
      fail();
      if (err.code === 'NETWORK') setOnline(false);
      else setWarn(err.status === 401 ? 'signedOut' : 'warn');
    } finally {
      inFlight.current = false;
    }
  };

  /** Submit button or time out: the same path. */
  const finish = (timeUp: boolean) => {
    const cur = sRef.current;
    if (!cur || cur.finalPending || cur.bundle.status !== 'started') return;
    leave();
    setConfirmOpen(false);
    setExitOpen(false);
    update((c) => ({
      ...c,
      finalPending: true,
      finalOffline: c.finalOffline || (typeof navigator !== 'undefined' && !navigator.onLine),
      timeUp,
    }));
    setSubmitState('sending');
    go('done');
    okay();
    void submitNow(true);
  };

  // ------------------------------------------------------------- boot

  const download = async (session: LocalSession) => {
    go('download');
    setDownloaded(0);
    try {
      await prefetchMedia(session.bundle.items, setDownloaded, media.current);
      go('ready');
    } catch (e) {
      go(e instanceof MediaNetworkError ? 'downloadError' : 'error');
    }
  };

  const boot = async (useInitial: boolean) => {
    const local = loadLocal(sessionId);
    let bundle: Bundle | null = useInitial ? initial : null;
    let skewMs = bundle ? Date.parse(bundle.serverTime) - Date.now() : 0;
    if (!bundle) {
      go('loading');
      try {
        const t0 = Date.now();
        bundle = await sessionApi.bundle(sessionId);
        skewMs = Date.parse(bundle.serverTime) - (t0 + Date.now()) / 2;
      } catch (e) {
        const err = e instanceof SessionApiError ? e : new SessionApiError('UNKNOWN', 0);
        if (err.status === 404) return go('notFound');
        if (err.status === 401) return go('signedOut');
        if (err.code === 'NETWORK' && local) {
          // Offline reload: carry on from the copy on this device.
          bundle = local.bundle;
          skewMs = local.skewMs;
          setOnline(false);
        } else {
          return go(err.code === 'NETWORK' ? 'fetchError' : 'error');
        }
      }
    }

    const session = merge(bundle, local, Number.isFinite(skewMs) ? skewMs : 0, locale === 'ru' ? 'ru' : 'uz');
    sRef.current = session;
    setS(session);
    saveLocal(session);
    spent.current = Object.fromEntries(Object.values(session.answers).map((a) => [a.itemVersionId, a.responseMs]));

    const status = session.bundle.status;
    if (status === 'submitted') {
      setSubmitState('sent');
      go('done');
      void loadResult();
      return;
    }
    if (status === 'expired' || status === 'voided') return go('expired');
    if (session.finalPending) {
      setSubmitState('waiting');
      go('done');
      void submitNow(true);
      return;
    }
    if (session.bundle.items.length === 0) return go('empty');
    await download(session);
  };

  useEffect(() => {
    void boot(true);
    const urls = media.current;
    return () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    };
    // Boot once per mount; retries call boot() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // The latest closures for listeners bound once.
  const latest = useRef({ flush, leave, enter });
  useLayoutEffect(() => {
    latest.current = { flush, leave, enter };
  });

  useEffect(() => {
    setOnline(navigator.onLine);
    const tick = window.setInterval(() => void latest.current.flush(false), SYNC_EVERY_MS);
    const onOnline = () => {
      setOnline(true);
      okay();
      void latest.current.flush(true);
    };
    const onOffline = () => setOnline(false);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        latest.current.leave();
        void latest.current.flush(true);
      } else if (phaseRef.current === 'test') {
        latest.current.enter();
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ------------------------------------------------------------- clock

  const ticking = phase === 'ready' || phase === 'test' || phase === 'review';
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const deadline = s?.bundle.deadlineAt ? Date.parse(s.bundle.deadlineAt) : null;
  const remaining = deadline === null || !s ? null : deadline - (now + s.skewMs);

  useEffect(() => {
    if (ticking && remaining !== null && remaining <= 0) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticking, remaining]);

  // ------------------------------------------------------------- focus

  useEffect(() => {
    if (phase === 'test' || phase === 'review' || phase === 'done') headingRef.current?.focus();
  }, [phase, s?.current]);

  // ------------------------------------------------------------- actions

  const choose = (optionId: string) => record({ chosenOptionId: optionId });
  const toggleFlag = () => {
    const cur = sRef.current;
    const id = currentId();
    if (!cur || !id) return;
    record({ flagged: !cur.answers[id]?.flagged });
  };

  function record(patch: { chosenOptionId?: string; flagged?: boolean }) {
    const cur = sRef.current;
    const id = currentId();
    if (!cur || !id || cur.finalPending || (remaining !== null && remaining <= 0)) return;
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
          clientRecordedAt: new Date().toISOString(),
        },
      },
      unsent: addUnique(c.unsent, id),
    }));
  }

  const goTo = (index: number) => {
    leave();
    update((c) => ({ ...c, current: index, visited: addUnique(c.visited, index) }));
    enter();
    go('test');
  };

  const next = () => {
    const cur = sRef.current;
    if (!cur) return;
    if (cur.current >= cur.bundle.items.length - 1) {
      leave();
      go('review');
    } else {
      goTo(cur.current + 1);
    }
  };

  const start = () => {
    update((c) => ({ ...c, started: true, visited: addUnique(c.visited, c.current) }));
    enter();
    go('test');
    void beginClock();
  };

  /**
   * design/05: "the clock starts when you press Start". The server sets the
   * deadline once (`begin` is idempotent, so a resumed session keeps its own).
   * Offline, the device counts from now — never past the wave's close — and
   * the server, which never started a clock, leaves the session to the device.
   */
  async function beginClock() {
    const cur = sRef.current;
    if (!cur || cur.bundle.deadlineAt) return;
    try {
      const r = await sessionApi.begin(sessionId);
      if (r.deadlineAt) {
        update((c) => ({ ...c, bundle: { ...c.bundle, deadlineAt: r.deadlineAt as string } }));
      }
    } catch {
      const limit = cur.bundle.timeLimitSec;
      if (!limit) return;
      const closes = cur.bundle.waveClosesAt ? Date.parse(cur.bundle.waveClosesAt) : Number.POSITIVE_INFINITY;
      const local = Math.min(Date.now() + cur.skewMs + limit * 1000, closes);
      update((c) => ({ ...c, bundle: { ...c.bundle, deadlineAt: new Date(local).toISOString() } }));
    }
  }

  const toReview = () => {
    leave();
    go('review');
  };

  const leaveTest = () => {
    leave();
    void flush(true);
    setExitOpen(false);
    router.push(home);
  };

  // Keyboard: 1–4 / A–D choose, ← → move (design/05 a11y notes).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (phase !== 'test' || exitOpen || confirmOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, dialog')) return;
      const cur = sRef.current;
      const item = cur?.bundle.items[cur.current];
      if (!cur || !item) return;
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

  const b = s?.bundle ?? initial;
  const practice = b?.mode === 'practice';
  const mode = b ? (practice ? 'practice' : 'monitoring') : undefined;
  const wave = b?.waveOrdinal ? fill(t.wave, { n: b.waveOrdinal }) : t.practice;
  const gradeLabel = b
    ? (fam.grade as Record<string, string>)[String(b.grade)] ?? fill(fam.gradeShort, { n: b.grade })
    : '';
  const who = b ? [practice ? t.practice : wave, b.childName, gradeLabel].filter(Boolean).join(' · ') : undefined;
  const closesOn = b?.waveClosesAt ? formatDate(b.waveClosesAt, locale, false) : null;
  const working = phase === 'test' || phase === 'review';

  const showTimer = ticking && remaining !== null && b?.timeLimitSec != null;
  const timer = showTimer ? (
    <div className={remaining! < 5 * 60_000 ? 'kd-timer kd-timer--low' : 'kd-timer'} role="timer" aria-label={t.timeLabel}>
      <Icon name="clock" size={20} />
      <span className="kd-timer__label">{t.timeLabel}</span>
      <span className="kd-timer__value">{formatRemaining(remaining!, t)}</span>
    </div>
  ) : null;

  const action = working ? (
    <button type="button" className="fam-btn kd-exit" onClick={() => setExitOpen(true)}>
      <Icon name="signOut" size={20} />
      {t.exit}
    </button>
  ) : (
    <Link href={home} className="fam-btn kd-exit">
      <Icon name="signOut" size={20} />
      {t.exit}
    </Link>
  );

  const bar = (
    <KidBar
      brand={brand}
      mode={mode}
      modeLabel={practice ? t.modePractice : t.modeMonitoring}
      who={who}
      timer={timer}
      action={action}
    />
  );

  const unsentN = s?.unsent.length ?? 0;
  const syncOk = online && !warn;
  const syncText =
    warn === 'signedOut'
      ? t.syncSignedOut
      : !online
        ? unsentN
          ? fill(t.syncOffline, { n: unsentN })
          : t.syncOfflineZero
        : warn
          ? t.syncWarn
          : unsentN
            ? fill(t.syncSending, { n: unsentN })
            : t.syncOnline;
  const sync = (
    <div className={syncOk ? 'kd-sync' : 'kd-sync kd-sync--warn'} role="status" aria-live="polite">
      {online ? <WifiOn /> : <WifiOff />}
      <span>{syncText}</span>
    </div>
  );

  const items = s?.bundle.items ?? [];
  const answeredIdx = items.map((it, i) => (s?.answers[it.itemVersionId]?.chosenOptionId ? i : -1)).filter((i) => i >= 0);
  const answeredCount = answeredIdx.length;
  const mediaUrl = (u: string) => media.current.get(u) ?? u;

  let body: React.ReactNode;
  switch (phase) {
    case 'loading':
      body = (
        <section className="kd-card kd-main" aria-busy="true">
          <span className="visually-hidden" role="status">
            {t.ldBundle}
          </span>
          <span className="skel" style={{ width: '30%', height: 14 }} />
          <span className="skel" style={{ width: '70%', height: 34 }} />
          <span className="skel" style={{ width: '100%', height: 88, borderRadius: 24 }} />
          <span className="skel" style={{ width: 200, height: 64, borderRadius: 999 }} />
        </section>
      );
      break;
    case 'download': {
      const total = b?.items.length ?? 0;
      body = (
        <section className="kd-card kd-main" aria-busy="true" aria-labelledby="kd-dl-title">
          <div className="kd-dl">
            <span className="kd-dl__icon" aria-hidden="true">
              <Icon name="arrowRight" size={24} />
            </span>
            <div className="kd-head">
              <h1 id="kd-dl-title" className="kd-h2">
                {t.ldTitle}
              </h1>
              <p className="kd-muted">{t.ldBody}</p>
            </div>
            <span className="kd-dl__count" role="status">
              {fill(t.ldCount, { n: downloaded, m: total })}
            </span>
          </div>
          <div
            className="kd-progress kd-progress--dl"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={downloaded}
            aria-label={t.ldTitle}
          >
            <span style={{ width: `${total ? Math.round((downloaded / total) * 100) : 0}%` }} />
          </div>
          <span className="skel" style={{ width: '70%', height: 30 }} />
          <div className="kd-facts kd-facts--two">
            <span className="skel" style={{ height: 88, borderRadius: 30 }} />
            <span className="skel" style={{ height: 88, borderRadius: 30 }} />
          </div>
        </section>
      );
      break;
    }
    case 'downloadError':
    case 'fetchError':
      body = (
        <KidState tone="danger" icon="alert" title={t.erTitle} body={t.erBody} alert>
          <button
            type="button"
            className="fam-btn fam-btn--primary kd-btn"
            onClick={() => (phase === 'downloadError' && sRef.current ? void download(sRef.current) : void boot(false))}
          >
            {t.retry}
          </button>
          <Link href={home} className="fam-btn fam-btn--quiet kd-btn">
            {t.erLater}
          </Link>
        </KidState>
      );
      break;
    case 'error':
      body = (
        <KidState tone="danger" icon="alert" title={t.errTitle} body={t.errBody} alert>
          <button type="button" className="fam-btn fam-btn--primary kd-btn" onClick={() => void boot(false)}>
            {t.retry}
          </button>
          <Link href={home} className="fam-btn fam-btn--quiet kd-btn">
            {t.dnHome}
          </Link>
        </KidState>
      );
      break;
    case 'notFound':
      body = (
        <KidState icon="info" title={t.nfTitle} body={t.nfBody}>
          <Link href={home} className="fam-btn fam-btn--primary kd-btn">
            {t.dnHome}
          </Link>
        </KidState>
      );
      break;
    case 'signedOut':
      body = (
        <KidState tone="warning" icon="lock" title={t.soTitle} body={t.soBody}>
          <Link href={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/play/${sessionId}`)}`} className="fam-btn fam-btn--primary kd-btn">
            {t.soAction}
          </Link>
        </KidState>
      );
      break;
    case 'expired':
      body = (
        <KidState icon="calendar" title={t.xpTitle} body={t.xpBody}>
          <Link href={home} className="fam-btn fam-btn--primary kd-btn">
            {t.dnHome}
          </Link>
        </KidState>
      );
      break;
    case 'empty':
      body = (
        <KidState icon="inbox" title={t.emTitle} body={t.emBody}>
          <Link href={home} className="fam-btn fam-btn--primary kd-btn">
            {t.dnHome}
          </Link>
        </KidState>
      );
      break;
    case 'ready':
      body = s && (
        <ReadyScreen
          t={t}
          practice={practice}
          name={s.bundle.childName}
          wave={wave}
          questions={items.length}
          answered={answeredCount}
          minutesLeft={
            s.bundle.timeLimitSec == null
              ? null
              : remaining === null
                ? Math.round(s.bundle.timeLimitSec / 60) // not started yet: the full limit
                : Math.max(0, Math.ceil(remaining / 60_000))
          }
          resumed={s.started}
          stemLang={s.stemLang}
          onStemLang={(l) => update((c) => ({ ...c, stemLang: l }))}
          onStart={start}
        />
      );
      break;
    case 'test':
    case 'review': {
      if (!s) break;
      const cells = items.map((it, i) => {
        const a = s.answers[it.itemVersionId];
        const state: CellState =
          phase === 'test' && i === s.current
            ? 'current'
            : a?.chosenOptionId
              ? 'answered'
              : s.visited.includes(i)
                ? 'skipped'
                : 'notYet';
        return { state, flagged: !!a?.flagged };
      });
      const item = items[s.current];
      body = (
        <div className="kd-work">
          <div className="kd-work__main">
            {phase === 'test' && item ? (
              <QuestionCard
                key={item.itemVersionId}
                t={t}
                item={item}
                index={s.current}
                total={items.length}
                answer={s.answers[item.itemVersionId]}
                answeredCount={answeredCount}
                stemLang={s.stemLang}
                media={mediaUrl}
                locked={remaining !== null && remaining <= 0}
                headingRef={headingRef}
                onChoose={choose}
                onFlag={toggleFlag}
                onPrev={() => s.current > 0 && goTo(s.current - 1)}
                onNext={next}
                onSkip={next}
                sync={sync}
              />
            ) : (
              <ReviewScreen
                t={t}
                answered={answeredCount}
                unanswered={items.map((_, i) => i).filter((i) => !answeredIdx.includes(i))}
                flagged={items.map((it, i) => (s.answers[it.itemVersionId]?.flagged ? i : -1)).filter((i) => i >= 0)}
                headingRef={headingRef}
                onPick={goTo}
                onBack={() => goTo(s.current)}
                onSubmit={() => setConfirmOpen(true)}
                sync={sync}
              />
            )}
          </div>
          <Navigator
            t={t}
            cells={cells}
            answeredCount={answeredCount}
            showReview={phase === 'test'}
            onPick={goTo}
            onReview={toReview}
          />
        </div>
      );
      break;
    }
    case 'done':
      body = s && (
        <DoneScreen
          t={t}
          practice={practice}
          name={s.bundle.childName}
          wave={wave}
          closesOn={closesOn}
          submit={submitState}
          timeUp={s.timeUp}
          result={s.result}
          warning={warn === 'signedOut' ? t.syncSignedOut : warn ? t.syncWarn : null}
          homeHref={home}
          headingRef={headingRef}
          onRetry={() => {
            okay();
            void submitNow(true);
          }}
        />
      );
      break;
  }

  const unanswered = items.length - answeredCount;

  return (
    <>
      {bar}
      <main className={practice ? 'kid__stage kd-stage kd-stage--practice' : 'kid__stage kd-stage'}>{body}</main>
      <ConfirmDialog
        open={exitOpen}
        title={t.exTitle}
        body={closesOn ? fill(t.exBody, { date: closesOn }) : t.exBodyNoDate}
        confirmLabel={t.exLeave}
        cancelLabel={t.exStay}
        danger={false}
        icon="file"
        onConfirm={leaveTest}
        onClose={() => setExitOpen(false)}
      />
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
