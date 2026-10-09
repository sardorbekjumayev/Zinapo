import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { MediaService } from '../media/media.service';
import { Actor } from '../authz';
import { UUID } from './olympiad.common';

export interface SyncedAnswer {
  itemVersionId: string;
  chosenOptionId: string | null;
  clientRecordedAt: string;
  responseMs?: number | null;
  revisionCount?: number;
  flagged?: boolean;
}

export interface SyncedSession {
  sessionId: string;
  startedAt: string;
  submittedAt: string;
  answers: SyncedAnswer[];
  device?: string;
}

/**
 * § 8.5 "Proctor": a venue roster, check-in with the accompanying-adult check,
 * and the offline runner (decided with the product owner, M7-a: a browser
 * runner that caches a package and syncs later).
 *
 * Access: the `final.proctor` permission AND an assignment to THIS venue — any
 * other venue is a 404. The DB already keeps a proctor away from a venue where
 * their own child competes (§ 2.1, both directions).
 *
 * The package carries the forms WITHOUT keys (exactly what kid mode gets, plus
 * media inline); correctness is computed on the server at sync, so a copied
 * package reveals no answers.
 */
@Injectable()
export class FinalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async myVenues(actor: Actor) {
    return this.db.query(
      `SELECT v.id, v.name, v.address, v.starts_at AS "startsAt", v.capacity, o.title_uz AS "olympiadUz",
              o.title_ru AS "olympiadRu", st.kind::text AS "stageKind", r.name_uz AS "regionUz", r.name_ru AS "regionRu",
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL) AS seated,
              (SELECT count(*)::int FROM olympiad_entry e WHERE e.venue_id = v.id AND e.cancelled_at IS NULL AND e.checked_in_at IS NOT NULL) AS "checkedIn",
              (SELECT count(*)::int FROM olympiad_entry e JOIN session s ON s.olympiad_entry_id = e.id AND s.status = 'submitted'
                WHERE e.venue_id = v.id AND e.cancelled_at IS NULL) AS submitted
         FROM proctor_assignment pa
         JOIN olympiad_venue v ON v.id = pa.venue_id
         JOIN olympiad o ON o.id = v.olympiad_id
    LEFT JOIN olympiad_stage st ON st.id = v.stage_id
    LEFT JOIN region r ON r.id = v.region_id
        WHERE pa.person_id = $1
        ORDER BY v.starts_at`,
      [actor.personId],
    );
  }

  /**
   * The roster: each child, the adult expected at the door (the profile
   * owner — design/07 "ID is checked against the profile at the entrance"),
   * check-in and session state. Names only; no PINFL, no phone.
   */
  async roster(actor: Actor, venueId: string) {
    const venue = await this.venue(actor, venueId);
    const children = await this.db.query(
      `SELECT e.id AS "entryId", c.given_name || ' ' || initcap(c.family_name) AS name, e.grade,
              (SELECT p.full_name FROM guardianship g JOIN person p ON p.id = g.person_id
                WHERE g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL LIMIT 1) AS "ownerName",
              e.checked_in_at AS "checkedInAt", e.accompanying_adult_matches_owner AS "adultMatchesOwner",
              s.id AS "sessionId", s.status::text AS "sessionStatus", s.sync_source::text AS "syncSource",
              EXISTS (SELECT 1 FROM olympiad_stage_form sf WHERE sf.stage_id = e.stage_id AND sf.grade = e.grade) AS "formReady"
         FROM olympiad_entry e
         JOIN child c ON c.id = e.child_id
    LEFT JOIN LATERAL (SELECT id, status, sync_source FROM session WHERE olympiad_entry_id = e.id AND status <> 'voided'
                        ORDER BY started_at DESC LIMIT 1) s ON true
        WHERE e.venue_id = $1 AND e.cancelled_at IS NULL
        ORDER BY c.family_name, c.given_name`,
      [venueId],
    );
    return { venue, children };
  }

  /**
   * Check a child in and record whether the accompanying adult is the profile
   * owner. Not a refusal when it is someone else — the child still sits the
   * final; the record is for trust & safety. Calling again corrects it.
   */
  async checkIn(actor: Actor, venueId: string, entryId: string, adultMatchesOwner: boolean) {
    await this.venue(actor, venueId);
    if (!UUID.test(entryId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const row = await this.db.one(
      `UPDATE olympiad_entry SET checked_in_at = COALESCE(checked_in_at, now()), accompanying_adult_matches_owner = $3
        WHERE id = $1 AND venue_id = $2 AND cancelled_at IS NULL RETURNING id`,
      [entryId, venueId, adultMatchesOwner],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.audit.write({ action: 'olympiad.checked_in', personId: actor.personId, payload: { venueId, entryId, adultMatchesOwner } });
    return { ok: true };
  }

  async undoCheckIn(actor: Actor, venueId: string, entryId: string) {
    await this.venue(actor, venueId);
    if (!UUID.test(entryId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const started = await this.db.one(`SELECT 1 FROM session WHERE olympiad_entry_id = $1`, [entryId]);
    if (started) throw new ConflictException({ error: 'ALREADY_STARTED' });
    await this.db.query(
      `UPDATE olympiad_entry SET checked_in_at = NULL, accompanying_adult_matches_owner = NULL WHERE id = $1 AND venue_id = $2`,
      [entryId, venueId],
    );
    return { ok: true };
  }

  /**
   * The offline package: one session per checked-in child (created now,
   * `launch_context = 'proctored_final'`), and each form once, with media
   * inline. Asking again returns the same sessions — a re-download after a
   * crash does not start anyone over.
   */
  async package(actor: Actor, venueId: string) {
    const venue = await this.venue(actor, venueId);
    const entries = await this.db.query<{ entry_id: string; child_id: string; name: string; grade: number; form_id: string | null }>(
      `SELECT e.id AS entry_id, e.child_id, c.given_name || ' ' || left(c.family_name, 1) || '.' AS name, e.grade, sf.form_id
         FROM olympiad_entry e
         JOIN child c ON c.id = e.child_id
    LEFT JOIN olympiad_stage_form sf ON sf.stage_id = e.stage_id AND sf.grade = e.grade
        WHERE e.venue_id = $1 AND e.cancelled_at IS NULL AND e.checked_in_at IS NOT NULL
        ORDER BY c.family_name, c.given_name`,
      [venueId],
    );
    const missing = entries.filter((e) => !e.form_id);
    if (missing.length) throw new ConflictException({ error: 'STAGE_NOT_READY', details: { grades: [...new Set(missing.map((m) => m.grade))] } });

    const sessions = [];
    for (const e of entries) {
      const s = await this.ensureSession(actor, e.entry_id, e.child_id, e.form_id!);
      sessions.push({ sessionId: s.id, status: s.status, entryId: e.entry_id, childName: e.name, grade: e.grade, formId: e.form_id });
    }
    const forms: Record<string, unknown> = {};
    for (const formId of new Set(entries.map((e) => e.form_id!))) forms[formId] = await this.form(formId);

    await this.audit.write({ action: 'olympiad.package_issued', personId: actor.personId, payload: { venueId, sessions: sessions.length } });
    return { venue, generatedAt: new Date().toISOString(), sessions, forms };
  }

  /**
   * The runner's upload. Idempotent: a session already submitted is skipped,
   * so the same file can be uploaded twice (§ 11 "make ingest idempotent").
   * Answers are checked against the form; correctness is derived here.
   */
  async sync(actor: Actor, venueId: string, sessions: SyncedSession[]) {
    await this.venue(actor, venueId);
    let synced = 0;
    let already = 0;
    const rejected: { sessionId: string; reason: string }[] = [];
    for (const s of sessions) {
      if (!UUID.test(s.sessionId)) {
        rejected.push({ sessionId: s.sessionId, reason: 'unknown' });
        continue;
      }
      const row = await this.db.one<{ id: string; status: string; form_id: string }>(
        `SELECT s.id, s.status::text, s.form_id FROM session s JOIN olympiad_entry e ON e.id = s.olympiad_entry_id
          WHERE s.id = $1 AND e.venue_id = $2 AND s.mode = 'olympiad'`,
        [s.sessionId, venueId],
      );
      if (!row) {
        rejected.push({ sessionId: s.sessionId, reason: 'unknown' });
        continue;
      }
      if (row.status === 'submitted') {
        already += 1;
        continue;
      }
      if (row.status !== 'started') {
        rejected.push({ sessionId: s.sessionId, reason: row.status });
        continue;
      }
      const ok = await this.db.transaction(async (client) => {
        const valid = await client.query<{ item_version_id: string; options: { id: string; key: boolean }[] }>(
          `SELECT fi.item_version_id, json_agg(json_build_object('id', o.id, 'key', o.is_key)) AS options
             FROM form_item fi JOIN item_option o ON o.item_version_id = fi.item_version_id
            WHERE fi.form_id = $1 GROUP BY fi.item_version_id`,
          [row.form_id],
        );
        const items = new Map(valid.rows.map((v) => [v.item_version_id, new Map(v.options.map((o) => [o.id, o.key]))]));
        const given = new Map(s.answers.map((a) => [a.itemVersionId, a]));
        for (const a of s.answers) {
          const opts = items.get(a.itemVersionId);
          if (!opts || (a.chosenOptionId && !opts.has(a.chosenOptionId))) return false;
        }
        // One response per form item — an item the child never reached is a skip (NULL).
        for (const [iv, opts] of items) {
          const a = given.get(iv);
          const chosen = a?.chosenOptionId ?? null;
          await client.query(
            `INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, response_ms, revision_count, flagged, client_recorded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (session_id, item_version_id) DO NOTHING`,
            [
              s.sessionId,
              iv,
              chosen,
              chosen === null ? null : opts.get(chosen) === true,
              a?.responseMs == null ? null : Math.min(Math.max(Math.round(a.responseMs), 0), 3600000),
              a?.revisionCount ?? 0,
              !!a?.flagged,
              a?.clientRecordedAt ?? s.submittedAt,
            ],
          );
        }
        await client.query(
          `UPDATE session SET status = 'submitted', started_at = $2, submitted_at = $3, sync_source = 'offline_sync',
                  device = COALESCE($4, device)
            WHERE id = $1 AND status = 'started'`,
          [s.sessionId, s.startedAt, s.submittedAt, s.device?.slice(0, 120) ?? 'offline runner'],
        );
        return true;
      });
      if (ok) synced += 1;
      else rejected.push({ sessionId: s.sessionId, reason: 'answers' });
    }
    await this.audit.write({ action: 'olympiad.synced', personId: actor.personId, payload: { venueId, synced, already, rejected: rejected.length } });
    return { synced, already, rejected };
  }

  // ============================================================= helpers

  private async venue(actor: Actor, venueId: string) {
    if (!UUID.test(venueId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const v = await this.db.one(
      `SELECT v.id, v.name, v.address, v.starts_at AS "startsAt", v.capacity, o.title_uz AS "olympiadUz",
              o.title_ru AS "olympiadRu", st.kind::text AS "stageKind"
         FROM olympiad_venue v
         JOIN olympiad o ON o.id = v.olympiad_id
         JOIN proctor_assignment pa ON pa.venue_id = v.id AND pa.person_id = $2
    LEFT JOIN olympiad_stage st ON st.id = v.stage_id
        WHERE v.id = $1`,
      [venueId, actor.personId],
    );
    if (!v) throw new NotFoundException({ error: 'NOT_FOUND' });
    return v;
  }

  private async ensureSession(actor: Actor, entryId: string, childId: string, formId: string) {
    const existing = await this.db.one<{ id: string; status: string }>(
      `SELECT id, status::text FROM session WHERE olympiad_entry_id = $1 AND status <> 'voided'`,
      [entryId],
    );
    if (existing) return existing;
    const enr = await this.db.one<{ grade: number; region_id: number; school_id: string | null }>(
      `SELECT grade, school_region_id AS region_id, school_id FROM enrolment
        WHERE child_id = $1 AND ended_at IS NULL ORDER BY school_year DESC, started_at DESC LIMIT 1`,
      [childId],
    );
    if (!enr) throw new BadRequestException({ error: 'NO_ENROLMENT' });
    const row = await this.db.one<{ id: string; status: string }>(
      `INSERT INTO session (child_id, mode, form_id, olympiad_entry_id, launched_by, launch_context,
                            grade_snapshot, region_snapshot, school_snapshot)
       VALUES ($1, 'olympiad', $2, $3, $4, 'proctored_final', $5, $6, $7)
       RETURNING id, status::text`,
      [childId, formId, entryId, actor.personId, enr.grade, enr.region_id, enr.school_id],
    );
    return row!;
  }

  /** A form as kid mode sees it — no keys, no slot roles — with media inline. */
  private async form(formId: string) {
    const meta = await this.db.one<{ time_limit_sec: number | null; grade: number }>(`SELECT time_limit_sec, grade FROM form WHERE id = $1`, [formId]);
    const items = await this.db.query<{
      position: number;
      item_version_id: string;
      stem_format: string;
      stem_uz: string;
      stem_ru: string;
      image_ref: string | null;
      audio_ref_uz: string | null;
      audio_ref_ru: string | null;
    }>(
      `SELECT fi.position, v.id AS item_version_id, v.stem_format, v.stem_uz, v.stem_ru, v.image_ref, v.audio_ref_uz, v.audio_ref_ru
         FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id WHERE fi.form_id = $1 ORDER BY fi.position`,
      [formId],
    );
    const options = await this.db.query<{ id: string; item_version_id: string; position: number; label_uz: string; label_ru: string; image_ref: string | null }>(
      `SELECT o.id, o.item_version_id, o.position, o.label_uz, o.label_ru, o.image_ref
         FROM item_option o JOIN form_item fi ON fi.item_version_id = o.item_version_id
        WHERE fi.form_id = $1 ORDER BY o.position`,
      [formId],
    );
    const inline = async (ref: string | null) => (ref ? this.media.dataUri(ref) : null);
    const out = [];
    for (const it of items) {
      const opts = [];
      for (const o of options.filter((x) => x.item_version_id === it.item_version_id)) {
        opts.push({ id: o.id, position: o.position, labelUz: o.label_uz, labelRu: o.label_ru, imageUrl: await inline(o.image_ref) });
      }
      out.push({
        position: it.position,
        itemVersionId: it.item_version_id,
        stemFormat: it.stem_format,
        stemUz: it.stem_uz,
        stemRu: it.stem_ru,
        imageUrl: await inline(it.image_ref),
        audioUrlUz: await inline(it.audio_ref_uz),
        audioUrlRu: await inline(it.audio_ref_ru),
        options: opts,
      });
    }
    return { formId, grade: meta?.grade, timeLimitSec: meta?.time_limit_sec ?? null, items: out };
  }
}
