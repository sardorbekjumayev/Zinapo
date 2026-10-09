import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor, ChildPolicy } from '../authz';
import { MediaService } from '../media/media.service';
import { NotifyService } from '../notify/notify.service';
import { AnswerDto } from './sessions.dto';

/** How long after its deadline a device may still deliver answers recorded in time. */
const LATE_GRACE_MS = 10 * 60_000;
/** The wave job's period. */
const TICK_MS = 60_000;

type LaunchContext = 'home' | 'educator_office';

interface SessionRow {
  id: string;
  child_id: string;
  mode: 'monitoring' | 'practice' | 'olympiad';
  form_id: string;
  wave_id: string | null;
  launched_by: string;
  status: 'started' | 'submitted' | 'expired' | 'voided';
  started_at: Date;
  submitted_at: Date | null;
  deadline_at: Date | null;
  grade_snapshot: number;
}

/**
 * task.md § 6 (`sessions`), § 8.3 (kid mode), § 12 M4.
 *
 *   start ──▶ started ──submit──▶ submitted
 *                │ deadline passed (+grace)  ──▶ submitted (auto, with the saved answers)
 *                └ wave closed, still open   ──▶ expired
 *
 * In flight, answers live in `session_answer` (mutable; note M4-a). Submitting
 * writes ONE `response` per form item — the final answer, or NULL for a skipped
 * one — inside one transaction, `ON CONFLICT DO NOTHING`, so a device retrying
 * its submit can never double-write (INV-07, idempotent ingest).
 *
 * Must never: compute or store a score. `is_correct` per response is the raw
 * fact the key gives today and must stay interpretable forever (schema note);
 * any score is the measurement job's business (M5).
 */
