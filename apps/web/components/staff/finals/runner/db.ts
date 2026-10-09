'use client';

import type { LocalAnswer } from '@/components/kid/storage';
import type { FinalPackage, SyncSession } from '@/lib/olympiad-types';

/**
 * The offline runner's device store (task.md § 11 "Offline final: the runner
 * works with zero connectivity and syncs later"; note M7-a). IndexedDB, not
 * localStorage: the package carries every picture and sound as data: URIs and
 * easily outgrows localStorage's ~5 MB.
 *
 *   packages  venueId   → the package as downloaded, plus the clock skew
 *   runs      sessionId → one child's sitting: answers, times, upload state
 *
 * Every answer is a `put` of the whole run. Read-write transactions on the same
 * store run in the order they were created, so the last change always wins.
 */

export interface StoredPackage {
  venueId: string;
  pkg: FinalPackage;
  savedAt: string;
  /** server clock − device clock at download, so recorded times stay right on a device with a wrong clock. */
  skewMs: number;
}

export type UploadState = 'none' | 'pending' | 'synced' | 'already' | 'rejected';

export interface RunRecord {
  sessionId: string;
  venueId: string;
  entryId: string;
  childName: string;
  grade: number;
  formId: string;
  stemLang: 'uz' | 'ru';
  startedAt: string | null;
  /** startedAt + the form's limit; null = no limit. Absolute, so the clock runs on while the child is away. */
  deadlineAt: string | null;
  submittedAt: string | null;
  timeUp: boolean;
  answers: Record<string, LocalAnswer>;
  visited: number[];
  current: number;
  upload: UploadState;
  reason: string | null;
}

/** The export file (SyncSession[] + venueId). `kind` lets the importer refuse any other JSON. */
export interface AnswersFile {
  kind: 'zinapo-final-answers';
  v: 1;
  venueId: string;
  venueName: string;
  exportedAt: string;
  sessions: SyncSession[];
}

const DB = 'zinapo-runner';
const VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('packages')) db.createObjectStore('packages', { keyPath: 'venueId' });
      if (!db.objectStoreNames.contains('runs')) {
        db.createObjectStore('runs', { keyPath: 'sessionId' }).createIndex('venueId', 'venueId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema: let it, and reopen next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

/** One transaction; resolves with `fn`'s request result once the transaction has COMMITTED. */
async function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export const runnerDb = {
  getPackage: (venueId: string) =>
    run<StoredPackage | undefined>(['packages'], 'readonly', (tx) => tx.objectStore('packages').get(venueId)).then(
      (r) => r ?? null,
    ),

  getRuns: (venueId: string) =>
    run<RunRecord[]>(['runs'], 'readonly', (tx) => tx.objectStore('runs').index('venueId').getAll(venueId)).then(
      (r) => r ?? [],
    ),

  putRun: (r: RunRecord) => run(['runs'], 'readwrite', (tx) => tx.objectStore('runs').put(r)).then(() => undefined),

  /** The package and any runs it adds, in one transaction: never a package without its runs. */
  savePackage: (p: StoredPackage, newRuns: RunRecord[]) =>
    run(['packages', 'runs'], 'readwrite', (tx) => {
      tx.objectStore('packages').put(p);
      const runs = tx.objectStore('runs');
      for (const r of newRuns) runs.put(r);
    }).then(() => undefined),

  putRuns: (rs: RunRecord[]) =>
    run(['runs'], 'readwrite', (tx) => {
      const runs = tx.objectStore('runs');
      for (const r of rs) runs.put(r);
    }).then(() => undefined),

  clearVenue: (venueId: string, sessionIds: string[]) =>
    run(['packages', 'runs'], 'readwrite', (tx) => {
      tx.objectStore('packages').delete(venueId);
      const runs = tx.objectStore('runs');
      for (const id of sessionIds) runs.delete(id);
    }).then(() => undefined),
};

/** Ask the browser not to evict the package under storage pressure. Best effort. */
export async function askPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported — the package still works, it is just evictable */
  }
}

/** What the sync endpoint accepts (olympiad.dto.ts SyncAnswerDto): integers, responseMs ≤ 1 h. */
export function toSyncSession(r: RunRecord, device: string): SyncSession {
  return {
    sessionId: r.sessionId,
    startedAt: r.startedAt ?? r.submittedAt!,
    submittedAt: r.submittedAt!,
    device,
    answers: Object.values(r.answers).map((a) => ({
      itemVersionId: a.itemVersionId,
      chosenOptionId: a.chosenOptionId,
      clientRecordedAt: a.clientRecordedAt,
      responseMs: Math.min(3_600_000, Math.max(0, Math.round(a.responseMs))),
      revisionCount: Math.min(1000, Math.max(0, Math.round(a.revisionCount))),
      flagged: a.flagged,
    })),
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Parses an export; null when it is not one. Shape only — the server validates every answer again. */
export function parseAnswersFile(text: string): AnswersFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const f = raw as Partial<AnswersFile> | null;
  if (!f || f.kind !== 'zinapo-final-answers' || !isStr(f.venueId) || !Array.isArray(f.sessions)) return null;
  const ok = f.sessions.every(
    (s) =>
      s &&
      isStr(s.sessionId) &&
      isStr(s.startedAt) &&
      isStr(s.submittedAt) &&
      Array.isArray(s.answers) &&
      s.answers.every((a) => a && isStr(a.itemVersionId) && isStr(a.clientRecordedAt)),
  );
  return ok ? (f as AnswersFile) : null;
}
