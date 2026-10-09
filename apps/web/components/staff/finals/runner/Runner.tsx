'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/family/ConfirmDialog';
import { KidBar } from '@/components/kid/KidBar';
import { WifiOff, WifiOn } from '@/components/kid/ReadyScreen';
import { deviceInfo, formatRemaining } from '@/components/kid/util';
import { Icon } from '@/components/shell/Icon';
import { fill, type Locale } from '@/lib/i18n';
import { OlympiadApiError, olympiadApi } from '@/lib/olympiad-api';
import type { SyncResult, SyncSession } from '@/lib/olympiad-types';
import { finalsMessages } from '@/messages/finals';
import { kidMessages } from '@/messages/kid';
import { whenOf } from '../shared';
import { ChildTest } from './ChildTest';
import {
  askPersistence,
  idbAvailable,
  parseAnswersFile,
  runnerDb,
  toSyncSession,
  type AnswersFile,
  type RunRecord,
  type StoredPackage,
} from './db';

type ChildState = 'waiting' | 'progress' | 'done' | 'synced' | 'already' | 'rejected';
type Msg = { tone: 'ok' | 'warn' | 'bad'; text: string } | null;

const BATCH = 1000; // POST …/sync takes at most 1000 sessions per call
const SWEEP_MS = 5_000;

function stateOf(r: RunRecord): ChildState {
  if (r.upload === 'already') return 'already';
  if (r.upload === 'synced') return 'synced';
  if (r.upload === 'rejected') return 'rejected';
  if (r.submittedAt) return 'done';
  return r.startedAt ? 'progress' : 'waiting';
}

let refreshing: Promise<boolean> | null = null;

/**
 * The access token lives 15 minutes and a final takes longer, so the upload
 * after an offline final usually meets a 401. One refresh (the refresh cookie
 * lives 30 days) and one retry; a single refresh in flight, because the
 * server rotates the refresh token on every use.
 */
async function withRefresh<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof OlympiadApiError) || e.status !== 401) throw e;
    refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    if (!(await refreshing)) throw e;
    return call();
  }
}

const chunks = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/**
 * The offline runner (task.md § 8.5 "Proctor", § 11; product-owner note M7-a).
 *
 * Online, the proctor downloads one package for every checked-in child into
 * IndexedDB. From then on nothing here needs the network: children sit the
 * final one after another on this device, every answer is written to the
 * device at once, and finished sittings wait in an outbox. The outbox uploads
 * when the browser reports it is back online, on demand, or through a file
 * exported here and uploaded from any device signed in as this proctor.
 *
 * There is no service worker: the page itself is not cached, so the tab must
 * stay open while offline. The UI says so rather than promising more.
 */
