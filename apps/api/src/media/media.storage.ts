import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

/**
 * Where media bytes live. task.md § 0 wants S3-compatible object storage hosted
 * in Uzbekistan; no provider is chosen yet (note M3-c), so the first driver is
 * a local directory — in Docker, a named volume on the same in-country host.
 *
 * Keys are opaque (`image/<uuid>.png`), never user-supplied, so a driver never
 * has to sanitise a path someone typed.
 */
export interface MediaStorage {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
}

export const MEDIA_STORAGE = 'MEDIA_STORAGE';

export class LocalDiskStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const full = resolve(join(this.root, key));
    // Belt and braces: keys are generated, but a key must never escape the root.
    if (!full.startsWith(this.root + '/')) throw new Error(`media key escapes the store: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const tmp = `${target}.part`;
    await writeFile(tmp, body);
    await rename(tmp, target);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.path(key))).isFile();
    } catch {
      return false;
    }
  }
}
