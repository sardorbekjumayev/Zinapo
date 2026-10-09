import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CasesService } from './cases.service';

const TICK_MS = 15 * 60_000;
/** After a human decided a flag, the same rule and subject stay quiet this long. */
export const QUIET_DAYS = 30;

/**
 * The four rules of § 8.5, with the thresholds decided with the product
 * owner (task.md note M8-a). Each returns candidates; the job turns each into
 * ONE open `registration_flag` per (rule, subject) — the partial unique index
 * makes a second run a no-op — and a `fraud_flag` review case.
 *
 * A flag is a question for a human, never a verdict: nothing here blocks,
 * suspends or hides anything (§ 8.5 "Never block silently").
 *
 * Evidence never carries a PINFL (INV-06) — ids, names, counts and times.
 */
export const RULES = {
  /** ≥ 3 different people add a child from one device (IP + browser) within 2 h. */
  many_owners_one_device: { owners: 3, windowHours: 2 },
  /** In one educator group, one owner holds ≥ 3 children with different surnames. */
  surname_mismatch_group: { children: 3 },
  /** A child took ≥ 3 waves this season and no guardian ever opened a report. */
  owner_never_opens_reports: { waves: 3 },
  /** An educator makes ≥ 10 match-checks in 1 h, or ≥ 15 misses in 24 h. */
  match_check_bursts: { perHour: 10, missesPerDay: 15 },
} as const;

export type RuleCode = keyof typeof RULES | 'olympiad_fast_answers';

interface Candidate {
  rule: RuleCode;
  personId: string | null;
  childId: string | null;
  severity: number;
  evidence: Record<string, unknown>;
}

