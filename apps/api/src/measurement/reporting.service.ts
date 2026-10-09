import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ChildAccessResult } from '../authz';
import { COHORT_MINIMUM } from './measurement.math';

/** design/03: three waves taken earn a ticket to the spring final (§ 8.1.6). */
const TICKET_WAVES = 3;

/**
 * task.md § 6 (`reporting`) — the parent report read model, § 8.1.3.
 *
 * Reads ONLY the derived layer of the current run (§ 9: "reports read them";
 * nothing measured inline) plus relationships for "who can see". Must never
 * show what § 1.10 forbids: no score, no other child, no admission chance, no
 * countdown, no item-by-item review. A percentile only as a range, only for
 * grades 3–4 (INV-11), and only to a reader allowed to see one.
 */
@Injectable()
export class ReportingService {
  constructor(private readonly db: DbService) {}

  async report(access: ChildAccessResult, viewerId?: string) {
    const childId = access.childId;
    // M8's "owner never opens reports" rule: one row per viewer per child per day.
    if (viewerId) {
      await this.db.query(
        `INSERT INTO report_view (child_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [childId, viewerId],
      );
    }
    const child = await this.db.one<{ given_name: string; family_name: string; grade: number; region_id: number; region_uz: string; region_ru: string }>(
      `SELECT c.given_name, c.family_name, e.grade, e.school_region_id AS region_id,
              r.name_uz AS region_uz, r.name_ru AS region_ru
         FROM child c
         JOIN LATERAL (SELECT * FROM enrolment e WHERE e.child_id = c.id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
         JOIN region r ON r.id = e.school_region_id
        WHERE c.id = $1 AND c.anonymised_at IS NULL`,
      [childId],
    );
    if (!child) return { template: null, empty: true };

    const season = await this.db.one<{ id: string; code: string }>(`SELECT id, code FROM season WHERE is_current`);
    const run = season
      ? await this.db.one<{ id: string; finished_at: Date }>(
          `SELECT id, finished_at FROM calibration_run
            WHERE season_id = $1 AND grade = $2 AND is_current AND finished_at IS NOT NULL`,
          [season.id, child.grade],
        )
      : null;

    const waves = season
      ? await this.db.query<{ id: string; ordinal: number; opens_at: Date; closes_at: Date; closed_at: Date | null; status: string | null; submitted_at: Date | null }>(
          `SELECT w.id, w.ordinal, w.opens_at, w.closes_at, w.closed_at,
                  s.status, s.submitted_at
             FROM wave w
        LEFT JOIN LATERAL (SELECT * FROM session s WHERE s.wave_id = w.id AND s.child_id = $1
                            AND s.mode = 'monitoring' AND s.status <> 'voided'
                            ORDER BY s.started_at DESC LIMIT 1) s ON true
            WHERE w.season_id = $2 AND w.grade = $3 ORDER BY w.ordinal`,
          [childId, season.id, child.grade],
        )
      : [];
    const next = waves.find((w) => !w.closed_at && w.closes_at > new Date() && w.status !== 'submitted') ?? null;

    const base = {
      child: { givenName: child.given_name, familyName: child.family_name, grade: child.grade },
      season: season?.code ?? null,
      runAt: run?.finished_at ?? null,
      next: next ? { ordinal: next.ordinal, opensAt: next.opens_at, closesAt: next.closes_at, open: next.opens_at <= new Date() } : null,
      access: await this.whoCanSee(childId),
      practiceCount: await this.practiceCount(childId, season?.id ?? null),
      ticket: {
        taken: waves.filter((w) => w.status === 'submitted').length,
        needed: TICKET_WAVES,
      },
    };

    if (child.grade >= 3) return { template: 'grade_3_4' as const, ...base, ...(await this.grade34(access, child, run?.id ?? null, waves)) };
    return { template: 'grade_0_2' as const, ...base, ...(await this.grade02(childId, child.grade, run?.id ?? null, waves)) };
  }

  // ------------------------------------------------------------ grades 3–4

  private async grade34(
    access: ChildAccessResult,
    child: { region_uz: string; region_ru: string },
    runId: string | null,
    waves: { id: string; ordinal: number; opens_at: Date; closes_at: Date; closed_at: Date | null; status: string | null }[],
  ) {
    const bands = runId
      ? await this.db.query<{ wave_id: string; pct_low: number | null; pct_high: number | null; cohort_n: number; region_uz: string; region_ru: string }>(
          `SELECT b.wave_id, b.pct_low, b.pct_high, b.cohort_n, r.name_uz AS region_uz, r.name_ru AS region_ru
             FROM percentile_band b JOIN region r ON r.id = b.region_id
            WHERE b.calibration_run_id = $1 AND b.child_id = $2`,
          [runId, access.childId],
        )
      : [];
    const byWave = new Map(bands.map((b) => [b.wave_id, b]));
    // "Top 11–19%" is the band read from the other end; never a single number.
    const top = (b: { pct_low: number | null; pct_high: number | null } | undefined) =>
      b && b.pct_low !== null && b.pct_high !== null && access.canSeePercentile
        ? { from: Math.max(1, 100 - b.pct_high), to: Math.max(1, 100 - b.pct_low) }
        : null;

    const trend = waves.map((w) => {
      const b = byWave.get(w.id);
      return {
        waveId: w.id,
        ordinal: w.ordinal,
        opensAt: w.opens_at,
        // taken | measuring (closed, run pending) | not_taken | upcoming | open
        state: b
          ? 'measured'
          : w.status === 'submitted'
            ? 'awaiting'
            : w.closed_at || w.closes_at <= new Date()
              ? 'not_taken'
              : w.opens_at <= new Date()
                ? 'open'
                : 'upcoming',
        top: top(b),
        belowMinimum: !!b && b.pct_low === null,
        cohortN: b?.cohort_n ?? null,
      };
    });
    const measured = trend.filter((t) => t.state === 'measured');
    const latest = measured[measured.length - 1] ?? null;
    if (!latest) return { empty: true, trend };

    const latestBand = byWave.get(latest.waveId)!;
    const summary = await this.summaries(runId!, access.childId);
    const latestSummary = summary.find((s) => s.wave_id === latest.waveId);

    return {
      empty: false,
      // A parent sees the band; an educator only for their own child (§ 3).
      canSeePercentile: access.canSeePercentile,
      latest: {
        waveId: latest.waveId,
        ordinal: latest.ordinal,
        top: latest.top,
        cohortN: latestBand.cohort_n,
        cohortMinimum: COHORT_MINIMUM,
        belowMinimum: latestBand.pct_low === null,
        regionUz: latestBand.region_uz ?? child.region_uz,
        regionRu: latestBand.region_ru ?? child.region_ru,
      },
      trend,
      clusters: latestSummary?.clusters ?? {},
      pattern: await this.misconception(latestSummary?.dominant_misconception ?? null),
      seasonPattern: await this.seasonPattern(summary),
    };
  }

  // ------------------------------------------------------------ grades 0–2

  private async grade02(
    childId: string,
    grade: number,
    runId: string | null,
    waves: { id: string; ordinal: number; opens_at: Date }[],
  ) {
    const skills = await this.db.query<{ code: string; name_uz: string; name_ru: string; topic_code: string; cluster: string }>(
      `SELECT s.code, s.name_uz, s.name_ru, s.topic_code, t.cluster::text AS cluster
         FROM skill s JOIN topic t ON t.code = s.topic_code WHERE s.grade = $1 ORDER BY t.sort, s.code`,
      [grade],
    );
    const states = runId
      ? await this.db.query<{ skill_code: string; wave_id: string; state: string; correct_count: number; seen_count: number }>(
          `SELECT skill_code, wave_id, state::text, correct_count, seen_count
             FROM skill_state WHERE calibration_run_id = $1 AND child_id = $2`,
          [runId, childId],
        )
      : [];
    if (states.length === 0) return { empty: true, skillsTotal: skills.length };

    const ordinalOf = new Map(waves.map((w) => [w.id, w]));
    const list = skills.map((sk) => {
      const history = states
        .filter((s) => s.skill_code === sk.code)
        .map((s) => ({
          waveOrdinal: ordinalOf.get(s.wave_id)?.ordinal ?? 0,
          opensAt: ordinalOf.get(s.wave_id)?.opens_at ?? null,
          state: s.state,
          correct: s.correct_count,
          seen: s.seen_count,
        }))
        .sort((a, b) => a.waveOrdinal - b.waveOrdinal);
      const last = history[history.length - 1];
      const firstSecure = history.find((h) => h.state === 'secure');
      return {
        code: sk.code,
        nameUz: sk.name_uz,
        nameRu: sk.name_ru,
        topicCode: sk.topic_code,
        cluster: sk.cluster,
        state: last?.state ?? null, // null = not assessed yet this season
        history,
        securedAtWave: firstSecure?.waveOrdinal ?? null,
      };
    });
    const count = (st: string | null) => list.filter((l) => l.state === st).length;
    const lastWave = Math.max(...list.flatMap((l) => l.history.map((h) => h.waveOrdinal)));
    // "New since …": skills first confirmed in the last two measured waves.
    const newlySecure = list
      .filter((l) => l.securedAtWave !== null && l.securedAtWave >= lastWave - 1)
      .map((l) => ({ code: l.code, nameUz: l.nameUz, nameRu: l.nameRu, waveOrdinal: l.securedAtWave }));
    // One play-based action: the emerging skill seen most — where help pays off most (design/04).
    const focus = list
      .filter((l) => l.state === 'emerging')
      .sort((a, b) => b.history.reduce((x, h) => x + h.seen, 0) - a.history.reduce((x, h) => x + h.seen, 0))[0];

    return {
      empty: false,
      skillsTotal: skills.length,
      counts: { secure: count('secure'), emerging: count('emerging'), notYet: count('not_yet'), unassessed: count(null) },
      skills: list,
      newlySecure,
      focus: focus ? { code: focus.code, nameUz: focus.nameUz, nameRu: focus.nameRu, cluster: focus.cluster } : null,
      // design/04 "What we don't do": an explicit refusal, not an omission.
      forecast: null,
    };
  }

  // ------------------------------------------------------------- helpers

  private async summaries(runId: string, childId: string) {
    return this.db.query<{ wave_id: string; clusters: Record<string, string>; misconceptions: Record<string, number>; dominant_misconception: string | null }>(
      `SELECT wave_id, clusters, misconceptions, dominant_misconception
         FROM child_wave_summary WHERE calibration_run_id = $1 AND child_id = $2`,
      [runId, childId],
    );
  }

  private async misconception(code: string | null) {
    if (!code) return null;
    return this.db.one<{ code: string; nameUz: string; nameRu: string; explainUz: string; explainRu: string }>(
      `SELECT code, name_uz AS "nameUz", name_ru AS "nameRu", explain_uz AS "explainUz", explain_ru AS "explainRu"
         FROM misconception WHERE code = $1`,
      [code],
    );
  }

  /** design/03 "Across the season": the misconception seen in the most waves, if in ≥ 2. */
  private async seasonPattern(summary: { misconceptions: Record<string, number> }[]) {
    const waves: Record<string, number> = {};
    for (const s of summary) for (const code of Object.keys(s.misconceptions ?? {})) waves[code] = (waves[code] ?? 0) + 1;
    const top = Object.entries(waves).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!top || top[1] < 2) return null;
    const m = await this.misconception(top[0]);
    return m ? { ...m, waves: top[1], of: summary.length } : null;
  }

  /** design/03 "Who can see": guardians and educators with an active link — names only. */
  private async whoCanSee(childId: string) {
    const guardians = await this.db.query<{ name: string; role: string }>(
      `SELECT p.full_name AS name, g.role::text AS role FROM guardianship g JOIN person p ON p.id = g.person_id
        WHERE g.child_id = $1 AND g.revoked_at IS NULL ORDER BY (g.role = 'owner') DESC, g.granted_at`,
      [childId],
    );
    const educators = await this.db.query<{ name: string; validUntil: Date }>(
      `SELECT p.full_name AS name, v.valid_until AS "validUntil"
         FROM v_educator_visible_child v JOIN person p ON p.id = v.educator_person_id
        WHERE v.child_id = $1 AND NOT v.is_own_child`,
      [childId],
    );
    return { guardians, educators };
  }

  /** § 1.11: practice shows only how many — and it never feeds the scale. */
  private async practiceCount(childId: string, seasonId: string | null): Promise<number> {
    const row = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM session
        WHERE child_id = $1 AND mode = 'practice' AND status = 'submitted'
          AND started_at >= COALESCE((SELECT starts_on FROM season WHERE id = $2), '1970-01-01')`,
      [childId, seasonId],
    );
    return row?.n ?? 0;
  }
}
