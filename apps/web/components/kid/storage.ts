'use client';

import type { AnswerInput, Bundle, SessionResult } from '@/lib/session-types';

/**
 * The device-side copy of a session (task.md § 8.3, § 11: "buffer answers
 * locally"). Everything a reload needs to carry on without the network: the
 * bundle, the answer buffer, which answers the server has not confirmed yet and
 * whether a final submit is still queued.
 *
 * Storage can throw (private mode, quota, disabled cookies). Every access is
 * wrapped: the player keeps working in memory, it just loses the reload safety.
 */
export interface LocalAnswer extends AnswerInput {
  flagged: boolean;
  revisionCount: number;
  responseMs: number;
}

export interface LocalSession {
  v: 1;
  bundle: Bundle;
  /** serverTime − device time at download; corrects the timer for a wrong device clock. */
  skewMs: number;
  answers: Record<string, LocalAnswer>;
  /** itemVersionIds changed since the server last confirmed them. */
  unsent: string[];
  visited: number[];
  current: number;
  started: boolean;
  stemLang: 'uz' | 'ru';
  /** The child pressed Submit (or time ran out) but the server has not answered yet. */
  finalPending: boolean;
  finalOffline: boolean;
  timeUp: boolean;
  result: SessionResult | null;
}

const key = (sessionId: string) => `zinapo.kid.${sessionId}`;

export function loadLocal(sessionId: string): LocalSession | null {
  try {
    const raw = window.localStorage.getItem(key(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    return parsed?.v === 1 && parsed.bundle?.sessionId === sessionId ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocal(state: LocalSession): void {
  try {
    window.localStorage.setItem(key(state.bundle.sessionId), JSON.stringify(state));
  } catch {
    // Quota or private mode: the in-memory buffer still syncs.
  }
}

// ----------------------------------------------------------- media blobs

const DB = 'zinapo-kid';
const STORE = 'media';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

/** Signed URLs change on every bundle fetch; the object behind them does not. */
export const mediaKey = (url: string) => url.split('?')[0];

export async function getBlob(url: string): Promise<Blob | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(mediaKey(url));
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putBlob(url: string, blob: Blob): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, mediaKey(url));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
