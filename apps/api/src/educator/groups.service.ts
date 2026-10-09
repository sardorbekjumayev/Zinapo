import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor } from '../authz';
import { tashkentDay } from './educator.util';

/**
 * Progress between two measured waves, as a category — never a number.
 *
 * Decided with the product owner (task.md M6-a): an educator sees no
 * percentile (§ 3, rule 1.9), so the gain behind the sort stays on the server.
 * Grades 3–4: the change in the percentile band's midpoint, in points —
 * "moved up" from +3, "worth a look" from −5 (design/08's bands; a smaller
 * change is inside the measurement error). Grades 0–2: the change in how many
 * skills are secure.
 */
export type GainCategory = 'up' | 'flat' | 'look' | 'first' | 'not_taken';
export const GAIN_UP = 3;
export const GAIN_LOOK = -5;

interface Member {
  child_id: string;
  given_name: string;
  family_name: string;
  grade: number | null;
  valid_until: Date;
}

interface WaveRow {
  id: string;
  ordinal: number;
  opens_at: Date;
  closes_at: Date;
  state: 'open' | 'closed' | 'upcoming';
}

/**
 * task.md § 8.4.3–5 — groups (organisation only), the group overview and the
 * pupil view.
 *
 * INV-15 everywhere: every child read goes through `v_educator_visible_child`.
 * `group_member` only says how the educator ARRANGED children they can already
 * see; a member whose link ended simply drops out of every list.
 *
 * The educator's own child (`is_own_child`) is left out of the group overview
 * and its statistics (§ 8.4.7); they see that child in "My children" instead.
 */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  // ============================================================== groups

  async list(actor: Actor) {
    const groups = await this.db.query<{ id: string; name: string; grade: number | null; note: string | null; created_at: Date; members: number }>(
      `SELECT tg.id, tg.name, tg.grade, tg.note, tg.created_at,
              (SELECT count(*)::int FROM group_member gm
                 JOIN v_educator_visible_child v ON v.child_id = gm.child_id AND v.educator_person_id = tg.educator_person_id
                WHERE gm.group_id = tg.id AND NOT v.is_own_child) AS members
         FROM teaching_group tg
        WHERE tg.educator_person_id = $1 AND tg.archived_at IS NULL
        ORDER BY tg.grade DESC NULLS LAST, tg.created_at`,
      [actor.personId],
    );
    const ungrouped = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM v_educator_visible_child v
        WHERE v.educator_person_id = $1 AND NOT v.is_own_child
          AND NOT EXISTS (SELECT 1 FROM group_member gm JOIN teaching_group tg ON tg.id = gm.group_id
                           WHERE gm.child_id = v.child_id AND tg.educator_person_id = $1 AND tg.archived_at IS NULL)`,
      [actor.personId],
    );
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, grade: g.grade, note: g.note, createdAt: g.created_at, memberCount: g.members })),
      ungroupedCount: ungrouped?.n ?? 0,
    };
  }

  /** Creating a group whose name is already in use returns that group: a double click is not two groups. */
  async create(actor: Actor, name: string, grade: number | null, note: string | null) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw new BadRequestException({ error: 'NAME_REQUIRED' });
    const existing = await this.db.one<{ id: string }>(
      `SELECT id FROM teaching_group WHERE educator_person_id = $1 AND archived_at IS NULL AND lower(name) = lower($2)`,
      [actor.personId, clean],
    );
    if (existing) return { id: existing.id, created: false };
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO teaching_group (educator_person_id, name, grade, note) VALUES ($1, $2, $3, $4) RETURNING id`,
      [actor.personId, clean, grade, note],
    );
    await this.audit.write({ action: 'educator.group_changed', personId: actor.personId, payload: { groupId: row!.id, created: true } });
    return { id: row!.id, created: true };
  }

  async update(actor: Actor, groupId: string, patch: { name?: string; grade?: number | null; note?: string | null; archived?: boolean }) {
    await this.own(actor, groupId);
    if (patch.name !== undefined && !patch.name.trim()) throw new BadRequestException({ error: 'NAME_REQUIRED' });
    await this.db.query(
      `UPDATE teaching_group
          SET name = COALESCE($2, name),
              grade = CASE WHEN $3::boolean THEN $4::smallint ELSE grade END,
              note = CASE WHEN $5::boolean THEN $6 ELSE note END,
              archived_at = CASE WHEN $7::boolean THEN now() ELSE archived_at END
        WHERE id = $1`,
      [
        groupId,
        patch.name?.trim().replace(/\s+/g, ' ') ?? null,
        patch.grade !== undefined,
        patch.grade ?? null,
        patch.note !== undefined,
        patch.note ?? null,
        !!patch.archived,
      ],
    );
    await this.audit.write({ action: 'educator.group_changed', personId: actor.personId, payload: { groupId, archived: !!patch.archived } });
    return { ok: true };
  }

  /**
   * Arrange children the educator can ALREADY see. A child without an active
   * link is skipped, not an error: the result says how many were placed.
   * A group with a grade takes only children in that grade.
   */
  async addMembers(actor: Actor, groupId: string, childIds: string[]) {
    const group = await this.own(actor, groupId);
    const rows = await this.db.query<{ child_id: string }>(
      `INSERT INTO group_member (group_id, child_id)
       SELECT $1, v.child_id
         FROM v_educator_visible_child v
         JOIN LATERAL (SELECT e.grade FROM enrolment e WHERE e.child_id = v.child_id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
        WHERE v.educator_person_id = $2 AND v.child_id = ANY($3::uuid[])
          AND ($4::smallint IS NULL OR e.grade = $4)
       ON CONFLICT DO NOTHING
       RETURNING child_id`,
      [groupId, actor.personId, childIds, group.grade],
    );
    await this.audit.write({ action: 'educator.group_changed', personId: actor.personId, payload: { groupId, added: rows.length } });
    return { added: rows.length, skipped: childIds.length - rows.length };
  }

  async removeMember(actor: Actor, groupId: string, childId: string) {
    await this.own(actor, groupId);
    await this.db.query(`DELETE FROM group_member WHERE group_id = $1 AND child_id = $2`, [groupId, childId]);
    await this.audit.write({ action: 'educator.group_changed', personId: actor.personId, payload: { groupId, removed: 1 } });
    return { ok: true };
  }

  /** Every child this educator can see, with their groups — the "add to group" picker. */
  async children(actor: Actor) {
    const rows = await this.db.query<{
      id: string;
      given_name: string;
      family_name: string;
      grade: number | null;
      valid_until: Date;
      is_own_child: boolean;
      groups: { id: string; name: string }[] | null;
    }>(
      `SELECT c.id, c.given_name, initcap(c.family_name) AS family_name, e.grade, v.valid_until, v.is_own_child,
              (SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name) ORDER BY tg.name)
                 FROM group_member gm JOIN teaching_group tg ON tg.id = gm.group_id
                WHERE gm.child_id = c.id AND tg.educator_person_id = v.educator_person_id AND tg.archived_at IS NULL) AS groups
         FROM v_educator_visible_child v
         JOIN child c ON c.id = v.child_id AND c.anonymised_at IS NULL
    LEFT JOIN LATERAL (SELECT e.grade FROM enrolment e WHERE e.child_id = c.id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
        WHERE v.educator_person_id = $1
        ORDER BY e.grade DESC NULLS LAST, c.family_name, c.given_name`,
      [actor.personId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: `${r.given_name} ${r.family_name}`,
      givenName: r.given_name,
      grade: r.grade,
      accessUntil: r.valid_until,
      isOwnChild: r.is_own_child,
      groups: r.groups ?? [],
    }));
  }

  /**
   * § 8.4.7 "My children": the educator's own kids — through GUARDIANSHIP, the
   * parent relationship, not a link. They open the full parent report.
   */
  async myChildren(actor: Actor) {
    return this.db.query(
      `SELECT c.id, c.given_name || ' ' || initcap(c.family_name) AS name, c.given_name AS "givenName", e.grade,
              g.role::text AS role
         FROM guardianship g
         JOIN child c ON c.id = g.child_id AND c.anonymised_at IS NULL
    LEFT JOIN LATERAL (SELECT e.grade FROM enrolment e WHERE e.child_id = c.id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
        WHERE g.person_id = $1 AND g.revoked_at IS NULL
        ORDER BY c.dob`,
      [actor.personId],
    );
  }

  // ============================================================ overview

  /**
   * design/08: one wave, the group's children SORTED BY GAIN (no level sort),
   * the common mistakes, and who has not taken the wave yet.
   *
   * Two waves are in play: `wave` (the selected one — by default the open
   * wave, or the latest) decides "taken / not taken" and the mistakes;
   * progress compares the latest MEASURED wave up to it with the measured
   * wave before. An open wave is not measured until it closes (M5), so while
   * wave 4 is open the gain list shows wave 2 → 3.
   */
  async overview(actor: Actor, groupId: string, waveId?: string) {
    const group = await this.own(actor, groupId);
    const members = await this.members(actor, groupId);
    const grade = group.grade ?? mostCommon(members.map((m) => m.grade).filter((g): g is number => g !== null));

    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    const waves = grade === null || !season ? [] : await this.waves(season.id, grade);
    const selected =
      (waveId && waves.find((w) => w.id === waveId)) ||
      waves.find((w) => w.state === 'open') ||
      [...waves].reverse().find((w) => w.state === 'closed') ||
      waves[0] ||
      null;

    const ids = members.map((m) => m.child_id);
    const submitted = selected
      ? await this.db.query<{ child_id: string }>(
          `SELECT child_id FROM session WHERE wave_id = $1 AND mode = 'monitoring' AND status = 'submitted'
              AND child_id = ANY($2::uuid[])`,
          [selected.id, ids],
        )
      : [];
    const started = selected
      ? await this.db.query<{ child_id: string }>(
          `SELECT child_id FROM session WHERE wave_id = $1 AND mode = 'monitoring' AND status = 'started'
              AND child_id = ANY($2::uuid[])`,
          [selected.id, ids],
        )
      : [];
    const took = new Set(submitted.map((r) => r.child_id));
    const inProgress = new Set(started.map((r) => r.child_id));

    const progress = selected && season && grade !== null
      ? await this.progress(season.id, grade, waves, selected, ids)
      : { from: null, to: null, byChild: new Map<string, { category: GainCategory; gain: number }>() };

    const rows = members
      .map((m) => {
        const p = progress.byChild.get(m.child_id) ?? { category: 'not_taken' as GainCategory, gain: Number.NEGATIVE_INFINITY };
        return { m, p };
      })
      // Sorted by gain, never by level (§ 8.4.4). Ties and unknowns by name.
      .sort((a, b) => b.p.gain - a.p.gain || a.m.given_name.localeCompare(b.m.given_name));

    const reminded = selected?.state === 'open' ? await this.remindedToday(selected.id, ids) : new Set<string>();

    return {
      group: { id: group.id, name: group.name, grade },
      waves: waves.map((w) => ({ id: w.id, ordinal: w.ordinal, opensAt: w.opens_at, closesAt: w.closes_at, state: w.state })),
      wave: selected
        ? { id: selected.id, ordinal: selected.ordinal, state: selected.state, closesAt: selected.closes_at, opensAt: selected.opens_at }
        : null,
      progressWaves: { from: progress.from, to: progress.to },
      stats: {
        total: members.length,
        took: members.filter((m) => took.has(m.child_id)).length,
        up: rows.filter((r) => r.p.category === 'up').length,
        flat: rows.filter((r) => r.p.category === 'flat').length,
        look: rows.filter((r) => r.p.category === 'look').length,
      },
      children: rows.map(({ m, p }) => ({
        id: m.child_id,
        name: `${m.given_name} ${m.family_name}`,
        givenName: m.given_name,
        progress: p.category,
        tookSelectedWave: took.has(m.child_id),
        accessUntil: m.valid_until,
      })),
      misconceptions: selected ? await this.commonMistakes(selected.id, ids) : [],
      notTaken: members
        .filter((m) => !took.has(m.child_id))
        .map((m) => ({
          id: m.child_id,
          name: `${m.given_name} ${m.family_name}`,
          givenName: m.given_name,
          inProgress: inProgress.has(m.child_id),
          remindedToday: reminded.has(m.child_id),
        })),
      canRemind: selected?.state === 'open',
      ownChildExcluded: await this.ownChildInGroup(actor, groupId),
    };
  }

  /**
   * design/08 "Remind parent" / "Remind all": `wave_reminder` to the owner of
   * each child who has not taken the OPEN wave. § 10's limit is the
   * notification throttle key — one reminder per wave per child per day, from
   * anyone — so a second press the same day is a no-op, not a second SMS.
   * Children never receive anything.
   */
  async remind(actor: Actor, groupId: string, childIds?: string[]) {
    const group = await this.own(actor, groupId);
    const members = await this.members(actor, groupId);
    const grade = group.grade ?? mostCommon(members.map((m) => m.grade).filter((g): g is number => g !== null));
    if (grade === null) return { reminded: 0, alreadyToday: 0 };

    const wave = await this.db.one<{ id: string; ordinal: number; closes_at: Date }>(
      `SELECT w.id, w.ordinal, w.closes_at FROM wave w JOIN season s ON s.id = w.season_id AND s.is_current
        WHERE w.grade = $1 AND w.opens_at <= now() AND w.closes_at > now() AND w.closed_at IS NULL
        ORDER BY w.ordinal LIMIT 1`,
      [grade],
    );
    if (!wave) throw new ConflictException({ error: 'NO_OPEN_WAVE' });

    const wanted = childIds?.length ? new Set(childIds) : null;
    const targets = await this.db.query<{ child_id: string; given_name: string; owner_id: string }>(
      `SELECT c.id AS child_id, c.given_name, g.person_id AS owner_id
         FROM child c JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE c.id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM session s WHERE s.child_id = c.id AND s.wave_id = $2
                           AND s.mode = 'monitoring' AND s.status = 'submitted')`,
      [members.filter((m) => !wanted || wanted.has(m.child_id)).map((m) => m.child_id), wave.id],
    );

    let reminded = 0;
    for (const t of targets) {
      const id = await this.notify.queue({
        personId: t.owner_id,
        template: 'wave_reminder',
        vars: { child: t.given_name, wave: `${wave.ordinal}-monitoring`, closes: wave.closes_at.toISOString(), link: `${this.config.webOrigin}/uz/family/children/${t.child_id}` },
        throttleKey: `wave_reminder:${wave.id}:${t.child_id}:${tashkentDay()}`,
      });
      if (id) reminded += 1;
    }
    if (reminded) {
      await this.audit.write({ action: 'educator.reminders_sent', personId: actor.personId, payload: { groupId, waveId: wave.id, count: reminded } });
    }
    return { reminded, alreadyToday: targets.length - reminded };
  }

  // =============================================================== pupil

  /**
   * § 8.4.5 the pupil view: per wave taken / progress, the dominant mistake,
   * when access ends. No percentile, no score, no item answers — even for the
   * educator's own child, whose full report lives in "My children".
   */
  async pupil(actor: Actor, childId: string, canSeePercentile: boolean) {
    const child = await this.db.one<{ given_name: string; family_name: string; grade: number | null; valid_until: Date; is_own_child: boolean }>(
      `SELECT c.given_name, initcap(c.family_name) AS family_name, e.grade, v.valid_until, v.is_own_child
         FROM v_educator_visible_child v
         JOIN child c ON c.id = v.child_id
    LEFT JOIN LATERAL (SELECT e.grade FROM enrolment e WHERE e.child_id = c.id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
        WHERE v.child_id = $1 AND v.educator_person_id = $2`,
      [childId, actor.personId],
    );
    if (!child) throw new NotFoundException({ error: 'NOT_FOUND' });

    const groups = await this.db.query<{ id: string; name: string }>(
      `SELECT tg.id, tg.name FROM group_member gm JOIN teaching_group tg ON tg.id = gm.group_id
        WHERE gm.child_id = $1 AND tg.educator_person_id = $2 AND tg.archived_at IS NULL ORDER BY tg.name`,
      [childId, actor.personId],
    );
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    const waves = child.grade === null || !season ? [] : await this.waves(season.id, child.grade);
    const taken = new Set(
      (
        await this.db.query<{ wave_id: string }>(
          `SELECT wave_id FROM session WHERE child_id = $1 AND mode = 'monitoring' AND status = 'submitted'`,
          [childId],
        )
      ).map((r) => r.wave_id),
    );

    // Progress at each measured wave against the measured wave before it.
    const perWave = new Map<string, GainCategory>();
    if (season && child.grade !== null) {
      const closed = waves.filter((w) => w.state === 'closed');
      for (const w of closed) {
        const p = await this.progress(season.id, child.grade, waves, w, [childId]);
        // `progress` steps back to the latest MEASURED wave; only keep it if that is this one.
        if (p.to === w.ordinal) perWave.set(w.id, p.byChild.get(childId)?.category ?? 'not_taken');
      }
    }

    const dominant = await this.db.one<{ code: string; name_uz: string; name_ru: string; explain_uz: string; explain_ru: string; ordinal: number }>(
      `SELECT m.code, m.name_uz, m.name_ru, m.explain_uz, m.explain_ru, w.ordinal
         FROM child_wave_summary s
         JOIN calibration_run r ON r.id = s.calibration_run_id AND r.is_current
         JOIN wave w ON w.id = s.wave_id
         JOIN misconception m ON m.code = s.dominant_misconception
        WHERE s.child_id = $1 AND r.season_id = $2
        ORDER BY w.ordinal DESC LIMIT 1`,
      [childId, season?.id ?? null],
    );
    const practice = await this.db.one<{ assigned: number; done: number }>(
      `SELECT count(*)::int AS assigned,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s WHERE s.assignment_id = pac.assignment_id
                                              AND s.child_id = pac.child_id AND s.status = 'submitted'))::int AS done
         FROM practice_assignment_child pac JOIN practice_assignment pa ON pa.id = pac.assignment_id
        WHERE pac.child_id = $1 AND pa.educator_person_id = $2`,
      [childId, actor.personId],
    );

    const latest = [...waves].reverse().find((w) => perWave.has(w.id));
    return {
      child: { id: childId, name: `${child.given_name} ${child.family_name}`, givenName: child.given_name, grade: child.grade },
      isOwnChild: child.is_own_child,
      // The one case an educator may see a percentile (§ 3) — and then they
      // read the PARENT report, which they open as the parent.
      parentReportAvailable: canSeePercentile,
      accessUntil: child.valid_until,
      groups,
      waves: waves.map((w) => ({
        id: w.id,
        ordinal: w.ordinal,
        state: w.state,
        closesAt: w.closes_at,
        taken: taken.has(w.id),
        progress: perWave.get(w.id) ?? null,
      })),
      latestProgress: latest ? { waveOrdinal: latest.ordinal, category: perWave.get(latest.id)! } : null,
      dominantMisconception: dominant
        ? { code: dominant.code, nameUz: dominant.name_uz, nameRu: dominant.name_ru, explainUz: dominant.explain_uz, explainRu: dominant.explain_ru, waveOrdinal: dominant.ordinal }
        : null,
      practice: { assigned: practice?.assigned ?? 0, done: practice?.done ?? 0 },
    };
  }

  // ============================================================= helpers

  async own(actor: Actor, groupId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(groupId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const g = await this.db.one<{ id: string; name: string; grade: number | null }>(
      `SELECT id, name, grade FROM teaching_group WHERE id = $1 AND educator_person_id = $2 AND archived_at IS NULL`,
      [groupId, actor.personId],
    );
    if (!g) throw new NotFoundException({ error: 'NOT_FOUND' });
    return g;
  }

  /** INV-15: members the educator can see right now, own child excluded. */
  async members(actor: Actor, groupId: string): Promise<Member[]> {
    return this.db.query<Member>(
      `SELECT c.id AS child_id, c.given_name, initcap(c.family_name) AS family_name, e.grade, v.valid_until
         FROM group_member gm
         JOIN v_educator_visible_child v ON v.child_id = gm.child_id AND v.educator_person_id = $2 AND NOT v.is_own_child
         JOIN child c ON c.id = gm.child_id AND c.anonymised_at IS NULL
    LEFT JOIN LATERAL (SELECT e.grade FROM enrolment e WHERE e.child_id = c.id AND e.ended_at IS NULL
                        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1) e ON true
        WHERE gm.group_id = $1`,
      [groupId, actor.personId],
    );
  }

  private async ownChildInGroup(actor: Actor, groupId: string): Promise<boolean> {
    return !!(await this.db.one(
      `SELECT 1 FROM group_member gm JOIN v_educator_visible_child v
           ON v.child_id = gm.child_id AND v.educator_person_id = $2 AND v.is_own_child
        WHERE gm.group_id = $1`,
      [groupId, actor.personId],
    ));
  }

  private async waves(seasonId: string, grade: number): Promise<WaveRow[]> {
    return this.db.query<WaveRow>(
      `SELECT id, ordinal, opens_at, closes_at,
              CASE WHEN closed_at IS NOT NULL OR closes_at <= now() THEN 'closed'
                   WHEN opens_at <= now() THEN 'open' ELSE 'upcoming' END AS state
         FROM wave WHERE season_id = $1 AND grade = $2 ORDER BY ordinal`,
      [seasonId, grade],
    );
  }

  /**
   * The current run's measured waves up to `upTo`: the last one is "to", the
   * one before is "from". A child measured at "to" but not at "from" is
   * `first`; one not measured at "to" is `not_taken`.
   */
  private async progress(seasonId: string, grade: number, waves: WaveRow[], upTo: WaveRow, childIds: string[]) {
    const byChild = new Map<string, { category: GainCategory; gain: number }>();
    const measured = await this.db.query<{ wave_id: string }>(
      grade >= 3
        ? `SELECT DISTINCT b.wave_id FROM percentile_band b JOIN calibration_run r ON r.id = b.calibration_run_id AND r.is_current
            WHERE r.season_id = $1 AND r.grade = $2`
        : `SELECT DISTINCT s.wave_id FROM skill_state s JOIN calibration_run r ON r.id = s.calibration_run_id AND r.is_current
            WHERE r.season_id = $1 AND r.grade = $2`,
      [seasonId, grade],
    );
    const has = new Set(measured.map((m) => m.wave_id));
    const chain = waves.filter((w) => has.has(w.id) && w.ordinal <= upTo.ordinal);
    const to = chain[chain.length - 1] ?? null;
    const from = chain[chain.length - 2] ?? null;
    if (!to) return { from: null, to: null, byChild };

    const value = async (waveId: string) => {
      const rows = await this.db.query<{ child_id: string; v: number | null }>(
        grade >= 3
          ? `SELECT b.child_id, (b.pct_low + b.pct_high) / 2.0 AS v
               FROM percentile_band b JOIN calibration_run r ON r.id = b.calibration_run_id AND r.is_current
              WHERE r.season_id = $1 AND r.grade = $2 AND b.wave_id = $3 AND b.child_id = ANY($4::uuid[])`
          : `SELECT s.child_id, count(*) FILTER (WHERE s.state = 'secure')::float8 AS v
               FROM skill_state s JOIN calibration_run r ON r.id = s.calibration_run_id AND r.is_current
              WHERE r.season_id = $1 AND r.grade = $2 AND s.wave_id = $3 AND s.child_id = ANY($4::uuid[])
              GROUP BY s.child_id`,
        [seasonId, grade, waveId, childIds],
      );
      return new Map(rows.map((r) => [r.child_id, r.v === null ? null : Number(r.v)]));
    };
    const now = await value(to.id);
    const before = from ? await value(from.id) : new Map<string, number | null>();

    for (const id of childIds) {
      const a = now.get(id);
      if (a === undefined) continue;
      const b = before.get(id);
      // Measured, but no band (a cohort under 30): progress is unknown, which
      // is "first" in the list — it is never shown as a fall.
      if (a === null || b === undefined || b === null) {
        byChild.set(id, { category: 'first', gain: -1000 });
        continue;
      }
      const gain = a - b;
      const category: GainCategory =
        grade >= 3 ? (gain >= GAIN_UP ? 'up' : gain <= GAIN_LOOK ? 'look' : 'flat') : gain > 0 ? 'up' : gain < 0 ? 'look' : 'flat';
      byChild.set(id, { category, gain });
    }
    return { from: from?.ordinal ?? null, to: to.ordinal, byChild };
  }

  /**
   * design/08 "Common mistakes this wave": from the DISTRACTORS children
   * picked (their misconception codes), counted per child, not per answer —
   * "12 of 14 children", not "31 wrong answers".
   */
  private async commonMistakes(waveId: string, childIds: string[]) {
    if (!childIds.length) return [];
    const rows = await this.db.query<{
      code: string;
      name_uz: string;
      name_ru: string;
      explain_uz: string;
      explain_ru: string;
      topic_code: string;
      topic_uz: string;
      topic_ru: string;
      cluster: string;
      children: string[];
    }>(
      `SELECT m.code, m.name_uz, m.name_ru, m.explain_uz, m.explain_ru, m.topic_code,
              t.name_uz AS topic_uz, t.name_ru AS topic_ru, t.cluster::text AS cluster,
              array_agg(DISTINCT s.child_id::text) AS children
         FROM session s
         JOIN response r ON r.session_id = s.id
         JOIN item_option o ON o.id = r.chosen_option_id AND NOT o.is_key AND o.misconception_code IS NOT NULL
         JOIN misconception m ON m.code = o.misconception_code
         JOIN topic t ON t.code = m.topic_code
        WHERE s.wave_id = $1 AND s.mode = 'monitoring' AND s.status = 'submitted' AND s.child_id = ANY($2::uuid[])
        GROUP BY m.code, t.code
        ORDER BY count(DISTINCT s.child_id) DESC, m.code
        LIMIT 4`,
      [waveId, childIds],
    );
    return rows.map((r) => ({
      code: r.code,
      nameUz: r.name_uz,
      nameRu: r.name_ru,
      explainUz: r.explain_uz,
      explainRu: r.explain_ru,
      topic: { code: r.topic_code, nameUz: r.topic_uz, nameRu: r.topic_ru },
      cluster: r.cluster,
      childCount: r.children.length,
      childIds: r.children,
    }));
  }

  private async remindedToday(waveId: string, childIds: string[]): Promise<Set<string>> {
    const day = tashkentDay();
    const keys = childIds.map((id) => `wave_reminder:${waveId}:${id}:${day}`);
    const rows = await this.db.query<{ throttle_key: string }>(
      `SELECT throttle_key FROM notification WHERE throttle_key = ANY($1::text[])`,
      [keys],
    );
    return new Set(rows.map((r) => r.throttle_key.split(':')[2]));
  }
}

function mostCommon(values: number[]): number | null {
  if (!values.length) return null;
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
