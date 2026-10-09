import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor } from '../authz';
import { band, kr20, percentileRank, sem } from '../measurement/measurement.math';
import { FAST_MEDIAN_MS, FAST_MIN_SHARE_CORRECT, ONLINE_STAGES, StageKind, UUID } from './olympiad.common';
import { median } from '../educator/educator.util';

interface Scored {
  entry_id: string;
  child_id: string;
  region_id: number;
  grade: number;
  session_id: string;
  answers: { iv: string; ok: boolean; ms: number | null }[];
}

const STAGE_NAMES: Record<StageKind, string> = {
  autumn_online: 'Kuzgi onlayn bosqich',
  mini_final: 'Mini-final',
  spring_online: 'Bahorgi onlayn bosqich',
  spring_final: 'Bahorgi final',
};

/**
 * § 8.5 "After the in-person final": regional ranking for grades ≥ 3 only,
 * certificates for the top 15 %, a diagnostic for everyone else, awards, the
 * teacher bonus (proctored stages only) and the season cup (gain).
 *
 * Decided with the product owner:
 *   M7-b  teacher bonus = certificates at the spring final earned by the
 *         educator's linked pupils (never their own child) × the olympiad's rate;
 *   M7-c  season cup = 50 % spring-final percentile + 50 % gain from the
 *         autumn online stage, top N per region × grade;
 *   M7-d  without a ticket, the spring online stage's top 30 % qualify.
 *
 * Results are recomputed freely until the stage is PUBLISHED; after that they
 * are fixed, because families have seen them.
 */
@Injectable()
export class OlympiadResultsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async compute(actor: Actor, olympiadId: string, stageId: string) {
    const ctx = await this.stage(olympiadId, stageId);
    if (ctx.results_published_at) throw new ConflictException({ error: 'RESULTS_PUBLISHED' });