@Injectable()
export class FraudRulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FraudRulesService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly cases: CasesService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Run every rule, record new flags, open a case for every flag that has none (M7's olympiad flags too). */
  async tick(): Promise<{ flagged: number; cases: number }> {
    if (this.running) return { flagged: 0, cases: 0 };
    this.running = true;
    try {
      const candidates = [
        ...(await this.manyOwnersOneDevice()),
        ...(await this.surnameMismatchGroup()),
        ...(await this.ownerNeverOpensReports()),
        ...(await this.pinflCheckBursts()),
      ];
      let flagged = 0;
      for (const c of candidates) {
        // A human already looked at this rule for this subject in the last
        // 30 days (dismissed or confirmed): the same pattern is not news.
        const row = await this.db.one<{ id: string }>(
          `INSERT INTO registration_flag (rule_code, subject_person_id, subject_child_id, severity, evidence)
           SELECT $1, $2, $3, $4, $5::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM registration_flag f
                               WHERE f.rule_code = $1
                                 AND f.subject_person_id IS NOT DISTINCT FROM $2::uuid
                                 AND f.subject_child_id IS NOT DISTINCT FROM $3::uuid
                                 AND f.resolved_at > now() - make_interval(days => $6))
           ON CONFLICT DO NOTHING RETURNING id`,
          [c.rule, c.personId, c.childId, c.severity, JSON.stringify(c.evidence), QUIET_DAYS],
        );
        if (row) flagged += 1;
      }
      const orphans = await this.db.query<{ id: string; rule_code: string; subject_person_id: string | null; subject_child_id: string | null; evidence: Record<string, unknown> }>(
        `SELECT f.id, f.rule_code, f.subject_person_id, f.subject_child_id, f.evidence
           FROM registration_flag f
          WHERE f.resolved_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM review_case c WHERE c.registration_flag_id = f.id)
          ORDER BY f.id LIMIT 500`,
      );
      for (const f of orphans) {
        await this.cases.open({
          kind: 'fraud_flag',
          subjectPersonId: f.subject_person_id,
          subjectChildId: f.subject_child_id,
          registrationFlagId: Number(f.id),
          payload: { rule: f.rule_code, educatorId: (f.evidence.educatorId as string | undefined) ?? null },
        });
      }
      if (flagged || orphans.length) this.logger.log(`fraud rules: ${flagged} new flag(s), ${orphans.length} case(s) opened`);
      return { flagged, cases: orphans.length };
    } finally {
      this.running = false;
    }
  }

  // =============================================================== rules

  /** Read from the audit log: `child.created` carries the device since M8. */
  private async manyOwnersOneDevice(): Promise<Candidate[]> {
    const r = RULES.many_owners_one_device;
    const rows = await this.db.query<{ ip: string; ua: string; people: string[]; children: string[]; first_at: Date; last_at: Date }>(
      `WITH c AS (
         SELECT a.person_id, a.payload->>'childId' AS child_id, host(a.ip) AS ip, a.user_agent AS ua, a.created_at
           FROM audit_log a
          WHERE a.action = 'child.created' AND a.ip IS NOT NULL AND a.user_agent IS NOT NULL
            AND a.created_at > now() - interval '7 days')
       SELECT x.ip, x.ua, array_agg(DISTINCT y.person_id::text) AS people, array_agg(DISTINCT y.child_id) AS children,
              min(y.created_at) AS first_at, max(y.created_at) AS last_at
         FROM c x JOIN c y ON y.ip = x.ip AND y.ua = x.ua
                         AND y.created_at BETWEEN x.created_at AND x.created_at + make_interval(hours => $1)
        GROUP BY x.ip, x.ua, x.created_at
       HAVING count(DISTINCT y.person_id) >= $2`,
      [r.windowHours, r.owners],
    );
    // One flag per device: the widest window found.
    const byDevice = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const k = `${row.ip}|${row.ua}`;
      if (!byDevice.has(k) || byDevice.get(k)!.people.length < row.people.length) byDevice.set(k, row);
    }
    return [...byDevice.values()].map((row) => ({
      rule: 'many_owners_one_device' as const,
      // The subject is the newest owner; every owner is in the evidence.
      personId: row.people[row.people.length - 1],
      childId: null,
      severity: 2,
      evidence: {
        owners: row.people.length,
        personIds: row.people,
        childIds: row.children,
        device: { ip: row.ip, userAgent: row.ua.slice(0, 160) },
        from: row.first_at,
        to: row.last_at,
        windowHours: r.windowHours,
      },
    }));
  }

  private async surnameMismatchGroup(): Promise<Candidate[]> {
    const rows = await this.db.query<{ group_id: string; group_name: string; educator_id: string; owner_id: string; children: string[]; surnames: string[] }>(
      `SELECT tg.id AS group_id, tg.name AS group_name, tg.educator_person_id AS educator_id, g.person_id AS owner_id,
              array_agg(DISTINCT c.id::text) AS children, array_agg(DISTINCT upper(c.family_name)) AS surnames
         FROM teaching_group tg
         JOIN group_member gm ON gm.group_id = tg.id
         JOIN child c ON c.id = gm.child_id AND c.anonymised_at IS NULL
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE tg.archived_at IS NULL
        GROUP BY tg.id, g.person_id
       HAVING count(DISTINCT c.id) >= $1 AND count(DISTINCT upper(c.family_name)) >= $1`,
      [RULES.surname_mismatch_group.children],
    );
    return rows.map((r) => ({
      rule: 'surname_mismatch_group' as const,
      // The educator is the subject: the pattern is about whose group it is.
      personId: r.educator_id,
      childId: null,
      severity: 2,
      evidence: { groupId: r.group_id, groupName: r.group_name, educatorId: r.educator_id, ownerId: r.owner_id, childIds: r.children, surnames: r.surnames.length },
    }));
  }

  private async ownerNeverOpensReports(): Promise<Candidate[]> {
    const rows = await this.db.query<{ child_id: string; owner_id: string; waves: number; educator_id: string | null; launched_by_other: number }>(
      `SELECT s.child_id, g.person_id AS owner_id, count(DISTINCT s.wave_id)::int AS waves,
              (SELECT el.educator_person_id FROM educator_link el
                WHERE el.child_id = s.child_id AND el.status IN ('active', 'suspended') ORDER BY el.requested_at DESC LIMIT 1) AS educator_id,
              count(*) FILTER (WHERE s.launched_by <> g.person_id)::int AS launched_by_other
         FROM session s
         JOIN wave w ON w.id = s.wave_id
         JOIN season se ON se.id = w.season_id AND se.is_current
         JOIN guardianship g ON g.child_id = s.child_id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE s.mode = 'monitoring' AND s.status = 'submitted'
          AND NOT EXISTS (SELECT 1 FROM report_view rv WHERE rv.child_id = s.child_id)
        GROUP BY s.child_id, g.person_id
       HAVING count(DISTINCT s.wave_id) >= $1`,
      [RULES.owner_never_opens_reports.waves],
    );
    return rows.map((r) => ({
      rule: 'owner_never_opens_reports' as const,
      personId: r.owner_id,
      childId: r.child_id,
      severity: 1,
      evidence: { waves: r.waves, launchedByOthers: r.launched_by_other, educatorId: r.educator_id },
    }));
  }

  private async pinflCheckBursts(): Promise<Candidate[]> {
    const r = RULES.match_check_bursts;
    const rows = await this.db.query<{ educator_id: string; max_hour: number; misses_day: number }>(
      `SELECT l.educator_person_id AS educator_id,
              (SELECT max(n) FROM (SELECT count(*) AS n FROM pinfl_check_log l2
                                    WHERE l2.educator_person_id = l.educator_person_id AND l2.created_at > now() - interval '24 hours'
                                    GROUP BY date_trunc('hour', l2.created_at)) h)::int AS max_hour,
              count(*) FILTER (WHERE NOT l.matched)::int AS misses_day
         FROM pinfl_check_log l
        WHERE l.created_at > now() - interval '24 hours'
        GROUP BY l.educator_person_id`,
    );
    return rows
      .filter((x) => x.max_hour >= r.perHour || x.misses_day >= r.missesPerDay)
      .map((x) => ({
        rule: 'match_check_bursts' as const,
        personId: x.educator_id,
        childId: null,
        severity: x.misses_day >= r.missesPerDay ? 3 : 2,
        evidence: { educatorId: x.educator_id, maxChecksInAnHour: x.max_hour, missesIn24h: x.misses_day },
      }));
  }
}
