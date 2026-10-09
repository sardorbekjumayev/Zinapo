'use client';

import type { BundleItem } from '@/lib/session-types';
import { getBlob, putBlob } from './storage';

/** Every picture and sound one question needs. */
export function itemUrls(it: BundleItem): string[] {
  return [it.imageUrl, it.audioUrlUz, it.audioUrlRu, ...it.options.map((o) => o.imageUrl)].filter(
    (u): u is string => !!u,
  );
}

export class MediaNetworkError extends Error {}

async function fetchOne(url: string): Promise<string | null> {
  const cached = await getBlob(url);
  if (cached) return URL.createObjectURL(cached);
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    throw new MediaNetworkError(url);
  }
  // A 404 (expired or unknown link) cannot be fixed by retrying: the question
  // falls back to the URL itself rather than blocking the whole test.
  if (!res.ok) return null;
  const blob = await res.blob();
  await putBlob(url, blob);
  return URL.createObjectURL(blob);
}

/**
 * Pulls every image and audio file into memory before the start (task.md
 * § 7.1: "kid mode loads the whole form before starting and works offline"),
 * and into IndexedDB so a later visit needs no download. Returns signed URL →
 * object URL. Throws `MediaNetworkError` when the connection drops.
 */
export async function prefetchMedia(
  items: BundleItem[],
  onProgress: (done: number) => void,
  into: Map<string, string>,
): Promise<void> {
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      for (const url of itemUrls(it)) {
        if (into.has(url)) continue;
        const local = await fetchOne(url);
        if (local) into.set(url, local);
      }
      done += 1;
      onProgress(done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