    const scored = await this.scored(stageId);
    const summary = await this.db.transaction(async (client) => {
      // A recompute starts clean: the stage's results and its awards.
      await client.query(
        `UPDATE olympiad_entry SET result_score = NULL, result_rank = NULL, result_percentile = NULL,
                result_pct_low = NULL, result_pct_high = NULL, result_cohort_n = NULL,
                certificate_issued_at = NULL, qualified = false
          WHERE stage_id = $1`,
        [stageId],
      );
      await client.query(`DELETE FROM olympiad_award WHERE stage_id = $1`, [stageId]);

      let certificates = 0;
      let qualified = 0;
      // Cohorts: region × grade. Ranking only where the olympiad is ranked (grades ≥ 3).
      const cohorts = new Map<string, Scored[]>();
      for (const s of scored) {
        const k = `${s.region_id}:${s.grade}`;
        cohorts.set(k, [...(cohorts.get(k) ?? []), s]);
      }
      for (const members of cohorts.values()) {
        const totals = members.map((m) => m.answers.filter((a) => a.ok).length);
        if (!ctx.is_ranked) {
          for (const [i, m] of members.entries()) {
            await client.query(`UPDATE olympiad_entry SET result_score = $2, result_cohort_n = $3 WHERE id = $1`, [m.entry_id, totals[i], members.length]);
          }
          continue;
        }
        const k = Math.max(...members.map((m) => m.answers.length));
        const matrix = members.map((m) => m.answers.map((a) => (a.ok ? 1 : 0)));
        const semValue = sem(totals, k, kr20(matrix));
        for (const [i, m] of members.entries()) {
          const score = totals[i];
          const pct = percentileRank(score, totals);
          const b = band(score, totals, semValue);
          const rank = 1 + totals.filter((t) => t > score).length;
          const cert = pct >= 100 - ctx.certificate_top_pct;
          const qual =
            ctx.kind === 'spring_online' ? pct >= 100 - ctx.qualify_top_pct : ctx.kind === 'autumn_online' ? rank <= ctx.mini_final_top_n : false;
          await client.query(
            `UPDATE olympiad_entry SET result_score = $2, result_rank = $3, result_percentile = $4,
                    result_pct_low = $5, result_pct_high = $6, result_cohort_n = $7,
                    certificate_issued_at = CASE WHEN $8 THEN now() END, qualified = $9
              WHERE id = $1`,
            [m.entry_id, score, rank, pct, b.low, b.high, members.length, cert, qual],
          );
          if (cert) {
            certificates += 1;
            await this.award(client, olympiadId, stageId, 'certificate', { childId: m.child_id, region: m.region_id, grade: m.grade });
          }
          if (qual) qualified += 1;
          // Places only at the in-person final (§ 8.5) — the unsupervised stages carry no prizes.
          if (ctx.kind === 'spring_final' && rank <= 3) {
            await this.award(client, olympiadId, stageId, 'place', { childId: m.child_id, place: rank, region: m.region_id, grade: m.grade });
          }
        }
      }

      const flagged = ONLINE_STAGES.includes(ctx.kind) ? await this.flagFast(client, scored) : 0;
      const bonus = ctx.kind === 'spring_final' && ctx.is_ranked ? await this.teacherBonus(client, olympiadId, stageId, ctx) : { educators: 0 };
      const cups = ctx.kind === 'spring_final' && ctx.is_ranked ? await this.seasonCup(client, olympiadId, stageId, ctx.cup_top_n) : 0;

      await client.query(`UPDATE olympiad_stage SET results_computed_at = now() WHERE id = $1`, [stageId]);
      return { taken: scored.length, certificates, qualified, flagged, bonusEducators: bonus.educators, cups };
    });
    await this.audit.write({ action: 'olympiad.results_computed', personId: actor.personId, payload: { olympiadId, stageId, ...summary } });
    return summary;
  }

  /** Families see the stage's results from now on; each owner is told once. */
  async publish(actor: Actor, olympiadId: string, stageId: string) {
    const ctx = await this.stage(olympiadId, stageId);
    if (ctx.results_published_at) throw new ConflictException({ error: 'RESULTS_PUBLISHED' });
    if (!ctx.results_computed_at) throw new ConflictException({ error: 'RESULTS_NOT_COMPUTED' });
    await this.db.query(`UPDATE olympiad_stage SET results_published_at = now() WHERE id = $1`, [stageId]);
    const owners = await this.db.query<{ owner_id: string; child_id: string; child: string }>(
      `SELECT g.person_id AS owner_id, c.id AS child_id, c.given_name AS child
         FROM olympiad_entry e
         JOIN session s ON s.olympiad_entry_id = e.id AND s.status = 'submitted'
         JOIN child c ON c.id = e.child_id
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE e.stage_id = $1 AND e.cancelled_at IS NULL`,
      [stageId],
    );
    for (const o of owners) {
      await this.notify.queue({
        personId: o.owner_id,
        template: 'olympiad_results',
        vars: {
          olympiad: ctx.title_uz,
          stage: STAGE_NAMES[ctx.kind],
          child: o.child,
          link: `${this.config.webOrigin}/uz/family/children/${o.child_id}/olympiad`,
        },
        throttleKey: `olympiad_results:${stageId}:${o.child_id}`,
      });
    }
    await this.audit.write({ action: 'olympiad.results_published', personId: actor.personId, payload: { olympiadId, stageId, families: owners.length } });
    return { published: true, notified: owners.length };
  }

  /** The operator's results table: per region × grade, ranked. Names, never PINFLs. */
  async awards(olympiadId: string) {
    if (!UUID.test(olympiadId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.db.query(
      `SELECT a.id, a.kind::text AS kind, st.kind::text AS "stageKind", a.place, a.amount::float8 AS amount, a.note,
              a.region_id AS "regionId", r.name_uz AS "regionUz", r.name_ru AS "regionRu", a.grade,
              c.given_name || ' ' || initcap(c.family_name) AS "childName", p.full_name AS "educatorName", a.issued_at AS "issuedAt"
         FROM olympiad_award a
    LEFT JOIN olympiad_stage st ON st.id = a.stage_id
    LEFT JOIN region r ON r.id = a.region_id
    LEFT JOIN child c ON c.id = a.child_id
    LEFT JOIN person p ON p.id = a.person_id
        WHERE a.olympiad_id = $1
        ORDER BY a.kind, a.region_id, a.grade, a.place NULLS LAST, a.issued_at`,
      [olympiadId],
    );
  }

  // ============================================================= helpers

  private async stage(olympiadId: string, stageId: string) {
    if (!UUID.test(olympiadId) || !UUID.test(stageId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const s = await this.db.one<{
      kind: StageKind;
      title_uz: string;
      is_ranked: boolean;
      certificate_top_pct: number;
      qualify_top_pct: number;
      mini_final_top_n: number;
      bonus_rate: string;
      cup_top_n: number;
      opens_at: Date;
      results_computed_at: Date | null;
      results_published_at: Date | null;
    }>(
      `SELECT st.kind::text AS kind, o.title_uz, o.is_ranked, o.certificate_top_pct, o.qualify_top_pct, o.mini_final_top_n,
              o.bonus_rate, o.cup_top_n, st.opens_at, st.results_computed_at, st.results_published_at
         FROM olympiad_stage st JOIN olympiad o ON o.id = st.olympiad_id
        WHERE st.id = $1 AND st.olympiad_id = $2`,
      [stageId, olympiadId],
    );
    if (!s) throw new NotFoundException({ error: 'NOT_FOUND' });
    return s;
  }

  /** Submitted sessions of the stage: scored items only, in form order. */
  private async scored(stageId: string): Promise<Scored[]> {
    return this.db.query<Scored>(
      `SELECT e.id AS entry_id, e.child_id, e.region_id, e.grade, s.id AS session_id,
              json_agg(json_build_object('iv', fi.item_version_id, 'ok', COALESCE(r.is_correct, false), 'ms', r.response_ms)
                       ORDER BY fi.position) AS answers
         FROM olympiad_entry e
         JOIN session s ON s.olympiad_entry_id = e.id AND s.status = 'submitted'
         JOIN form_item fi ON fi.form_id = s.form_id AND fi.is_scored
    LEFT JOIN response r ON r.session_id = s.id AND r.item_version_id = fi.item_version_id
        WHERE e.stage_id = $1 AND e.cancelled_at IS NULL
        GROUP BY e.id, s.id`,
      [stageId],
    );
  }

  /**
   * § 12 M7 "response-time cheating signal": on an unsupervised stage, a
   * median answer time under 4 s together with ≥ 80 % correct is flagged for
   * trust & safety (`registration_flag`, the M8 queue). A flag is a question,
   * not a verdict — the result stands until a human decides.
   */
  private async flagFast(client: PoolClient, scored: Scored[]): Promise<number> {
    let n = 0;
    for (const s of scored) {
      const times = s.answers.map((a) => a.ms).filter((ms): ms is number => ms !== null);
      const med = median(times);
      const share = s.answers.filter((a) => a.ok).length / Math.max(1, s.answers.length);
      if (med === null || med >= FAST_MEDIAN_MS || share < FAST_MIN_SHARE_CORRECT) continue;
      const already = await client.query(`SELECT 1 FROM olympiad_entry WHERE id = $1 AND flagged_at IS NOT NULL`, [s.entry_id]);
      if (already.rowCount) {
        n += 1;
        continue;
      }
      await client.query(`UPDATE olympiad_entry SET flagged_at = now() WHERE id = $1`, [s.entry_id]);
      await client.query(
        `INSERT INTO registration_flag (rule_code, subject_child_id, severity, evidence)
         VALUES ('olympiad_fast_answers', $1, 2, $2::jsonb)`,
        [s.child_id, JSON.stringify({ entryId: s.entry_id, sessionId: s.session_id, medianMs: Math.round(med), shareCorrect: Number(share.toFixed(2)) })],
      );
      n += 1;
    }
    return n;
  }

  /**
   * M7-b: per educator, the certificates their LINKED pupils earned at the
   * proctored final — the link active when the final opened, never the
   * educator's own child (§ 8.4.7). One award row per educator.
   */
  private async teacherBonus(client: PoolClient, olympiadId: string, stageId: string, ctx: { bonus_rate: string; opens_at: Date }) {
    const rows = await client.query<{ educator_person_id: string; n: number }>(
      `SELECT el.educator_person_id, count(DISTINCT e.child_id)::int AS n
         FROM olympiad_entry e
         JOIN educator_link el ON el.child_id = e.child_id
                              AND el.status IN ('active', 'expired', 'revoked')
                              AND el.valid_from <= $2 AND el.valid_until > $2
                              AND (el.revoked_at IS NULL OR el.revoked_at > $2)
                              AND NOT el.is_own_child
         JOIN educator_profile ep ON ep.person_id = el.educator_person_id AND ep.status = 'approved'
        WHERE e.stage_id = $1 AND e.cancelled_at IS NULL AND e.certificate_issued_at IS NOT NULL
        GROUP BY el.educator_person_id`,
      [stageId, ctx.opens_at],
    );
    for (const r of rows.rows) {
      await client.query(
        `INSERT INTO olympiad_award (olympiad_id, stage_id, kind, person_id, amount, note)
         VALUES ($1, $2, 'teacher_bonus', $3, $4, $5)`,
        [olympiadId, stageId, r.educator_person_id, Number(ctx.bonus_rate) * r.n, `${r.n} certificate(s) at the final`],
      );
    }
    return { educators: rows.rowCount ?? 0 };
  }

  /**
   * M7-c: the season cup rewards gain. Score = ½ · final percentile + ½ · (final
   * − autumn online percentile), within region × grade, for children who took
   * both. The top N per cohort get the cup; only their families see it.
   */
  private async seasonCup(client: PoolClient, olympiadId: string, stageId: string, topN: number): Promise<number> {
    const rows = await client.query<{ child_id: string; region_id: number; grade: number; fin: number; aut: number }>(
      `SELECT f.child_id, f.region_id, f.grade, f.result_percentile AS fin, a.result_percentile AS aut
         FROM olympiad_entry f
         JOIN olympiad_stage sa ON sa.olympiad_id = $1 AND sa.kind = 'autumn_online'
         JOIN olympiad_entry a ON a.stage_id = sa.id AND a.child_id = f.child_id AND a.cancelled_at IS NULL
                              AND a.result_percentile IS NOT NULL
        WHERE f.stage_id = $2 AND f.cancelled_at IS NULL AND f.result_percentile IS NOT NULL`,
      [olympiadId, stageId],
    );
    const cohorts = new Map<string, { child_id: string; region_id: number; grade: number; cup: number }[]>();
    for (const r of rows.rows) {
      const k = `${r.region_id}:${r.grade}`;
      const cup = 0.5 * r.fin + 0.5 * (r.fin - r.aut);
      cohorts.set(k, [...(cohorts.get(k) ?? []), { child_id: r.child_id, region_id: r.region_id, grade: r.grade, cup }]);
    }
    let n = 0;
    for (const members of cohorts.values()) {
      const top = members.sort((a, b) => b.cup - a.cup).slice(0, topN);
      for (const [i, m] of top.entries()) {
        await this.award(client, olympiadId, stageId, 'season_cup', { childId: m.child_id, place: i + 1, region: m.region_id, grade: m.grade });
        n += 1;
      }
    }
    return n;
  }

  private async award(
    client: PoolClient,
    olympiadId: string,
    stageId: string,
    kind: 'certificate' | 'place' | 'season_cup',
    a: { childId: string; place?: number; region: number; grade: number },
  ) {
    await client.query(
      `INSERT INTO olympiad_award (olympiad_id, stage_id, kind, child_id, place, region_id, grade)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [olympiadId, stageId, kind, a.childId, a.place ?? null, a.region, a.grade],
    );
  }
}
