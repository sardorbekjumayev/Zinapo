import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { Actor } from '../authz';
import { MediaService } from '../media/media.service';
import { SessionsService } from '../sessions/sessions.service';
import { MeasurementService } from '../measurement/measurement.service';

/** A real 1×1 PNG and a minimal MP3 frame — placeholders for grade 1 media. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 0)]);

const COHORT = 40;
const DAY = 86_400_000;

/**
 * The M5 development fixture: measured history, so the parent reports and the
 * calibration page have something real to show and `scripts/report-flows.sh`
 * something to test.
 *
 *   grade 4 — waves 1–3 closed (the open wave becomes 4, the upcoming one 5),
 *             Madina plus 40 synthetic "Kohort" children in Tashkent city, with
 *             answers drawn from a simple ability model; Madina improves.
 *   grade 1 — a 15-item picture + audio form over the five grade 1 skills,
 *             waves 1–3 closed and wave 4 open; Temur plus 10 synthetic children.
 *
 * Then the REAL wave job and measurement job run over it: nothing derived is
 * written here. Development only; idempotent (skipped once grade 4 has closed
 * waves). Synthetic people and children are named "Kohort …" so nobody mistakes
 * them for real families.
 */
@Injectable()
export class SeedResultsService {
  private readonly logger = new Logger(SeedResultsService.name);

  constructor(
    private readonly db: DbService,
    private readonly media: MediaService,
    private readonly sessions: SessionsService,
    private readonly measurement: MeasurementService,
  ) {}

  async run() {
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!season) return { skipped: 'no current season' };
    const closed = await this.db.one(
      `SELECT 1 FROM wave WHERE season_id = $1 AND grade = 4 AND (closed_at IS NOT NULL OR closes_at < now())`,
      [season.id],
    );
    if (closed) return { skipped: 'grade 4 already has closed waves' };

    const owner = await this.db.one<{ id: string }>(`SELECT id FROM person WHERE phone = '+998901110001'`);
    const form4 = await this.db.one<{ form_id: string }>(
      `SELECT form_id FROM wave WHERE season_id = $1 AND grade = 4 AND form_id IS NOT NULL ORDER BY ordinal LIMIT 1`,
      [season.id],
    );
    if (!owner || !form4) return { skipped: 'run /dev/seed and /dev/seed-bank first' };

