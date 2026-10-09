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
      const due = await this.db.query<{ id: string; season_id: string; grade: number }>(
        `SELECT w.id, w.season_id, w.grade FROM wave w
          WHERE w.closed_at IS NOT NULL AND w.form_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM calibration_run r
                             WHERE r.method = 'raw_band_v0' AND r.wave_id = w.id)
            -- Nothing to measure: a wave nobody submitted makes no run.
            AND EXISTS (SELECT 1 FROM session s WHERE s.wave_id = w.id
                         AND s.mode = 'monitoring' AND s.status = 'submitted')
          ORDER BY w.closed_at LIMIT 10`,
      );
      const runs: string[] = [];
      for (const w of due) runs.push(await this.run(w.season_id, w.grade, w.id, null));
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
    if (method !== 'raw_band_v0') {
      // § 9: v1 (Rasch with anchor equating) is Release 2 / M9.
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
    for (const g of grades) runs.push(await this.run(season.id, g.grade, null, actor.personId));
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

  private async measureWave(
    client: PoolClient,
    runId: string,
    grade: number,
    wave: { id: string; ordinal: number; form_id: string },
    skillHistory: Map<string, Map<string, { correct: number; state: SkillStateValue }[]>>,
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
      `INSERT INTO scale_score (calibration_run_id, session_id, raw_score)
       SELECT $1, x.session_id, x.raw_score FROM jsonb_to_recordset($2::jsonb) AS x(session_id uuid, raw_score int)`,
      runId,
      sessions.map((s, i) => ({ session_id: s.id, raw_score: totals[i] })),
    );

    // Grades 3–4: a band within region × grade × season (§ 9, INV-11).
    if (grade >= 3) {
      const byRegion = new Map<number, number[]>();
      sessions.forEach((s, i) => {
        if (!byRegion.has(s.region_snapshot)) byRegion.set(s.region_snapshot, []);
        byRegion.get(s.region_snapshot)!.push(totals[i]);
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
          const b = band(totals[i], cohort, semValue);
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
        b: p === null ? null : Number(logitDifficulty(p).toFixed(3)),
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