export function Runner({
  locale,
  venueId,
  venueName,
  brand,
  rosterHref,
}: {
  locale: Locale;
  venueId: string;
  venueName: string | null;
  brand: string;
  rosterHref: string;
}) {
  const m = finalsMessages(locale);
  const t = kidMessages(locale);

  const [boot, setBoot] = useState<'loading' | 'unsupported' | 'ready'>('loading');
  const [stored, setStored] = useState<StoredPackage | null>(null);
  const [runs, setRuns] = useState<Record<string, RunRecord>>({});
  const runsRef = useRef<Record<string, RunRecord>>({});
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [storageWarn, setStorageWarn] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState<Msg>(null);
  const [upBusy, setUpBusy] = useState(false);
  const uploading = useRef(false);
  const [upMsg, setUpMsg] = useState<Msg>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMsg, setFileMsg] = useState<Msg>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearMsg, setClearMsg] = useState<Msg>(null);
  const [now, setNow] = useState(() => Date.now());

  const skewMs = stored?.skewMs ?? 0;
  const pkg = stored?.pkg ?? null;
  const name = pkg?.venue.name ?? venueName ?? '';
  const gradeLabel = (g: number) => fill(m.common.gradeFmt, { n: g });

  // ------------------------------------------------------------- store

  const setAll = (next: Record<string, RunRecord>) => {
    runsRef.current = next;
    setRuns(next);
  };

  const persist = (r: RunRecord) => {
    setAll({ ...runsRef.current, [r.sessionId]: r });
    runnerDb.putRun(r).catch(() => setStorageWarn(true));
  };

  const persistMany = (rs: RunRecord[]) => {
    if (!rs.length) return;
    const next = { ...runsRef.current };
    for (const r of rs) next[r.sessionId] = r;
    setAll(next);
    runnerDb.putRuns(rs).catch(() => setStorageWarn(true));
  };

  useEffect(() => {
    setOnline(navigator.onLine);
    if (!idbAvailable()) {
      setBoot('unsupported');
      return;
    }
    let alive = true;
    Promise.all([runnerDb.getPackage(venueId), runnerDb.getRuns(venueId)])
      .then(([p, rs]) => {
        if (!alive) return;
        setStored(p);
        setAll(Object.fromEntries(rs.map((r) => [r.sessionId, r])));
        setBoot('ready');
      })
      .catch(() => alive && setBoot('unsupported'));
    return () => {
      alive = false;
    };
  }, [venueId]);

  // ------------------------------------------------------------- download

  const download = async () => {
    setDlBusy(true);
    setDlMsg(null);
    try {
      const t0 = Date.now();
      const p = await withRefresh(() => olympiadApi.package(venueId));
      const skew = Date.parse(p.generatedAt) - (t0 + Date.now()) / 2;
      const added: RunRecord[] = [];
      for (const s of p.sessions) {
        const have = runsRef.current[s.sessionId];
        if (!have) {
          added.push({
            sessionId: s.sessionId,
            venueId,
            entryId: s.entryId,
            childName: s.childName,
            grade: s.grade,
            formId: s.formId,
            stemLang: locale === 'ru' ? 'ru' : 'uz',
            startedAt: null,
            deadlineAt: null,
            submittedAt: null,
            timeUp: false,
            answers: {},
            visited: [],
            current: 0,
            // Submitted from another device already: nothing to sit or upload here.
            upload: s.status === 'submitted' ? 'already' : 'none',
            reason: null,
          });
        } else if (s.status === 'submitted' && !have.submittedAt) {
          added.push({ ...have, upload: 'already' });
        }
      }
      const next: StoredPackage = { venueId, pkg: p, savedAt: new Date().toISOString(), skewMs: Number.isFinite(skew) ? skew : 0 };
      try {
        await runnerDb.savePackage(next, added);
      } catch {
        setDlMsg({ tone: 'bad', text: m.runner.storageError });
        return;
      }
      void askPersistence();
      setStored(next);
      const all = { ...runsRef.current };
      for (const r of added) all[r.sessionId] = r;
      setAll(all);
      if (p.sessions.length === 0) setDlMsg({ tone: 'warn', text: m.runner.prep.noChildren });
    } catch (e) {
      const err = e instanceof OlympiadApiError ? e : new OlympiadApiError('UNKNOWN', 0);
      const errs = m.runner.prep.errors;
      if (err.code === 'STAGE_NOT_READY') {
        const grades = Array.isArray(err.details.grades) ? (err.details.grades as number[]).join(', ') : '';
        setDlMsg({ tone: 'bad', text: fill(m.runner.prep.notReadyFmt, { grades }) });
      } else {
        const text =
          err.status === 401 ? errs.SIGNED_OUT : err.status === 404 ? errs.NOT_FOUND : err.code === 'NETWORK' ? errs.NETWORK : errs.UNKNOWN;
        setDlMsg({ tone: 'bad', text });
      }
    } finally {
      setDlBusy(false);
    }
  };

  // ------------------------------------------------------------- upload

  const uploadErr = (e: unknown) => {
    const err = e instanceof OlympiadApiError ? e : new OlympiadApiError('UNKNOWN', 0);
    const errs = m.runner.outbox.errors;
    if (err.code === 'NETWORK') return { tone: 'warn' as const, text: errs.NETWORK };
    if (err.status === 401) return { tone: 'bad' as const, text: errs.SIGNED_OUT };
    if (err.status === 404) return { tone: 'bad' as const, text: errs.NOT_FOUND };
    return { tone: 'bad' as const, text: errs.UNKNOWN };
  };

  /** Sends in batches; marks each local run the server answered for. */
  const send = async (sessions: SyncSession[]): Promise<SyncResult> => {
    const total: SyncResult = { synced: 0, already: 0, rejected: [] };
    for (const batch of chunks(sessions, BATCH)) {
      const res = await withRefresh(() => olympiadApi.sync(venueId, batch));
      total.synced += res.synced;
      total.already += res.already;
      total.rejected.push(...res.rejected);
      const refused = new Map(res.rejected.map((x) => [x.sessionId, x.reason]));
      persistMany(
        batch
          .map((s) => runsRef.current[s.sessionId])
          .filter((r): r is RunRecord => !!r && !!r.submittedAt)
          .map((r) =>
            refused.has(r.sessionId)
              ? { ...r, upload: 'rejected' as const, reason: refused.get(r.sessionId) ?? null }
              : { ...r, upload: 'synced' as const, reason: null },
          ),
      );
    }
    return total;
  };

  const resultMsg = (res: SyncResult): Msg => ({
    tone: res.rejected.length ? 'warn' : 'ok',
    text: fill(m.runner.outbox.resultFmt, { synced: res.synced, already: res.already, rejected: res.rejected.length }),
  });

  const upload = async (auto: boolean) => {
    if (uploading.current) return;
    const pending = Object.values(runsRef.current).filter((r) => r.submittedAt && r.upload === 'pending');
    if (!pending.length) return;
    if (auto && typeof navigator !== 'undefined' && !navigator.onLine) return;
    uploading.current = true;
    setUpBusy(true);
    setUpMsg(null);
    try {
      const device = deviceInfo().device;
      setUpMsg(resultMsg(await send(pending.map((r) => toSyncSession(r, device)))));
    } catch (e) {
      setUpMsg(uploadErr(e));
    } finally {
      uploading.current = false;
      setUpBusy(false);
    }
  };

  // ------------------------------------------------------------- listeners

  const latest = useRef({ upload });
  useLayoutEffect(() => {
    latest.current = { upload };
  });

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void latest.current.upload(true);
    };
    const onOffline = () => setOnline(false);
    // No service worker: a reload while offline cannot bring the page back.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const midTest = Object.values(runsRef.current).some((r) => r.startedAt && !r.submittedAt);
      if (!navigator.onLine || midTest) {
        e.preventDefault();
        e.returnValue = ''; // older Chrome and Safari still need it
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  // Anything left in the outbox from an earlier visit goes as soon as we can.
  useEffect(() => {
    if (boot === 'ready') void latest.current.upload(true);
  }, [boot]);

  // While on the list: the countdowns, and handing in a sitting whose time ran out while the child was away.
  useEffect(() => {
    if (boot !== 'ready' || active) return;
    const sweep = () => {
      const at = Date.now() + skewMs;
      setNow(Date.now());
      const lapsed = Object.values(runsRef.current).filter(
        (r) => r.startedAt && !r.submittedAt && r.upload === 'none' && r.deadlineAt && Date.parse(r.deadlineAt) <= at,
      );
      if (!lapsed.length) return;
      persistMany(lapsed.map((r) => ({ ...r, submittedAt: r.deadlineAt, timeUp: true, upload: 'pending' as const })));
      void latest.current.upload(true);
    };
    sweep();
    const id = window.setInterval(sweep, SWEEP_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, active, skewMs]);

  // ------------------------------------------------------------- file

  const submitted = Object.values(runs).filter((r) => r.submittedAt);

  const exportFile = () => {
    setFileMsg(null);
    if (!submitted.length) {
      setFileMsg({ tone: 'warn', text: m.runner.file.exportNone });
      return;
    }
    const device = deviceInfo().device;
    const file: AnswersFile = {
      kind: 'zinapo-final-answers',
      v: 1,
      venueId,
      venueName: name,
      exportedAt: new Date().toISOString(),
      sessions: submitted.map((r) => toSyncSession(r, device)),
    };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const fileName = `zinapo-final-${venueId.slice(0, 8)}-${stamp}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setFileMsg({ tone: 'ok', text: fill(m.runner.file.exportedFmt, { n: submitted.length, file: fileName }) });
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const f = input.files?.[0];
    if (!f) return;
    setFileMsg(null);
    setFileBusy(true);
    try {
      const parsed = parseAnswersFile(await f.text());
      if (!parsed) return setFileMsg({ tone: 'bad', text: m.runner.file.badFile });
      if (parsed.venueId !== venueId) return setFileMsg({ tone: 'bad', text: m.runner.file.otherVenue });
      if (!parsed.sessions.length) return setFileMsg({ tone: 'warn', text: m.runner.file.emptyFile });
      setFileMsg(resultMsg(await send(parsed.sessions)));
    } catch (err) {
      setFileMsg(uploadErr(err));
    } finally {
      input.value = '';
      setFileBusy(false);
    }
  };

  // ------------------------------------------------------------- clear

  const list = Object.values(runs).sort((a, b) => a.childName.localeCompare(b.childName));
  const blocked = list.filter((r) => (r.startedAt && !r.submittedAt && r.upload === 'none') || r.upload === 'pending').length;
  const rejectedN = list.filter((r) => r.upload === 'rejected').length;

  const clearDevice = async () => {
    try {
      await runnerDb.clearVenue(venueId, Object.keys(runsRef.current));
      setStored(null);
      setAll({});
      setUpMsg(null);
      setFileMsg(null);
      setDlMsg(null);
      setClearMsg({ tone: 'ok', text: m.runner.clear.done });
    } catch {
      setClearMsg({ tone: 'bad', text: m.runner.storageError });
    }
    setClearOpen(false);
  };

  // ------------------------------------------------------------- render

  const activeRun = active ? runs[active] : null;
  const activeForm = activeRun && pkg ? pkg.forms[activeRun.formId] : null;
  if (activeRun && activeForm) {
    return (
      <ChildTest
        key={activeRun.sessionId}
        t={t}
        m={m}
        brand={brand}
        run={activeRun}
        form={activeForm}
        skewMs={skewMs}
        gradeLabel={gradeLabel(activeRun.grade)}
        onChange={persist}
        onSubmitted={() => void latest.current.upload(true)}
        onExit={() => setActive(null)}
      />
    );
  }

  const note = (msg: Msg) =>
    msg && (
      <p
        className={`fam-note fam-note--${msg.tone === 'ok' ? 'ok' : msg.tone === 'warn' ? 'warn' : 'danger'}`}
        role={msg.tone === 'bad' ? 'alert' : 'status'}
      >
        <Icon name={msg.tone === 'ok' ? 'check' : 'alert'} size={18} />
        <span>{msg.text}</span>
      </p>
    );

  const bar = (
    <KidBar
      brand={brand}
      mode="monitoring"
      modeLabel={m.runner.proctor}
      who={[m.runner.title, name].filter(Boolean).join(' · ')}
      action={
        <>
          <span className={online ? 'fn-net fn-net--on' : 'fn-net fn-net--off'} role="status">
            {online ? <WifiOn /> : <WifiOff />}
            {online ? m.runner.online : m.runner.offline}
          </span>
          {/* Leaving while offline would lose the page (no service worker). */}
          {online && (
            <Link href={rosterHref} className="fam-btn kd-exit">
              <Icon name="arrowLeft" size={18} />
              {m.runner.backToRoster}
            </Link>
          )}
        </>
      }
    />
  );

  if (boot !== 'ready') {
    return (
      <>
        {bar}
        <main className="kid__stage kd-stage">
          {boot === 'loading' ? (
            <section className="kd-card kd-main" aria-busy="true">
              <span className="visually-hidden" role="status">
                {m.runner.booting}
              </span>
              <span className="skel" style={{ width: '40%', height: 26 }} />
              <span className="skel" style={{ width: '80%', height: 16 }} />
              <span className="skel" style={{ width: 220, height: 56, borderRadius: 999 }} />
            </section>
          ) : (
            <section className="kd-card kd-state" role="alert">
              <span className="kd-state__icon kd-state__icon--danger">
                <Icon name="alert" size={26} />
              </span>
              <p className="kd-state__body">{m.runner.unsupported}</p>
            </section>
          )}
        </main>
      </>
    );
  }

  const counts = { pending: 0, uploaded: 0, rejected: 0 };
  for (const r of list) {
    const s = stateOf(r);
    if (s === 'done') counts.pending += 1;
    else if (s === 'synced' || s === 'already') counts.uploaded += 1;
    else if (s === 'rejected') counts.rejected += 1;
  }
  const reasonText = (reason: string | null) => {
    const rs = m.runner.outbox.reasons as Record<string, string>;
    return rs[reason ?? ''] ?? rs.other;
  };

  return (
    <>
      {bar}
      <main className="kid__stage kd-stage">
        {storageWarn && note({ tone: 'bad', text: m.runner.storageError })}
        <div className="fn-run">
          <div className="fn-run__main">
            <section className="fam-panel" aria-labelledby="fn-prep-title">
              <div>
                <h1 id="fn-prep-title" className="fam-panel__title">
                  {m.runner.prep.title}
                </h1>
                <p className="fam-panel__sub">{m.runner.prep.body}</p>
              </div>
              {pkg && (
                <div className="fn-ready" role="status">
                  <span className="fn-ready__icon" aria-hidden="true">
                    <Icon name="check" size={22} strokeWidth={2.2} />
                  </span>
                  <div>
                    <p className="fn-ready__title">{fill(m.runner.prep.readyFmt, { n: pkg.sessions.length })}</p>
                    <p className="fam-small fam-muted">
                      {fill(m.runner.prep.savedAtFmt, { when: whenOf(stored!.savedAt, locale, m) })}
                    </p>
                  </div>
                </div>
              )}
              {pkg && (
                <p className="fam-note fam-note--warn">
                  <Icon name="alert" size={18} />
                  <span>{m.runner.prep.keepOpen}</span>
                </p>
              )}
              <div className="fn-prep__row">
                <button
                  type="button"
                  className={pkg ? 'fam-btn' : 'fam-btn fam-btn--primary fn-btn--xl'}
                  disabled={dlBusy || !online}
                  onClick={download}
                >
                  {dlBusy ? <span className="spinner" aria-hidden="true" /> : <Icon name="arrowRight" size={18} />}
                  {dlBusy ? m.runner.prep.downloading : pkg ? m.runner.prep.redownload : m.runner.prep.download}
                </button>
                <span className="fam-small fam-muted">{online ? (pkg ? m.runner.prep.redownloadNote : '') : m.runner.prep.needOnline}</span>
              </div>
              <div aria-live="polite">{note(dlMsg)}</div>
            </section>

            <section className="fam-panel" aria-labelledby="fn-kids-title">
              <div>
                <h2 id="fn-kids-title" className="fam-panel__title">
                  {m.runner.list.title}
                </h2>
                <p className="fam-panel__sub">{m.runner.list.sub}</p>
              </div>
              {list.length === 0 ? (
                <p className="fam-muted">{m.runner.list.empty}</p>
              ) : (
                <ul className="fn-kids">
                  {list.map((r) => {
                    const s = stateOf(r);
                    const left = r.deadlineAt ? Date.parse(r.deadlineAt) - (now + skewMs) : null;
                    const label =
                      s === 'progress'
                        ? left !== null
                          ? fill(m.runner.list.progressFmt, { time: formatRemaining(left, t) })
                          : m.runner.list.progress
                        : s === 'rejected'
                          ? fill(m.runner.list.rejectedFmt, { reason: reasonText(r.reason) })
                          : (m.runner.list as Record<string, string>)[s];
                    const tone = { waiting: '', progress: 'blue', done: 'warn', synced: 'ok', already: 'ok', rejected: 'danger' }[s];
                    const canOpen = (s === 'waiting' || s === 'progress') && !!pkg?.forms[r.formId];
                    const inner = (
                      <>
                        <span className="fn-kid__who">
                          <span className="fn-kid__name">{r.childName}</span>
                          <span className="fn-kid__grade">{gradeLabel(r.grade)}</span>
                        </span>
                        <span className={tone ? `fam-tag fam-tag--${tone}` : 'fam-tag'}>{label}</span>
                        {canOpen && (
                          <span className="fn-kid__go" aria-hidden="true">
                            {s === 'progress' ? m.runner.list.resume : m.runner.list.open}
                            <Icon name="arrowRight" size={18} />
                          </span>
                        )}
                      </>
                    );
                    return (
                      <li key={r.sessionId}>
                        {canOpen ? (
                          <button
                            type="button"
                            className="fn-kid fn-kid--go"
                            aria-label={`${r.childName}, ${gradeLabel(r.grade)} — ${label}. ${s === 'progress' ? m.runner.list.resume : m.runner.list.open}`}
                            onClick={() => setActive(r.sessionId)}
                          >
                            {inner}
                          </button>
                        ) : (
                          <div className="fn-kid">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <div className="fn-run__side">
            <section className="fam-panel" aria-labelledby="fn-out-title">
              <div>
                <h2 id="fn-out-title" className="fam-panel__title">
                  {m.runner.outbox.title}
                </h2>
                <p className="fam-panel__sub">{m.runner.outbox.sub}</p>
              </div>
              {submitted.length === 0 ? (
                <p className="fam-muted fam-small">{m.runner.outbox.none}</p>
              ) : (
                <ul className="fn-tally">
                  <li>
                    <span className="fam-tag fam-tag--warn">{fill(m.runner.outbox.pendingFmt, { n: counts.pending })}</span>
                  </li>
                  <li>
                    <span className="fam-tag fam-tag--ok">{fill(m.runner.outbox.uploadedFmt, { n: counts.uploaded })}</span>
                  </li>
                  {counts.rejected > 0 && (
                    <li>
                      <span className="fam-tag fam-tag--danger">{fill(m.runner.outbox.rejectedFmt, { n: counts.rejected })}</span>
                    </li>
                  )}
                </ul>
              )}
              <div className="fn-prep__row">
                <button
                  type="button"
                  className="fam-btn fam-btn--primary"
                  disabled={upBusy || counts.pending === 0}
                  onClick={() => void upload(false)}
                >
                  {upBusy ? <span className="spinner" aria-hidden="true" /> : <Icon name="arrowRight" size={18} />}
                  {upBusy ? m.runner.outbox.uploading : m.runner.outbox.upload}
                </button>
                <span className="fam-small fam-muted">{m.runner.outbox.autoNote}</span>
              </div>
              <div aria-live="polite">{note(upMsg)}</div>
            </section>

            <section className="fam-panel" aria-labelledby="fn-file-title">
              <div>
                <h2 id="fn-file-title" className="fam-panel__title">
                  {m.runner.file.title}
                </h2>
                <p className="fam-panel__sub">{m.runner.file.body}</p>
              </div>
              <div className="fn-file">
                <button type="button" className="fam-btn" onClick={exportFile}>
                  <Icon name="file" size={18} />
                  {m.runner.file.export}
                </button>
                <label className={fileBusy ? 'fam-btn fn-file__pick fn-file__pick--busy' : 'fam-btn fn-file__pick'}>
                  {fileBusy ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" size={18} />}
                  {fileBusy ? m.runner.file.importing : m.runner.file.import}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="fn-file__input"
                    disabled={fileBusy}
                    onChange={importFile}
                  />
                </label>
              </div>
              <div aria-live="polite">{note(fileMsg)}</div>
            </section>

            <section className="fam-panel" aria-labelledby="fn-clear-title">
              <div>
                <h2 id="fn-clear-title" className="fam-panel__title">
                  {m.runner.clear.title}
                </h2>
                <p className="fam-panel__sub">{m.runner.clear.body}</p>
              </div>
              {blocked > 0 && (
                <p className="fam-small fam-muted">{fill(m.runner.clear.blockedFmt, { n: blocked })}</p>
              )}
              <div>
                <button
                  type="button"
                  className="fam-btn fam-btn--danger"
                  disabled={blocked > 0 || (!pkg && list.length === 0)}
                  onClick={() => setClearOpen(true)}
                >
                  <Icon name="trash" size={18} />
                  {m.runner.clear.btn}
                </button>
              </div>
              <div aria-live="polite">{note(clearMsg)}</div>
            </section>
          </div>
        </div>
      </main>
      <ConfirmDialog
        open={clearOpen}
        title={m.runner.clear.dlgTitle}
        body={m.runner.clear.dlgBody}
        list={rejectedN ? [fill(m.runner.clear.dlgRejectedFmt, { n: rejectedN })] : undefined}
        confirmLabel={m.runner.clear.yes}
        cancelLabel={m.runner.clear.no}
        icon="trash"
        onConfirm={() => void clearDevice()}
        onClose={() => setClearOpen(false)}
      />
    </>
  );
}
