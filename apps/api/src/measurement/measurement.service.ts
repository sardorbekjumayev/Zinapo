import {
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
import { Actor } from '../authz';
import { NotifyService } from '../notify/notify.service';
import { estimateTheta, inflationDelta, rasch } from './rasch';
import {
  band,
  clusterStanding,
  difUzRu,
  kr20,
  logitDifficulty,
  pointBiserial,
  sem,
  skillState,
  SkillStateValue,
} from './measurement.math';

const TICK_MS = 60_000;

interface FormItemRow {
  item_version_id: string;
  is_scored: boolean;
  cluster: string;
  skill_code: string | null;
  key_option: string | null;
}

interface ResponseRow {
  session_id: string;
  item_version_id: string;
  chosen_option_id: string | null;
  is_correct: boolean | null;
  misconception_code: string | null;
}

interface SessionRow {
  id: string;
  child_id: string;
  region_snapshot: number;
  test_language: string | null;
}

/**
 * task.md § 9 — measurement v0 (`raw_band_v0`), as a background job only.
 *
 * A run is per season × grade and recomputes EVERY closed wave of that grade,
 * so one run holds the whole trend a report draws; switching `is_current` then
 * changes what every report reads, atomically (INV-13). Derived rows are only
 * ever inserted, keyed by the run (INV-12); an old run stays as it was.
 *
 * Reads the raw layer (sessions, responses — monitoring, submitted, scored
 * items only: practice and olympiad data never enter the scale, § 9), writes
 * the derived layer. Must never write the raw layer.
 */
@Injectable()
export class MeasurementService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MeasurementService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
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

  /** Every minute: each closed wave that no `raw_band_v0` run has measured yet. */
  async tick(): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const due = await this.db.query<{ id: string; season_id: string; grade: number; current_method: string | null }>(
        `SELECT w.id, w.season_id, w.grade,
                (SELECT r.method::text FROM calibration_run r
                  WHERE r.season_id = w.season_id AND r.grade = w.grade AND r.is_current) AS current_method
           FROM wave w
          WHERE w.closed_at IS NOT NULL AND w.form_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM calibration_run r WHERE r.wave_id = w.id)
            -- Nothing to measure: a wave nobody submitted makes no run.
            AND EXISTS (SELECT 1 FROM session s WHERE s.wave_id = w.id
                         AND s.mode = 'monitoring' AND s.status = 'submitted')
          ORDER BY w.closed_at LIMIT 10`,
      );
      const runs: string[] = [];
      // M9-d: once staff made a v1 run current, new waves are measured with v1
      // (and that run becomes current) — the v0 job must not silently undo it.
      for (const w of due) {
        runs.push(
          w.current_method === 'rasch_anchor_equating_v1'
            ? await this.runV1(w.season_id, w.grade, w.id, null, true)
            : await this.run(w.season_id, w.grade, w.id, null),
        );
      }
      return runs;
    } catch (err) {
      this.logger.error('measurement tick failed', err as Error);
      return [];
    } finally {
      this.running = false;
    }
  }

  // ============================================================ staff API

  async list(seasonId?: string) {
    return this.db.query(
      `SELECT r.id, r.method, r.grade, r.wave_id AS "waveId", w.ordinal AS "waveOrdinal",
              r.started_at AS "startedAt", r.finished_at AS "finishedAt", r.is_current AS "isCurrent",
              r.params, p.full_name AS "triggeredBy", s.code AS "seasonCode",
              (SELECT count(*)::int FROM scale_score x WHERE x.calibration_run_id = r.id) AS sessions,
              (SELECT count(*)::int FROM percentile_band b WHERE b.calibration_run_id = r.id AND b.pct_low IS NOT NULL) AS bands,
              (SELECT count(*)::int FROM percentile_band b WHERE b.calibration_run_id = r.id AND b.pct_low IS NULL) AS "belowMinimum",
              (SELECT count(*)::int FROM skill_state k WHERE k.calibration_run_id = r.id) AS "skillStates",
              (SELECT count(*)::int FROM item_statistic i WHERE i.calibration_run_id = r.id) AS "itemStatistics"
         FROM calibration_run r
         JOIN season s ON s.id = r.season_id
    LEFT JOIN wave w ON w.id = r.wave_id
    LEFT JOIN person p ON p.id = r.triggered_by
        WHERE ($1::uuid IS NULL AND s.is_current) OR s.id = $1::uuid
        ORDER BY r.grade, r.started_at DESC`,
      [seasonId ?? null],
    );
  }

  /**
   * `POST /staff/calibration-runs` — the bank editor re-runs v0 (§ 8.5
   * "triggers calibration runs"). For one grade, or for every grade of the
   * current season that has a closed wave.
   */
  async trigger(actor: Actor, method: string, grade?: number) {
    if (method !== 'raw_band_v0' && method !== 'rasch_anchor_equating_v1') {
      throw new ConflictException({ error: 'METHOD_NOT_AVAILABLE', details: { method } });
    }
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!season) throw new ConflictException({ error: 'NO_SEASON' });
    const grades = await this.db.query<{ grade: number }>(
      `SELECT DISTINCT grade FROM wave
        WHERE season_id = $1 AND closed_at IS NOT NULL AND form_id IS NOT NULL
          AND ($2::smallint IS NULL OR grade = $2)
        ORDER BY grade`,
      [season.id, grade ?? null],
    );
    const runs: string[] = [];
    // v1 goes lowest grade first: a grade's vertical anchors are fixed at the
    // values the grade below has just been given.
    for (const g of grades) {
      runs.push(
        method === 'rasch_anchor_equating_v1'
          ? await this.runV1(season.id, g.grade, null, actor.personId, false)
          : await this.run(season.id, g.grade, null, actor.personId),
      );
    }
    return { runs };
  }

  /** Switch which run the reports read (§ 9 "switching is_current atomically"). */
  async makeCurrent(actor: Actor, runId: string) {
    const r = await this.db.one<{ season_id: string; grade: number }>(
      `SELECT season_id, grade FROM calibration_run WHERE id = $1 AND finished_at IS NOT NULL`,
      [runId],
    );
    if (!r) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE calibration_run SET is_current = false WHERE season_id = $1 AND grade = $2 AND is_current`,
        [r.season_id, r.grade],
      );
      await client.query(`UPDATE calibration_run SET is_current = true WHERE id = $1`, [runId]);
    });
    await this.audit.write({ action: 'calibration.run_switched', personId: actor.personId, payload: { runId, grade: r.grade } });
    return this.list(r.season_id);
  }

  // ================================================================= run

  /**
   * One `raw_band_v0` run for a season and grade. `waveId` is the wave whose
   * close triggered it (null for a manual re-run). Returns the run id.
   */
  async run(seasonId: string, grade: number, waveId: string | null, triggeredBy: string | null): Promise<string> {
    const started = Date.now();
    const { runId, summary, newWaveChildren } = await this.db.transaction(async (client) => {
      const run = await client.query<{ id: string }>(
        `INSERT INTO calibration_run (method, season_id, grade, wave_id, triggered_by, params)
         VALUES ('raw_band_v0', $1, $2, $3, $4, $5::jsonb) RETURNING id`,
        [seasonId, grade, waveId, triggeredBy, JSON.stringify({ sem: 'kr20', cohort: 'region×grade×season', minimum: 30 })],
      );
      const runId = run.rows[0].id;

      const waves = await client.query<{ id: string; ordinal: number; form_id: string }>(
        `SELECT id, ordinal, form_id FROM wave
          WHERE season_id = $1 AND grade = $2 AND closed_at IS NOT NULL AND form_id IS NOT NULL
          ORDER BY ordinal`,
        [seasonId, grade],
      );

      // child → skill → history, carried across waves in order (§ 9 v0).
      const skillHistory = new Map<string, Map<string, { correct: number; state: SkillStateValue }[]>>();
      const perWave: Record<string, { sessions: number; reliability: number | null; sem: number }> = {};

      for (const w of waves.rows) {
        perWave[w.ordinal] = await this.measureWave(client, runId, grade, w, skillHistory);
      }

      await client.query(
        `UPDATE calibration_run SET is_current = false WHERE season_id = $1 AND grade = $2 AND is_current`,
        [seasonId, grade],
      );
      await client.query(
        `UPDATE calibration_run SET is_current = true, finished_at = now(),
                params = params || jsonb_build_object('waves', $2::jsonb)
          WHERE id = $1`,
        [runId, JSON.stringify(perWave)],
      );

      // Who has a new report: children measured on the triggering wave.
      const children = waveId
        ? (await client.query<{ child_id: string }>(
            `SELECT DISTINCT child_id FROM session WHERE wave_id = $1 AND status = 'submitted' AND mode = 'monitoring'`,
            [waveId],
          )).rows.map((r) => r.child_id)
        : [];
      return { runId, summary: perWave, newWaveChildren: children };
    });

    await this.audit.write({
      action: 'calibration.run_started',
      personId: triggeredBy,
      payload: { runId, grade, waveId, method: 'raw_band_v0', waves: summary, ms: Date.now() - started },
    });
    if (waveId) await this.announce(waveId, newWaveChildren);
    this.logger.log(`raw_band_v0 run ${runId} for grade ${grade}: ${JSON.stringify(summary)}`);
    return runId;
  }

  /**
   * One `rasch_anchor_equating_v1` run for a season and grade (M9-a … M9-d).
   *
   *   1. one concurrent JMLE calibration over every submitted monitoring
   *      session of the season's closed waves, scored items only; an anchor
   *      whose difficulty an earlier v1 run set is FIXED there (equating);
   *   2. the proctored spring final of this grade scored on that scale;
   *   3. per region: inflation delta = mean(latest monitoring θ − final θ),
   *      applied to the region's monitoring θ when ≥ 30 children sat both
   *      (M9-c) — the final corrects monitoring, never the reverse;
   *   4. each wave written like v0, but with θ ± 1.0 SE for the bands and the
   *      Rasch difficulty for the items.
   *
   * Not current unless `makeCurrent` (M9-d: staff switch to v1 explicitly).
   */
  async runV1(seasonId: string, grade: number, waveId: string | null, triggeredBy: string | null, makeCurrent: boolean): Promise<string> {
    const started = Date.now();
    const { runId, params, newWaveChildren } = await this.db.transaction(async (client) => {
      const runId = (
        await client.query<{ id: string }>(
          `INSERT INTO calibration_run (method, season_id, grade, wave_id, triggered_by, params)
           VALUES ('rasch_anchor_equating_v1', $1, $2, $3, $4, $5::jsonb) RETURNING id`,
          [seasonId, grade, waveId, triggeredBy, JSON.stringify({ model: 'rasch', estimation: 'jmle', band: 'theta ± 1.0 SE', minimum: 30 })],
        )
      ).rows[0].id;
      const waves = (
        await client.query<{ id: string; ordinal: number; form_id: string }>(
          `SELECT id, ordinal, form_id FROM wave
            WHERE season_id = $1 AND grade = $2 AND closed_at IS NOT NULL AND form_id IS NOT NULL ORDER BY ordinal`,
          [seasonId, grade],
        )
      ).rows;

      // 1. The calibration matrix: sessions × scored item versions across waves.
      const sessions = (
        await client.query<{ id: string; child_id: string; region: number; ordinal: number; form_id: string }>(
          `SELECT s.id, s.child_id, s.region_snapshot AS region, w.ordinal, s.form_id
             FROM session s JOIN wave w ON w.id = s.wave_id
            WHERE w.id = ANY($1::uuid[]) AND s.mode = 'monitoring' AND s.status = 'submitted'`,
          [waves.map((w) => w.id)],
        )
      ).rows;
      const formItems = (
        await client.query<{ form_id: string; item_version_id: string; is_anchor: boolean; is_scored: boolean }>(
          `SELECT fi.form_id, fi.item_version_id, i.is_anchor, fi.is_scored
             FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id JOIN item i ON i.id = v.item_id
            WHERE fi.form_id = ANY($1::uuid[])`,
          [waves.map((w) => w.form_id)],
        )
      ).rows;
      const scoredIvs = [...new Set(formItems.filter((f) => f.is_scored).map((f) => f.item_version_id))];
      const col = new Map(scoredIvs.map((iv, i) => [iv, i]));
      const onForm = new Map<string, Set<string>>();
      for (const f of formItems.filter((x) => x.is_scored)) {
        if (!onForm.has(f.form_id)) onForm.set(f.form_id, new Set());
        onForm.get(f.form_id)!.add(f.item_version_id);
      }
      const correct = new Set(
        (
          await client.query<{ k: string }>(
            `SELECT r.session_id || ':' || r.item_version_id AS k FROM response r
              WHERE r.session_id = ANY($1::uuid[]) AND r.is_correct`,
            [sessions.map((x) => x.id)],
          )
        ).rows.map((r) => r.k),
      );
      const matrix = sessions.map((sess) =>
        scoredIvs.map((iv) => (onForm.get(sess.form_id)?.has(iv) ? (correct.has(`${sess.id}:${iv}`) ? 1 : 0) : null)),
      ) as (0 | 1 | null)[][];

      // Anchors fixed at the latest v1 value (current run first).
      const anchorIvs = [...new Set(formItems.filter((f) => f.is_anchor && f.is_scored).map((f) => f.item_version_id))];
      const prior = (
        await client.query<{ item_version_id: string; b: string }>(
          `SELECT DISTINCT ON (st.item_version_id) st.item_version_id, st.difficulty_b AS b
             FROM item_statistic st JOIN calibration_run cr ON cr.id = st.calibration_run_id
            WHERE cr.method = 'rasch_anchor_equating_v1' AND cr.id <> $2 AND cr.finished_at IS NOT NULL
              AND st.item_version_id = ANY($1::uuid[]) AND st.difficulty_b IS NOT NULL
            ORDER BY st.item_version_id, cr.is_current DESC, cr.started_at DESC`,
          [anchorIvs, runId],
        )
      ).rows;
      const fixed = new Map(prior.map((r) => [col.get(r.item_version_id)!, Number(r.b)]));
      const fit = sessions.length ? rasch({ responses: matrix, fixed }) : null;
      const bByIv = new Map(scoredIvs.map((iv, i) => [iv, fit ? fit.b[i] : 0]));

      // 2. The proctored final of this grade, scored on this scale.
      const finals = (
        await client.query<{ id: string; child_id: string; region: number; answers: { iv: string; ok: boolean | null }[] }>(
          `SELECT s.id, s.child_id, s.region_snapshot AS region,
                  json_agg(json_build_object('iv', r.item_version_id, 'ok', r.is_correct)) AS answers
             FROM session s
             JOIN olympiad_entry e ON e.id = s.olympiad_entry_id
             JOIN olympiad_stage st ON st.id = e.stage_id AND st.kind = 'spring_final'
             JOIN olympiad o ON o.id = st.olympiad_id AND o.season_id = $1
             JOIN response r ON r.session_id = s.id
            WHERE s.mode = 'olympiad' AND s.status = 'submitted' AND s.launch_context = 'proctored_final'
              AND s.grade_snapshot = $2
            GROUP BY s.id`,
          [seasonId, grade],
        )
      ).rows;
      const finalTheta = new Map<string, { theta: number; region: number }>();
      for (const f of finals) {
        const known = f.answers.filter((a) => bByIv.has(a.iv));
        if (known.length < 5) continue; // too few items on this scale to place the child
        const est = estimateTheta(known.map((a) => (a.ok ? 1 : 0)), known.map((a) => bByIv.get(a.iv)!));
        if (est) finalTheta.set(f.child_id, { theta: est.theta, region: f.region });
      }

      // 3. Inflation per region (M9-c): latest monitoring θ vs final θ.
      const raw = new Map(sessions.map((x, n) => [x.id, { theta: fit!.theta[n], se: fit!.thetaSe[n] }]));
      const latest = new Map<string, { theta: number; region: number; ordinal: number }>();
      sessions.forEach((x, n) => {
        const cur = latest.get(x.child_id);
        if (!cur || x.ordinal > cur.ordinal) latest.set(x.child_id, { theta: fit!.theta[n], region: x.region, ordinal: x.ordinal });
      });
      const inflation: { regionId: number; delta: number | null; n: number }[] = [];
      const deltaByRegion = new Map<number, number>();
      for (const region of new Set(sessions.map((x) => x.region))) {
        const pairs = [...finalTheta.entries()]
          .filter(([child, f]) => f.region === region && latest.has(child))
          .map(([child, f]) => ({ monitoring: latest.get(child)!.theta, final: f.theta }));
        const delta = inflationDelta(pairs);
        inflation.push({ regionId: region, delta: delta === null ? null : Number(delta.toFixed(3)), n: pairs.length });
        if (delta !== null) {
          deltaByRegion.set(region, delta);
          await client.query(
            `INSERT INTO inflation_adjustment (calibration_run_id, region_id, grade, delta_theta, n_final) VALUES ($1, $2, $3, $4, $5)`,
            [runId, region, grade, delta.toFixed(3), pairs.length],
          );
        }
      }
      const adjusted = new Map(
        sessions.map((x) => [x.id, { theta: raw.get(x.id)!.theta - (deltaByRegion.get(x.region) ?? 0), se: raw.get(x.id)!.se }]),
      );

      // 4. Each wave, written like v0 but on the Rasch scale.
      const skillHistory = new Map<string, Map<string, { correct: number; state: SkillStateValue }[]>>();
      const perWave: Record<string, unknown> = {};
      for (const w of waves) perWave[w.ordinal] = await this.measureWave(client, runId, grade, w, skillHistory, { theta: adjusted, b: bByIv });

      const params = {
        persons: sessions.length,
        items: scoredIvs.length,
        fixedAnchors: fixed.size,
        iterations: fit?.iterations ?? 0,
        converged: fit?.converged ?? false,
        finals: finalTheta.size,
        inflation,
        waves: perWave,
      };
      if (makeCurrent) {
        await client.query(`UPDATE calibration_run SET is_current = false WHERE season_id = $1 AND grade = $2 AND is_current`, [seasonId, grade]);
      }
      await client.query(
        `UPDATE calibration_run SET is_current = $3, finished_at = now(), params = params || $2::jsonb WHERE id = $1`,
        [runId, JSON.stringify(params), makeCurrent],
      );
      const children = waveId && makeCurrent
        ? (await client.query<{ child_id: string }>(
            `SELECT DISTINCT child_id FROM session WHERE wave_id = $1 AND status = 'submitted' AND mode = 'monitoring'`,
            [waveId],
          )).rows.map((r) => r.child_id)
        : [];
      return { runId, params, newWaveChildren: children };
    });
    await this.audit.write({
      action: 'calibration.run_started',
      personId: triggeredBy,
      payload: { runId, grade, waveId, method: 'rasch_anchor_equating_v1', persons: params.persons, fixedAnchors: params.fixedAnchors, ms: Date.now() - started },
    });
    if (waveId && makeCurrent) await this.announce(waveId, newWaveChildren);
    this.logger.log(`rasch v1 run ${runId} for grade ${grade}: ${params.persons} sessions, ${params.items} items, ${params.fixedAnchors} anchors fixed`);
    return runId;
  }

  /**
   * Compare two runs of one season and grade (M9-d): how far each child's band
   * moved per wave, and which items' difficulty changed most. Counts and item
   * codes only — never a child's name.
   */
  async compare(a: string, b: string) {
    const runs = await this.db.query<{ id: string; method: string; season_id: string; grade: number; is_current: boolean; started_at: Date; params: Record<string, unknown> }>(
      `SELECT id, method::text, season_id, grade, is_current, started_at, params FROM calibration_run WHERE id = ANY($1::uuid[]) AND finished_at IS NOT NULL`,
      [[a, b]],
    );
    const ra = runs.find((r) => r.id === a);
    const rb = runs.find((r) => r.id === b);
    if (!ra || !rb) throw new NotFoundException({ error: 'NOT_FOUND' });
    if (ra.season_id !== rb.season_id || ra.grade !== rb.grade) throw new ConflictException({ error: 'NOT_COMPARABLE' });

    const waves = await this.db.query<{ ordinal: number; n: number; mean_shift: number | null; moved10: number; band_a: number; band_b: number }>(
      `SELECT w.ordinal, count(*)::int AS n,
              avg(abs((x.pct_low + x.pct_high) / 2.0 - (y.pct_low + y.pct_high) / 2.0))::float8 AS mean_shift,
              count(*) FILTER (WHERE abs((x.pct_low + x.pct_high) / 2.0 - (y.pct_low + y.pct_high) / 2.0) >= 10)::int AS moved10,
              count(*) FILTER (WHERE x.pct_low IS NOT NULL)::int AS band_a,
              count(*) FILTER (WHERE y.pct_low IS NOT NULL)::int AS band_b
         FROM percentile_band x
         JOIN percentile_band y ON y.child_id = x.child_id AND y.wave_id = x.wave_id AND y.calibration_run_id = $2
         JOIN wave w ON w.id = x.wave_id
        WHERE x.calibration_run_id = $1
        GROUP BY w.ordinal ORDER BY w.ordinal`,
      [a, b],
    );
    const skills = await this.db.query<{ ordinal: number; n: number; changed: number }>(
      `SELECT w.ordinal, count(*)::int AS n, count(*) FILTER (WHERE x.state <> y.state)::int AS changed
         FROM skill_state x
         JOIN skill_state y ON y.child_id = x.child_id AND y.wave_id = x.wave_id AND y.skill_code = x.skill_code AND y.calibration_run_id = $2
         JOIN wave w ON w.id = x.wave_id
        WHERE x.calibration_run_id = $1 GROUP BY w.ordinal ORDER BY w.ordinal`,
      [a, b],
    );
    const items = await this.db.query<{ code: string; is_anchor: boolean; b_a: number | null; b_b: number | null }>(
      `SELECT i.code, i.is_anchor, x.difficulty_b::float8 AS b_a, y.difficulty_b::float8 AS b_b
         FROM item_statistic x
         JOIN item_statistic y ON y.item_version_id = x.item_version_id AND y.calibration_run_id = $2
         JOIN item_version v ON v.id = x.item_version_id JOIN item i ON i.id = v.item_id
        WHERE x.calibration_run_id = $1
        ORDER BY abs(COALESCE(y.difficulty_b, 0) - COALESCE(x.difficulty_b, 0)) DESC, i.code
        LIMIT 15`,
      [a, b],
    );
    const inflation = await this.db.query(
      `SELECT ia.calibration_run_id AS "runId", ia.region_id AS "regionId", r.name_uz AS "regionUz", r.name_ru AS "regionRu",
              ia.delta_theta::float8 AS delta, ia.n_final AS n
         FROM inflation_adjustment ia JOIN region r ON r.id = ia.region_id WHERE ia.calibration_run_id = ANY($1::uuid[])`,
      [[a, b]],
    );
    const view = (r: typeof ra) => ({ id: r.id, method: r.method, isCurrent: r.is_current, startedAt: r.started_at, params: r.params });
    return {
      a: view(ra),
      b: view(rb),
      grade: ra.grade,
      waves: waves.map((w) => ({ ordinal: w.ordinal, children: w.n, meanShift: w.mean_shift === null ? null : Number(w.mean_shift.toFixed(1)), movedTenOrMore: w.moved10, bandsA: w.band_a, bandsB: w.band_b })),
      skills: skills.map((k) => ({ ordinal: k.ordinal, states: k.n, changed: k.changed })),
      items: items.map((i) => ({ code: i.code, isAnchor: i.is_anchor, bA: i.b_a, bB: i.b_b })),
      inflation,
    };
  }

  private async measureWave(
    client: PoolClient,
    runId: string,
    grade: number,
    wave: { id: string; ordinal: number; form_id: string },
    skillHistory: Map<string, Map<string, { correct: number; state: SkillStateValue }[]>>,
    /** v1 (M9): Rasch theta + SE per session and difficulty per item version. Absent → v0. */
    scale?: { theta: Map<string, { theta: number; se: number }>; b: Map<string, number> },
  ) {
    const items = (
      await client.query<FormItemRow>(
        `SELECT fi.item_version_id, fi.is_scored, t.cluster::text AS cluster, i.skill_code,
                (SELECT o.id FROM item_option o WHERE o.item_version_id = fi.item_version_id AND o.is_key) AS key_option
           FROM form_item fi
           JOIN item_version v ON v.id = fi.item_version_id
           JOIN item i ON i.id = v.item_id
           JOIN topic t ON t.code = i.topic_code
          WHERE fi.form_id = $1 ORDER BY fi.position`,
        [wave.form_id],
      )
    ).rows;
    const sessions = (
      await client.query<SessionRow>(
        `SELECT id, child_id, region_snapshot, test_language FROM session
          WHERE wave_id = $1 AND mode = 'monitoring' AND status = 'submitted'`,
        [wave.id],
      )
    ).rows;
    if (sessions.length === 0) return { sessions: 0, reliability: null, sem: 0 };

    const responses = (
      await client.query<ResponseRow>(
        `SELECT r.session_id, r.item_version_id, r.chosen_option_id, r.is_correct, o.misconception_code
           FROM response r
           JOIN session s ON s.id = r.session_id
      LEFT JOIN item_option o ON o.id = r.chosen_option_id
          WHERE s.wave_id = $1 AND s.mode = 'monitoring' AND s.status = 'submitted'`,
        [wave.id],
      )
    ).rows;
    // Every option of every version, so a distractor nobody picked still gets
    // its 0 — that zero is exactly the "dead distractor" flag (design/11).
    const optionRows = (
      await client.query<{ id: string; item_version_id: string; position: number; is_key: boolean }>(
        `SELECT o.id, o.item_version_id, o.position, o.is_key FROM item_option o
           JOIN form_item fi ON fi.item_version_id = o.item_version_id WHERE fi.form_id = $1`,
        [wave.form_id],
      )
    ).rows;
    const bySession = new Map<string, Map<string, ResponseRow>>();
    for (const r of responses) {
      if (!bySession.has(r.session_id)) bySession.set(r.session_id, new Map());
      bySession.get(r.session_id)!.set(r.item_version_id, r);
    }

    const scored = items.filter((i) => i.is_scored);
    const correct = (sid: string, iv: string): number => (bySession.get(sid)?.get(iv)?.is_correct ? 1 : 0);

    // Raw scores and the scored-item matrix (the scale's input).
    const matrix = sessions.map((s) => scored.map((i) => correct(s.id, i.item_version_id)));
    const totals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
    const reliability = kr20(matrix);
    const semValue = sem(totals, scored.length, reliability);

    await this.insertJson(
      client,
      `INSERT INTO scale_score (calibration_run_id, session_id, raw_score, theta, se)
       SELECT $1, x.session_id, x.raw_score, x.theta, x.se
         FROM jsonb_to_recordset($2::jsonb) AS x(session_id uuid, raw_score int, theta numeric, se numeric)`,
      runId,
      sessions.map((s, i) => {
        const t = scale?.theta.get(s.id);
        return { session_id: s.id, raw_score: totals[i], theta: t ? Number(t.theta.toFixed(3)) : null, se: t ? Number(t.se.toFixed(3)) : null };
      }),
    );

    // Grades 3–4: a band within region × grade × season (§ 9, INV-11).
    if (grade >= 3) {
      // v0: raw score ± SEM; v1: theta ± 1.0 SE (§ 9), both as percentiles
      // within the cohort's own values.
      const value = (s: SessionRow, i: number) => (scale ? scale.theta.get(s.id)?.theta ?? 0 : totals[i]);
      const byRegion = new Map<number, number[]>();
      sessions.forEach((s, i) => {
        if (!byRegion.has(s.region_snapshot)) byRegion.set(s.region_snapshot, []);
        byRegion.get(s.region_snapshot)!.push(value(s, i));
      });
      await this.insertJson(
        client,
        `INSERT INTO percentile_band (calibration_run_id, child_id, wave_id, grade, region_id, pct_low, pct_high, cohort_n)
         SELECT $1, x.child_id, x.wave_id, x.grade, x.region_id, x.low, x.high, x.n
           FROM jsonb_to_recordset($2::jsonb)
             AS x(child_id uuid, wave_id uuid, grade int, region_id int, low int, high int, n int)`,
        runId,
        sessions.map((s, i) => {
          const cohort = byRegion.get(s.region_snapshot)!;
          const b = band(value(s, i), cohort, scale ? scale.theta.get(s.id)?.se ?? semValue : semValue);
          return { child_id: s.child_id, wave_id: wave.id, grade, region_id: s.region_snapshot, low: b.low, high: b.high, n: cohort.length };
        }),
      );
    }

    // Grades 0–2: criterion-referenced skill states, never a rank (INV-11).
    if (grade <= 2) {
      const rows: Record<string, unknown>[] = [];
      for (const s of sessions) {
        const perSkill = new Map<string, { correct: number; seen: number }>();
        for (const it of scored) {
          if (!it.skill_code) continue;
          const c = perSkill.get(it.skill_code) ?? { correct: 0, seen: 0 };
          c.seen += 1;
          c.correct += correct(s.id, it.item_version_id);
          perSkill.set(it.skill_code, c);
        }
        if (!skillHistory.has(s.child_id)) skillHistory.set(s.child_id, new Map());
        const hist = skillHistory.get(s.child_id)!;
        for (const [skill, c] of perSkill) {
          const state = skillState(c.correct, hist.get(skill) ?? []);
          hist.set(skill, [...(hist.get(skill) ?? []), { correct: c.correct, state }]);
          rows.push({ child_id: s.child_id, skill_code: skill, state, correct: c.correct, seen: c.seen });
        }
      }
      await this.insertJson(
        client,
        `INSERT INTO skill_state (calibration_run_id, child_id, wave_id, skill_code, grade, state, correct_count, seen_count)
         SELECT $1, x.child_id, $3::uuid, x.skill_code, $4::smallint, x.state::skill_state_value, x.correct, x.seen
           FROM jsonb_to_recordset($2::jsonb) AS x(child_id uuid, skill_code text, state text, correct int, seen int)`,
        runId,
        rows,
        [wave.id, grade],
      );
    }

    // Cluster standing and the misconception pattern (design/03 and /04).
    await this.insertJson(
      client,
      `INSERT INTO child_wave_summary (calibration_run_id, child_id, wave_id, clusters, misconceptions, dominant_misconception)
       SELECT $1, x.child_id, $3::uuid, x.clusters, x.misconceptions, x.dominant
         FROM jsonb_to_recordset($2::jsonb) AS x(child_id uuid, clusters jsonb, misconceptions jsonb, dominant text)`,
      runId,
      sessions.map((s, i) => {
        const overall = scored.length ? totals[i] / scored.length : 0;
        const clusters: Record<string, string> = {};
        for (const cl of new Set(scored.map((it) => it.cluster))) {
          const of = scored.filter((it) => it.cluster === cl);
          const share = of.reduce((a, it) => a + correct(s.id, it.item_version_id), 0) / of.length;
          clusters[cl] = clusterStanding(share, overall);
        }
        const picks: Record<string, number> = {};
        for (const it of scored) {
          const code = bySession.get(s.id)?.get(it.item_version_id)?.misconception_code;
          if (code) picks[code] = (picks[code] ?? 0) + 1;
        }
        const top = Object.entries(picks).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        return { child_id: s.child_id, clusters, misconceptions: picks, dominant: top && top[1] >= 2 ? top[0] : null };
      }),
      [wave.id],
    );

    // Item statistics for every version on the form, pretest included (§ 8.5).
    const stats = items.map((it) => {
      const answered = sessions.map((s, i) => ({ s, i, r: bySession.get(s.id)?.get(it.item_version_id) }));
      const xs: number[] = answered.map((a) => (a.r?.is_correct ? 1 : 0));
      const n = xs.length;
      const p = n ? xs.reduce((a, b) => a + b, 0) / n : null;
      // Keyed by option position ("2", "3", …) — what the item card shows.
      const share: Record<string, number> = {};
      for (const o of optionRows.filter((o) => o.item_version_id === it.item_version_id && !o.is_key)) {
        const picked = answered.filter((a) => a.r?.chosen_option_id === o.id).length;
        share[String(o.position)] = Number((picked / Math.max(n, 1)).toFixed(3));
      }
      const lang = (l: string) => answered.filter((a) => a.s.test_language === l).map((a) => (a.r?.is_correct ? 1 : 0));
      const rpb = pointBiserial(xs, totals);
      const dif = difUzRu(lang('uz'), lang('ru'));
      return {
        item_version_id: it.item_version_id,
        n,
        p: p === null ? null : Number(p.toFixed(3)),
        rpb: rpb === null ? null : Number(Math.max(-0.999, Math.min(0.999, rpb)).toFixed(3)),
        share,
        dif: dif === null ? null : Number(dif.toFixed(3)),
        b: scale?.b.has(it.item_version_id)
          ? Number(scale.b.get(it.item_version_id)!.toFixed(3))
          : p === null ? null : Number(logitDifficulty(p).toFixed(3)),
      };
    });
    await this.insertJson(
      client,
      `INSERT INTO item_statistic (calibration_run_id, item_version_id, n, p, point_biserial, distractor_share, dif_uz_ru, difficulty_b)
       SELECT $1, x.item_version_id, x.n, x.p, x.rpb, x.share, x.dif, x.b
         FROM jsonb_to_recordset($2::jsonb)
           AS x(item_version_id uuid, n int, p numeric, rpb numeric, share jsonb, dif numeric, b numeric)
       ON CONFLICT DO NOTHING`,
      runId,
      stats,
    );

    return { sessions: sessions.length, reliability: reliability === null ? null : Number(reliability.toFixed(3)), sem: Number(semValue.toFixed(2)) };
  }

  /**
   * § 10 `report_ready`: once per wave and child, to every live guardian. The
   * throttle key makes a re-run silent — a parent hears about a wave once.
   */
  private async announce(waveId: string, children: string[]): Promise<void> {
    const wave = await this.db.one<{ ordinal: number }>(`SELECT ordinal FROM wave WHERE id = $1`, [waveId]);
    for (const childId of children) {
      const rows = await this.db.query<{ person_id: string; name: string }>(
        `SELECT g.person_id, c.given_name AS name FROM guardianship g JOIN child c ON c.id = g.child_id
          WHERE g.child_id = $1 AND g.revoked_at IS NULL AND c.anonymised_at IS NULL`,
        [childId],
      );
      for (const r of rows) {
        await this.notify.queue({
          personId: r.person_id,
          template: 'report_ready',
          vars: { child: r.name, wave: `${wave?.ordinal ?? ''}-monitoring`, link: `${this.config.webOrigin}/uz/family/children/${childId}` },
          throttleKey: `report_ready:${waveId}:${childId}:${r.person_id}`,
        });
      }
    }
  }

  private async insertJson(
    client: PoolClient,
    sql: string,
    runId: string,
    rows: Record<string, unknown>[],
    extra: unknown[] = [],
  ): Promise<void> {
    // Chunks keep each statement's JSON parameter a sensible size.
    for (let i = 0; i < rows.length; i += 2000) {
      await client.query(sql, [runId, JSON.stringify(rows.slice(i, i + 2000)), ...extra]);
    }
  }
}
