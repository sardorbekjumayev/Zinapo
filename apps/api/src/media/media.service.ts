import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { hexEquals } from '../common/crypto.util';
import { Actor } from '../authz';
import { MediaInvalidException } from '../bank/bank.errors';
import { MEDIA_STORAGE, MediaStorage } from './media.storage';

export type MediaKind = 'image' | 'audio';

/** design/12: "PNG or SVG, up to 2 MB"; "MP3 up to 30 s" — 3 MB covers 30 s at any sane bitrate. */
const RULES: Record<MediaKind, { types: Record<string, string>; maxBytes: number }> = {
  image: { types: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }, maxBytes: 2 * 1024 * 1024 },
  audio: { types: { 'audio/mpeg': 'mp3' }, maxBytes: 3 * 1024 * 1024 },
};

/** Signed links live long enough to load a form and its media, not to be shared around. */
const URL_TTL_SEC = 2 * 60 * 60;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface MediaView {
  ref: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  url: string;
}

/**
 * Item images and read-aloud audio (task.md § 8.5: grades 0–1 need visual +
 * audio). Uploads are checked by their bytes, not by the name or the browser's
 * claim, and every file is registered in `media_object`.
 *
 * Reads go through short-lived signed URLs (§ 6.1, "signed media URLs"), so
 * the same mechanism serves the staff editor now and kid mode in M4.
 */
@Injectable()
export class MediaService {
  private readonly signKey: Buffer;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(CONFIG) config: AppConfig,
  ) {
    // A key of its own, derived so that a leaked media link says nothing about
    // session tokens signed with the parent secret.
    this.signKey = createHmac('sha256', config.jwtAccessSecret).update('zinapo:media-url').digest();
  }

  async upload(actor: Actor, kind: MediaKind, file: UploadedFile | undefined): Promise<MediaView> {
    if (!file || !file.buffer?.length) throw new MediaInvalidException('empty');
    const rule = RULES[kind];
    if (!rule) throw new MediaInvalidException('kind');
    if (file.size > rule.maxBytes) throw new MediaInvalidException('size');

    const mime = sniff(file.buffer);
    const ext = mime ? rule.types[mime] : undefined;
    if (!mime || !ext) throw new MediaInvalidException('type');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = `${kind}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer);

    await this.db.query(
      `INSERT INTO media_object (storage_key, kind, mime, bytes, sha256, original_name, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [key, kind, mime, file.buffer.length, sha256, file.originalname?.slice(0, 200) || null, actor.personId],
    );
    await this.audit.write({
      action: 'media.uploaded',
      personId: actor.personId,
      payload: { ref: key, kind, bytes: file.buffer.length },
    });
    return { ref: key, kind, mime, bytes: file.buffer.length, url: this.signedUrl(key) };
  }

  /** `/api/media/image/<uuid>.png?exp=…&sig=…` */
  signedUrl(ref: string, ttlSec = URL_TTL_SEC): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    return `/api/media/${ref}?exp=${exp}&sig=${this.sign(ref, exp)}`;
  }

  /** Null for a forged, expired or unknown link — the controller answers 404 for all three. */
  async read(ref: string, exp: string, sig: string): Promise<{ body: Buffer; mime: string } | null> {
    const expNum = Number(exp);
    if (!Number.isInteger(expNum) || expNum < Date.now() / 1000) return null;
    if (!/^[0-9a-f]{64}$/.test(sig) || !hexEquals(sig, this.sign(ref, expNum))) return null;

    const row = await this.db.one<{ mime: string }>(`SELECT mime FROM media_object WHERE storage_key = $1`, [ref]);
    if (!row) return null;
    const body = await this.storage.get(ref);
    return body ? { body, mime: row.mime } : null;
  }

  /** Whether `ref` is a registered file of this kind — item versions may only point at those. */
  async isKnown(ref: string, kind: MediaKind): Promise<boolean> {
    const row = await this.db.one(`SELECT 1 FROM media_object WHERE storage_key = $1 AND kind = $2`, [ref, kind]);
    return !!row;
  }

  private sign(ref: string, exp: number): string {
    return createHmac('sha256', this.signKey).update(`${ref}\n${exp}`).digest('hex');
  }
}

/** The real type, from the first bytes. Anything unrecognised is refused. */
function sniff(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 3 && buf.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if ((head.startsWith('<?xml') || head.startsWith('<svg')) && head.includes('<svg')) return 'image/svg+xml';
  return null;
}