    const now = Date.now();
    const result = await this.db.transaction(async (client) => {
      // ---- grade 4: renumber the open/upcoming waves to 4 and 5, add 1–3 closed.
      // 1 → 4 and 2 → 5 in one statement (ordinals stay within 1–8, no collision).
      await client.query(`UPDATE wave SET ordinal = ordinal + 3 WHERE season_id = $1 AND grade = 4`, [season.id]);
      const past4 = await this.pastWaves(client, season.id, 4, form4.form_id, now);

      const madina = await this.childId(client, 'Madina', 4);
      const kids4 = await this.cohort(client, 4, COHORT, 2016);
      const regionAll = 14;
      for (const [w, wave] of past4.entries()) {
        // Madina climbs: −0.2 → 0.5 → 1.1 logits.
        await this.takeWave(client, wave, madina, form4.form_id, [-0.2, 0.5, 1.1][w], regionAll, 'uz');
        for (const [i, kid] of kids4.entries()) {
          if ((i + w) % 13 === 0) continue; // a few skip each wave: "not taken", never a zero
          const ability = ((i * 37) % 21) / 10 - 1 + w * 0.15;
          await this.takeWave(client, wave, kid, form4.form_id, ability, regionAll, i % 3 === 0 ? 'ru' : 'uz');
        }
      }

      // ---- grade 1: a picture + audio form over the grade 1 skills.
      const form1 = await this.gradeOneForm(client, owner.id);
      const past1 = await this.pastWaves(client, season.id, 1, form1, now);
      await client.query(
        `INSERT INTO wave (season_id, grade, ordinal, opens_at, closes_at, form_id)
         VALUES ($1, 1, 4, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [season.id, new Date(now - 2 * DAY), new Date(now + 20 * DAY), form1],
      );
      const temur = await this.childId(client, 'Temur', 1);
      const kids1 = await this.cohort(client, 1, 10, 2020);
      for (const [w, wave] of past1.entries()) {
        await this.takeWave(client, wave, temur, form1, [-0.6, 0.4, 1.3][w], regionAll, 'uz');
        for (const [i, kid] of kids1.entries()) {
          await this.takeWave(client, wave, kid, form1, ((i * 29) % 15) / 10 - 0.7, regionAll, 'uz');
        }
      }
      return { grade4Waves: past4.length, grade1Waves: past1.length, cohort4: kids4.length + 1, cohort1: kids1.length + 1 };
    });

    // The real jobs: close the past waves, then measure them (one run per wave
    // in order, the last one current — exactly what production would do).
    await this.sessions.tick();
    let runs = 0;
    for (let i = 0; i < 6 && (await this.measurement.tick()).length > 0; i++) runs += 1;
    this.logger.log(`seed-results: ${JSON.stringify(result)}, measurement passes ${runs}`);
    return { ...result, measurementPasses: runs };
  }

  /** Waves 1–3 in the weeks before now, closing before the open wave 4 opens. */
  private async pastWaves(client: PoolClient, seasonId: string, grade: number, formId: string, now: number) {
    const windows = [
      [now - 35 * DAY, now - 28 * DAY],
      [now - 24 * DAY, now - 17 * DAY],
      [now - 14 * DAY, now - 7 * DAY],
    ];
    const ids: string[] = [];
    for (const [i, [o, c]] of windows.entries()) {
      const row = await client.query<{ id: string }>(
        `INSERT INTO wave (season_id, grade, ordinal, opens_at, closes_at, form_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [seasonId, grade, i + 1, new Date(o), new Date(c), formId],
      );
      ids.push(row.rows[0].id);
    }
    return ids;
  }

  private async childId(client: PoolClient, given: string, grade: number): Promise<string> {
    const r = await client.query<{ id: string }>(
      `SELECT c.id FROM child c JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL
        WHERE c.given_name = $1 AND e.grade = $2 LIMIT 1`,
      [given, grade],
    );
    return r.rows[0].id;
  }

  /** Synthetic families: one "Kohort" parent owning one child each, consent given. */
  private async cohort(client: PoolClient, grade: number, n: number, birthYear: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 1; i <= n; i++) {
      const phone = `+9989900${grade}${String(i).padStart(4, '0')}`;
      const p = await client.query<{ id: string }>(
        `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via)
         VALUES ($1, $2, 'uz', now(), 'manual')
         ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
        [`Kohort ota-ona ${grade}-${i}`, phone],
      );
      const c = await client.query<{ id: string }>(
        `INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, dob, created_by)
         VALUES (gen_random_bytes(32), '\\x00', 'KOHORT', $1, $2, $3) RETURNING id`,
        [`Bola ${grade}-${i}`, `${birthYear}-0${1 + (i % 9)}-1${i % 9}`, p.rows[0].id],
      );
      const childId = c.rows[0].id;
      await client.query(`INSERT INTO guardianship (child_id, person_id, role, granted_by) VALUES ($1, $2, 'owner', $2)`, [
        childId,
        p.rows[0].id,
      ]);
      await client.query(
        `INSERT INTO enrolment (child_id, school_year, grade, school_region_id) VALUES ($1, 2026, $2, 14)`,
        [childId, grade],
      );
      await client.query(
        `INSERT INTO consent (child_id, person_id, type, document_version) VALUES ($1, $2, 'data_processing', 'v1-2026-09')`,
        [childId, p.rows[0].id],
      );
      ids.push(childId);
    }
    return ids;
  }

  /**
   * One submitted session: each scored item answered correctly with
   * P = logistic(ability − b), b from the item's expected p; a wrong answer
   * picks the first distractor (so misconception patterns are real ones).
   */
  private async takeWave(
    client: PoolClient,
    waveId: string,
    childId: string,
    formId: string,
    ability: number,
    region: number,
    lang: 'uz' | 'ru',
  ): Promise<void> {
    const wave = await client.query<{ grade: number; opens_at: Date }>(`SELECT grade, opens_at FROM wave WHERE id = $1`, [waveId]);
    const launcher = await client.query<{ person_id: string }>(
      `SELECT person_id FROM guardianship WHERE child_id = $1 AND role = 'owner' AND revoked_at IS NULL`,
      [childId],
    );
    const at = new Date(wave.rows[0].opens_at.getTime() + 2 * DAY);
    const s = await client.query<{ id: string }>(
      `INSERT INTO session (child_id, mode, form_id, wave_id, launched_by, launch_context, grade_snapshot,
                            region_snapshot, status, started_at, submitted_at, deadline_at, test_language, device)
       VALUES ($1, 'monitoring', $2, $3, $4, 'home', $5, $6, 'submitted', $7, $8, $9, $10, 'seed')
       RETURNING id`,
      [childId, formId, waveId, launcher.rows[0].person_id, wave.rows[0].grade, region, at, new Date(at.getTime() + 40 * 60_000), new Date(at.getTime() + 90 * 60_000), lang],
    );
    const items = await client.query<{ item_version_id: string; expected_p: string | null; key: string; wrong: string | null }>(
      `SELECT fi.item_version_id, v.expected_p,
              (SELECT id FROM item_option o WHERE o.item_version_id = v.id AND o.is_key) AS key,
              (SELECT id FROM item_option o WHERE o.item_version_id = v.id AND NOT o.is_key ORDER BY o.position LIMIT 1) AS wrong
         FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id
        WHERE fi.form_id = $1 ORDER BY fi.position`,
      [formId],
    );
    // Deterministic per child and item, so a re-seed on a fresh database is reproducible.
    let seed = parseInt(childId.replace(/-/g, '').slice(0, 8), 16) ^ parseInt(waveId.replace(/-/g, '').slice(0, 8), 16);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 10000) / 10000;
    for (const it of items.rows) {
      const p = it.expected_p === null ? 0.5 : Number(it.expected_p);
      const b = Math.log((1 - Math.min(Math.max(p, 0.05), 0.95)) / Math.min(Math.max(p, 0.05), 0.95));
      const right = rnd() < 1 / (1 + Math.exp(-(ability - b)));
      const skip = rnd() < 0.04;
      const chosen = skip ? null : right ? it.key : it.wrong;
      await client.query(
        `INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, response_ms, client_recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s.rows[0].id, it.item_version_id, chosen, chosen === null ? null : chosen === it.key, 20_000 + Math.floor(rnd() * 60_000), at],
      );
    }
  }

  /** 15 approved grade 1 items (3 per skill), picture + audio, frozen, in a frozen form. */
  private async gradeOneForm(client: PoolClient, ownerId: string): Promise<string> {
    const author = await client.query<{ id: string }>(`SELECT id FROM person WHERE phone = '+998901110011'`);
    const actor: Actor = { personId: author.rows[0].id, staffRoles: ['item_author'], educatorStatus: null, ownerOf: 0, coGuardianOf: 0, lastWorkspace: null };
    const img = await this.media.upload(actor, 'image', { originalname: 'seed.png', mimetype: 'image/png', size: PNG.length, buffer: PNG });
    const aud = await this.media.upload(actor, 'audio', { originalname: 'seed.mp3', mimetype: 'audio/mpeg', size: MP3.length, buffer: MP3 });
    void ownerId;

    const skills = await client.query<{ code: string; topic_code: string; name_uz: string; name_ru: string }>(
      `SELECT code, topic_code, name_uz, name_ru FROM skill WHERE grade = 1 ORDER BY code`,
    );
    const form = await client.query<{ id: string }>(
      `INSERT INTO form (mode, season_id, grade, label, time_limit_sec, created_by, plan)
       VALUES ('monitoring', (SELECT id FROM season WHERE is_current), 1, '2026/27 · 1-sinf (seed)', 1800, $1, '[]'::jsonb)
       RETURNING id`,
      [author.rows[0].id],
    );
    const mis = await client.query<{ code: string; topic_code: string }>(`SELECT code, topic_code FROM misconception`);
    let position = 0;
    const plan: { position: number; role: string }[] = [];
    for (const sk of skills.rows) {
      for (let k = 0; k < 3; k++) {
        position += 1;
        const item = await client.query<{ id: string }>(
          `INSERT INTO item (author_person_id, topic_code, skill_code, grade, construct, status, accepted_at)
           VALUES ($1, $2, $3, 1, $4, 'approved', now()) RETURNING id`,
          [author.rows[0].id, sk.topic_code, sk.code, `[seed] ${sk.code} (${k + 1})`],
        );
        const v = await client.query<{ id: string }>(
          `INSERT INTO item_version (item_id, version, stem_format, stem_uz, stem_ru, image_ref, audio_ref_uz, audio_ref_ru,
                                     expected_p, created_by, submitted_at)
           VALUES ($1, 1, 'image_audio', $2, $3, $4, $5, $5, $6, $7, now()) RETURNING id`,
          [item.rows[0].id, `${sk.name_uz} (${k + 1})`, `${sk.name_ru} (${k + 1})`, img.ref, aud.ref, [0.75, 0.55, 0.4][k], author.rows[0].id],
        );
        const m = mis.rows.find((x) => x.topic_code === sk.topic_code) ?? mis.rows[0];
        for (let o = 1; o <= 3; o++) {
          await client.query(
            `INSERT INTO item_option (item_version_id, position, label_uz, label_ru, is_key, misconception_code, rationale)
             VALUES ($1, $2, $3, $3, $4, $5, $6)`,
            [v.rows[0].id, o, String(o * 3 + k), o === 1, o === 1 ? null : m.code, o === 1 ? null : 'Seed distractor.'],
          );
        }
        await client.query(`UPDATE item_version SET frozen_at = now() WHERE id = $1`, [v.rows[0].id]);
        await client.query(
          `INSERT INTO form_item (form_id, position, item_version_id, slot_role, is_scored) VALUES ($1, $2, $3, 'scored', true)`,
          [form.rows[0].id, position, v.rows[0].id],
        );
        plan.push({ position, role: 'scored' });
      }
    }
    // A development fixture: grade 1 forms have no anchors yet, so the M3 rule
    // checks would (rightly) refuse it — it is frozen directly.
    await client.query(`UPDATE form SET plan = $2::jsonb, frozen_at = now() WHERE id = $1`, [form.rows[0].id, JSON.stringify(plan)]);
    return form.rows[0].id;
  }
}