@Injectable()
export class SessionsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SessionsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly children: ChildPolicy,
    private readonly media: MediaService,
    private readonly notify: NotifyService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ============================================================ family view

  /**
   * The child's waves this season, as a parent sees them (§ 8.1.4): open /
   * upcoming / taken / missed, and the session to resume if one is running.
   */
  async wavesFor(childId: string) {
    const child = await this.currentEnrolment(childId);
    if (!child) return { grade: null, consent: false, waves: [] };
    const waves = await this.db.query(
      `SELECT w.id, w.ordinal, w.grade, w.opens_at AS "opensAt", w.closes_at AS "closesAt",
              (w.form_id IS NOT NULL) AS ready,
              f.time_limit_sec AS "timeLimitSec",
              (SELECT count(*)::int FROM form_item fi WHERE fi.form_id = w.form_id) AS questions,
              s.id AS "sessionId", s.status AS "sessionStatus", s.submitted_at AS "submittedAt",
              s.deadline_at AS "deadlineAt",
              CASE
                WHEN s.status = 'submitted' THEN 'taken'
                WHEN s.status = 'started' AND w.closed_at IS NULL AND w.closes_at > now() THEN 'in_progress'
                WHEN w.closed_at IS NOT NULL OR w.closes_at <= now() THEN 'missed'
                WHEN w.opens_at <= now() THEN 'open'
                ELSE 'upcoming'
              END AS state
         FROM wave w
         JOIN season se ON se.id = w.season_id AND se.is_current
    LEFT JOIN form f ON f.id = w.form_id
    LEFT JOIN LATERAL (SELECT * FROM session s WHERE s.wave_id = w.id AND s.child_id = $1
                        AND s.status <> 'voided' ORDER BY s.started_at DESC LIMIT 1) s ON true
        WHERE w.grade = $2
        ORDER BY w.ordinal`,
      [childId, child.grade],
    );
    return { grade: child.grade, consent: child.consent, waves };
  }

  // ================================================================ start

  /**
   * Start (or resume) a monitoring session (§ 12 M4: "checks (wave open, child
   * grade, link if educator), snapshots of grade, region and school").
   *
   * The caller has already been authorised for the child by
   * `@ChildAccess('launch_session')` — a guardian at home, or an educator with
   * an ACTIVE link in the office (INV-15). The one-session-per-wave index makes
   * a second start a resume, not a second attempt.
   */
  async start(actor: Actor, childId: string, waveId: string, context: LaunchContext) {
    const wave = await this.db.one<{
      id: string;
      grade: number;
      form_id: string | null;
      open: boolean;
      closes_at: Date;
      time_limit_sec: number | null;
    }>(
      `SELECT w.id, w.grade, w.form_id, w.closes_at,
              (w.opens_at <= now() AND w.closes_at > now() AND w.closed_at IS NULL) AS open,
              f.time_limit_sec
         FROM wave w LEFT JOIN form f ON f.id = w.form_id
        WHERE w.id = $1`,
      [waveId],
    );
    if (!wave) throw new NotFoundException({ error: 'WAVE_NOT_FOUND' });

    // Note M2-e: without a live data-processing consent, measurement stops —
    // for a new session and for resuming one alike.
    const child = await this.currentEnrolment(childId);
    if (!child) throw new ConflictException({ error: 'NO_ENROLMENT' });
    if (!child.consent) throw new ConflictException({ error: 'CONSENT_REQUIRED' });

    const existing = await this.db.one<{ id: string; status: string }>(
      `SELECT id, status FROM session WHERE child_id = $1 AND wave_id = $2 AND status <> 'voided'`,
      [childId, waveId],
    );
    if (existing?.status === 'started' && wave.open) {
      await this.audit.write({ action: 'session.resumed', personId: actor.personId, payload: { sessionId: existing.id, childId } });
      return { sessionId: existing.id, resumed: true };
    }
    if (existing?.status === 'submitted') throw new ConflictException({ error: 'WAVE_TAKEN' });
    if (!wave.open) throw new ConflictException({ error: 'WAVE_NOT_OPEN' });
    if (!wave.form_id) throw new ConflictException({ error: 'WAVE_NOT_READY' });

    if (child.grade !== wave.grade) throw new ConflictException({ error: 'WRONG_GRADE', details: { childGrade: child.grade, waveGrade: wave.grade } });

    try {
      const row = await this.db.one<{ id: string }>(
        // No deadline yet: design/05 — "the clock starts when you press Start".
        // The parent opens the session; the child's Start calls `begin`.
        `INSERT INTO session (child_id, mode, form_id, wave_id, launched_by, launch_context,
                              grade_snapshot, region_snapshot, school_snapshot)
         VALUES ($1, 'monitoring', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [childId, wave.form_id, waveId, actor.personId, context, child.grade, child.region_id, child.school_id],
      );
      await this.audit.write({
        action: 'session.started',
        personId: actor.personId,
        payload: { sessionId: row!.id, childId, waveId, context },
      });
      return { sessionId: row!.id, resumed: false };
    } catch (err) {
      // Two devices pressing Start at once: the unique index picks one.
      if ((err as { code?: string }).code === '23505') {
        const again = await this.db.one<{ id: string }>(
          `SELECT id FROM session WHERE child_id = $1 AND wave_id = $2 AND status = 'started'`,
          [childId, waveId],
        );
        if (again) return { sessionId: again.id, resumed: true };
      }
      throw err;
    }
  }

  /**
   * The child pressed Start (design/05: "the clock starts when you press
   * Start"). Sets the deadline once — the form's time limit from now, or the
   * wave's close if sooner — and returns it; calling again returns the same
   * deadline, so a device that retries after a dropped reply cannot extend it.
   */
  async begin(actor: Actor, sessionId: string, language?: 'uz' | 'ru') {
    const s = await this.authorised(actor, sessionId);
    if (s.status !== 'started') throw new ConflictException({ error: 'SESSION_CLOSED', details: { status: s.status } });
    const row = await this.db.one<{ deadline_at: Date | null }>(
      `UPDATE session s
          SET deadline_at = COALESCE(s.deadline_at, LEAST(
                w.closes_at,
                CASE WHEN f.time_limit_sec IS NULL THEN w.closes_at
                     ELSE now() + make_interval(secs => f.time_limit_sec) END)),
              test_language = COALESCE(s.test_language, $2)
         FROM form f, wave w
        WHERE s.id = $1 AND f.id = s.form_id AND w.id = s.wave_id
        RETURNING s.deadline_at`,
      [sessionId, language ?? null],
    );
    return { deadlineAt: row?.deadline_at ?? null, serverTime: new Date().toISOString() };
  }

  // ================================================================ bundle

  /**
   * The whole form, downloaded before the start so kid mode works offline
   * (§ 7.1, § 11). For monitoring: NO keys, no slot roles (an anchor must not
   * be identifiable — INV-08's reason), no expected p. Media come as signed
   * URLs that last until the session's deadline.
   */
  async bundle(actor: Actor, sessionId: string) {
    const s = await this.authorised(actor, sessionId);
    const ttl = Math.max(15 * 60, Math.ceil(((s.deadline_at?.getTime() ?? Date.now()) - Date.now()) / 1000) + 3600);

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
      `SELECT fi.position, v.id AS item_version_id, v.stem_format, v.stem_uz, v.stem_ru,
              v.image_ref, v.audio_ref_uz, v.audio_ref_ru
         FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id
        WHERE fi.form_id = $1 ORDER BY fi.position`,
      [s.form_id],
    );
    const options = await this.db.query<{
      id: string;
      item_version_id: string;
      position: number;
      label_uz: string;
      label_ru: string;
      image_ref: string | null;
    }>(
      `SELECT o.id, o.item_version_id, o.position, o.label_uz, o.label_ru, o.image_ref
         FROM item_option o JOIN form_item fi ON fi.item_version_id = o.item_version_id
        WHERE fi.form_id = $1 ORDER BY o.position`,
      [s.form_id],
    );
    const meta = await this.db.one<{
      given_name: string;
      ordinal: number | null;
      closes_at: Date | null;
      time_limit_sec: number | null;
    }>(
      `SELECT c.given_name, w.ordinal, w.closes_at, f.time_limit_sec
         FROM session s JOIN child c ON c.id = s.child_id JOIN form f ON f.id = s.form_id
    LEFT JOIN wave w ON w.id = s.wave_id
        WHERE s.id = $1`,
      [sessionId],
    );
    const saved = await this.db.query(
      `SELECT item_version_id AS "itemVersionId", chosen_option_id AS "chosenOptionId", flagged,
              revision_count AS "revisionCount", response_ms AS "responseMs",
              client_recorded_at AS "clientRecordedAt"
         FROM session_answer WHERE session_id = $1`,
      [sessionId],
    );

    const url = (ref: string | null) => (ref ? this.media.signedUrl(ref, ttl) : null);
    return {
      sessionId,
      mode: s.mode,
      status: s.status,
      childName: meta?.given_name ?? '',
      grade: s.grade_snapshot,
      waveOrdinal: meta?.ordinal ?? null,
      waveClosesAt: meta?.closes_at ?? null,
      timeLimitSec: meta?.time_limit_sec ?? null,
      startedAt: s.started_at,
      deadlineAt: s.deadline_at,
      serverTime: new Date().toISOString(),
      items: items.map((it) => ({
        position: it.position,
        itemVersionId: it.item_version_id,
        stemFormat: it.stem_format,
        stemUz: it.stem_uz,
        stemRu: it.stem_ru,
        imageUrl: url(it.image_ref),
        audioUrlUz: url(it.audio_ref_uz),
        audioUrlRu: url(it.audio_ref_ru),
        options: options
          .filter((o) => o.item_version_id === it.item_version_id)
          .map((o) => ({ id: o.id, position: o.position, labelUz: o.label_uz, labelRu: o.label_ru, imageUrl: url(o.image_ref) })),
      })),
      // Resume: what this or another device already sent.
      answers: saved,
    };
  }

  // ============================================================== answers

  /**
   * The device's buffer, replayed as often as it likes (§ 11: "buffer answers
   * locally and sync through a retrying queue; make ingest idempotent"). Each
   * answer overwrites the working set only if it is NEWER than what is there,
   * so an old batch arriving late never undoes a later change.
   */
  async saveAnswers(actor: Actor, sessionId: string, answers: AnswerDto[], device?: DeviceInfo) {
    const s = await this.authorised(actor, sessionId);
    if (s.status !== 'started') {
      // Not an error for a retrying device: its answers are already final.
      return { saved: 0, status: s.status, serverTime: new Date().toISOString() };
    }
    const saved = await this.db.transaction(async (client) => {
      await this.touchDevice(client, sessionId, device);
      return this.upsertAnswers(client, s, answers);
    });
    return { saved, status: s.status, serverTime: new Date().toISOString() };
  }

  /**
   * Submit: the last batch, then one `response` per form item, then the status.
   * Idempotent — a device that never heard the first 200 submits again and
   * gets the same answer back.
   */
  async submit(actor: Actor, sessionId: string, answers: AnswerDto[], device?: DeviceInfo & { offline?: boolean }) {
    const s = await this.authorised(actor, sessionId);
    if (s.status === 'submitted') return this.result(actor, sessionId);
    if (s.status !== 'started') throw new ConflictException({ error: 'SESSION_EXPIRED' });
    // M2-e: consent withdrawn mid-test — nothing reaches the raw layer. The
    // session stays open (consent may come back) and expires with the wave.
    if (!(await this.hasConsent(s.child_id))) throw new ConflictException({ error: 'CONSENT_REQUIRED' });

    await this.db.transaction(async (client) => {
      await this.touchDevice(client, sessionId, device);
      await this.upsertAnswers(client, s, answers);
      await this.finalise(client, s, device?.offline ? 'offline_sync' : 'online');
    });
    await this.audit.write({
      action: 'session.submitted',
      personId: actor.personId,
      payload: { sessionId, childId: s.child_id, waveId: s.wave_id, auto: false },
    });
    return this.result(actor, sessionId);
  }

  /**
   * § 6.1: practice → how many were solved (and a review, the form has no
   * anchors); monitoring → just "submitted". Never a score, never a percentile.
   */
  async result(actor: Actor, sessionId: string) {
    const s = await this.authorised(actor, sessionId);
    if (s.mode !== 'practice' || s.status !== 'submitted') {
      return { sessionId, mode: s.mode, status: s.status, submittedAt: s.submitted_at };
    }
    const counts = await this.db.one<{ solved: number; total: number }>(
      `SELECT count(*) FILTER (WHERE r.is_correct)::int AS solved, count(*)::int AS total
         FROM response r WHERE r.session_id = $1`,
      [sessionId],
    );
    return { sessionId, mode: s.mode, status: s.status, submittedAt: s.submitted_at, solved: counts?.solved ?? 0, total: counts?.total ?? 0 };
  }

  // ================================================================== jobs

  /**
   * Every minute:
   *   1. sessions whose deadline passed (+ grace) are submitted with whatever
   *      the device had saved — the time is up, the answers count;
   *   2. waves whose window closed: sessions still open are EXPIRED (§ 12 M4)
   *      and the wave is marked closed — M5's measurement run follows;
   *   3. waves that just opened: `wave_open` to each eligible child's owner,
   *      once (throttle key per wave and child).
   */
  async tick(): Promise<{ autoSubmitted: number; expired: number; closed: number; announced: number }> {
    const out = { autoSubmitted: 0, expired: 0, closed: 0, announced: 0 };
    if (this.running) return out;
    this.running = true;
    try {
      const due = await this.db.query<SessionRow>(
        `SELECT s.* FROM session s
          WHERE s.status = 'started' AND s.deadline_at < now() - make_interval(secs => $1)
            -- M2-e: no live consent, no auto-submit; the session expires with the wave.
            AND EXISTS (SELECT 1 FROM consent k WHERE k.child_id = s.child_id
                         AND k.type = 'data_processing' AND k.revoked_at IS NULL)
          LIMIT 200`,
        [LATE_GRACE_MS / 1000],
      );
      for (const s of due) {
        const done = await this.db.transaction(async (client) => {
          const locked = await client.query(`SELECT 1 FROM session WHERE id = $1 AND status = 'started' FOR UPDATE`, [s.id]);
          if (!locked.rowCount) return false;
          await this.finalise(client, s, 'online');
          return true;
        });
        if (done) {
          out.autoSubmitted += 1;
          await this.audit.write({ action: 'session.submitted', payload: { sessionId: s.id, childId: s.child_id, waveId: s.wave_id, auto: true } });
        }
      }

      const closing = await this.db.query<{ id: string }>(
        `SELECT id FROM wave WHERE closed_at IS NULL AND closes_at <= now() LIMIT 50`,
      );
      for (const w of closing) {
        const expired = await this.db.transaction(async (client) => {
          const e = await client.query(
            `UPDATE session SET status = 'expired', expired_at = now()
              WHERE wave_id = $1 AND status = 'started' RETURNING id`,
            [w.id],
          );
          await client.query(`UPDATE wave SET closed_at = now() WHERE id = $1 AND closed_at IS NULL`, [w.id]);
          return e.rowCount ?? 0;
        });
        out.expired += expired;
        out.closed += 1;
        await this.audit.write({ action: 'wave.closed', payload: { waveId: w.id, expiredSessions: expired } });
      }

      out.announced = await this.announceOpenWaves();
      if (out.autoSubmitted || out.closed) this.logger.log(`sessions tick: ${JSON.stringify(out)}`);
      return out;
    } catch (err) {
      this.logger.error('sessions tick failed', err as Error);
      return out;
    } finally {
      this.running = false;
    }
  }

  // ============================================================== helpers

  /**
   * Who may open a session: the person who launched it, or anyone who could
   * launch for this child now (a guardian; an educator with an active link).
   * Anything else is a 404 — a session id must not confirm a child exists.
   */
  private async authorised(actor: Actor, sessionId: string): Promise<SessionRow> {
    if (!UUID.test(sessionId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const s = await this.db.one<SessionRow>(`SELECT * FROM session WHERE id = $1`, [sessionId]);
    if (!s) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (s.launched_by === actor.personId) return s;
    const access = await this.children.check(actor, s.child_id, 'launch_session');
    if (!access) throw new NotFoundException({ error: 'NOT_FOUND' });
    return s;
  }

  private async upsertAnswers(client: PoolClient, s: SessionRow, answers: AnswerDto[]): Promise<number> {
    if (!answers.length) return 0;
    // Only items of this form, and options of those items.
    const valid = await client.query<{ item_version_id: string; option_ids: string[] }>(
      `SELECT fi.item_version_id, array_agg(o.id) AS option_ids
         FROM form_item fi JOIN item_option o ON o.item_version_id = fi.item_version_id
        WHERE fi.form_id = $1 GROUP BY fi.item_version_id`,
      [s.form_id],
    );
    const allowed = new Map(valid.rows.map((r) => [r.item_version_id, new Set(r.option_ids)]));
    const cutoff = (s.deadline_at?.getTime() ?? Number.POSITIVE_INFINITY) + LATE_GRACE_MS;

    let saved = 0;
    for (const a of answers) {
      const opts = allowed.get(a.itemVersionId);
      if (!opts) throw new BadRequestException({ error: 'ANSWER_INVALID', details: { reason: 'item' } });
      if (a.chosenOptionId && !opts.has(a.chosenOptionId)) {
        throw new BadRequestException({ error: 'ANSWER_INVALID', details: { reason: 'option' } });
      }
      // An answer recorded after the deadline does not count — whenever it arrives.
      if (new Date(a.clientRecordedAt).getTime() > cutoff) continue;
      const r = await client.query(
        `INSERT INTO session_answer AS sa
           (session_id, item_version_id, chosen_option_id, flagged, revision_count, response_ms, client_recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, item_version_id) DO UPDATE
            SET chosen_option_id = EXCLUDED.chosen_option_id, flagged = EXCLUDED.flagged,
                revision_count = GREATEST(sa.revision_count, EXCLUDED.revision_count),
                response_ms = EXCLUDED.response_ms, client_recorded_at = EXCLUDED.client_recorded_at,
                updated_at = now()
          WHERE EXCLUDED.client_recorded_at >= sa.client_recorded_at
         RETURNING 1`,
        [s.id, a.itemVersionId, a.chosenOptionId ?? null, !!a.flagged, a.revisionCount ?? 0, a.responseMs ?? null, a.clientRecordedAt],
      );
      saved += r.rowCount ?? 0;
    }
    return saved;
  }

  /**
   * One `response` per form item from the working set — skipped and unopened
   * items too, as NULL (the schema's "NULL = skipped") — then `submitted`.
   */
  private async finalise(client: PoolClient, s: SessionRow, source: 'online' | 'offline_sync'): Promise<void> {
    await client.query(
      `INSERT INTO response
         (session_id, item_version_id, chosen_option_id, is_correct, response_ms, revision_count,
          flagged, client_recorded_at)
       SELECT $1, fi.item_version_id, sa.chosen_option_id,
              CASE WHEN sa.chosen_option_id IS NULL THEN NULL ELSE o.is_key END,
              sa.response_ms, COALESCE(sa.revision_count, 0), COALESCE(sa.flagged, false),
              COALESCE(sa.client_recorded_at, now())
         FROM form_item fi
    LEFT JOIN session_answer sa ON sa.session_id = $1 AND sa.item_version_id = fi.item_version_id
    LEFT JOIN item_option o ON o.id = sa.chosen_option_id
        WHERE fi.form_id = $2
       ON CONFLICT (session_id, item_version_id) DO NOTHING`,
      [s.id, s.form_id],
    );
    await client.query(
      `UPDATE session SET status = 'submitted', submitted_at = now(), sync_source = $2
        WHERE id = $1 AND status = 'started'`,
      [s.id, source],
    );
  }

  private async touchDevice(client: PoolClient, sessionId: string, d?: DeviceInfo): Promise<void> {
    if (!d || (!d.device && !d.os && !d.clientVersion)) return;
    await client.query(
      `UPDATE session SET device = COALESCE($2, device), os = COALESCE($3, os),
                          client_version = COALESCE($4, client_version)
        WHERE id = $1`,
      [sessionId, d.device?.slice(0, 120) ?? null, d.os?.slice(0, 60) ?? null, d.clientVersion?.slice(0, 40) ?? null],
    );
  }

  private async hasConsent(childId: string): Promise<boolean> {
    return !!(await this.db.one(
      `SELECT 1 FROM consent WHERE child_id = $1 AND type = 'data_processing' AND revoked_at IS NULL`,
      [childId],
    ));
  }

  /** Current grade, region and school — what the session snapshots. */
  private async currentEnrolment(childId: string) {
    return this.db.one<{ grade: number; region_id: number; school_id: string | null; consent: boolean }>(
      `SELECT e.grade, e.school_region_id AS region_id, e.school_id,
              EXISTS (SELECT 1 FROM consent k WHERE k.child_id = e.child_id
                       AND k.type = 'data_processing' AND k.revoked_at IS NULL) AS consent
         FROM enrolment e JOIN child c ON c.id = e.child_id AND c.anonymised_at IS NULL
        WHERE e.child_id = $1 AND e.ended_at IS NULL
        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1`,
      [childId],
    );
  }

  /** § 10 `wave_open`: once per wave per child, to the owner. */
  private async announceOpenWaves(): Promise<number> {
    const rows = await this.db.query<{ wave_id: string; ordinal: number; closes_at: Date; child_id: string; owner_id: string; name: string }>(
      `SELECT w.id AS wave_id, w.ordinal, w.closes_at, c.id AS child_id, g.person_id AS owner_id, c.given_name AS name
         FROM wave w
         JOIN season se ON se.id = w.season_id AND se.is_current
         JOIN enrolment e ON e.grade = w.grade AND e.ended_at IS NULL
         JOIN child c ON c.id = e.child_id AND c.anonymised_at IS NULL
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE w.opens_at <= now() AND w.closes_at > now() AND w.closed_at IS NULL AND w.form_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM consent k WHERE k.child_id = c.id AND k.type = 'data_processing' AND k.revoked_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM notification n WHERE n.throttle_key = 'wave_open:' || w.id || ':' || c.id)
        LIMIT 500`,
    );
    let n = 0;
    for (const r of rows) {
      const id = await this.notify.queue({
        personId: r.owner_id,
        template: 'wave_open',
        vars: {
          child: r.name,
          wave: `${r.ordinal}-monitoring`,
          closes: r.closes_at.toISOString(),
          link: `${this.config.webOrigin}/uz/family/children/${r.child_id}`,
        },
        throttleKey: `wave_open:${r.wave_id}:${r.child_id}`,
      });
      if (id) n += 1;
    }
    return n;
  }
}

export interface DeviceInfo {
  device?: string;
  os?: string;
  clientVersion?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
