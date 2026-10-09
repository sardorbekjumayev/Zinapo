import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { Actor } from '../authz';
import { Candidate, CandidatesRepository } from '../bank/candidates.repository';
import { median } from './educator.util';

export type PracticeSource = 'misconception' | 'topic';

/** design/09: "10 questions, about 20 minutes". */
export const DEFAULT_SET_SIZE = 10;
export const MAX_SET_SIZE = 20;
/** design/09: "children solved fewer than 6 of 10" → struggled. */
export const STRUGGLED_SHARE = 0.6;
/** An assignment can be taken back while nobody has started it, for this long. */
export const UNDO_MINUTES = 15;

type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * task.md § 8.4.6 — practice.
 *
 * A set is an ordinary `form` with `mode = 'practice'`, filled ONLY through
 * `CandidatesRepository` — the INV-08 query that can never return an anchor
 * for a practice form ("enforce it in the QUERY, not in the UI"). Pretest
 * items may ride along unscored (`is_scored = false`); every slot is tagged
 * with the misconception or topic it came from.
 *
 * Results are "how many solved" and nothing else: no percentile, no position,
 * and practice never feeds the scale (§ 1.11 — measurement reads monitoring
 * sessions only).
 */
@Injectable()
export class PracticeService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly candidates: CandidatesRepository,
  ) {}

  // ============================================================== sources

  /** design/09 "By topic": the topics of a grade, with how many practice items each has. */
  async topics(grade: number) {
    return this.db.query(
      `SELECT t.code, t.name_uz AS "nameUz", t.name_ru AS "nameRu", t.cluster::text AS cluster,
              count(i.id) FILTER (WHERE i.status = 'approved' AND NOT i.is_anchor AND i.retired_at IS NULL)::int AS items
         FROM topic t LEFT JOIN item i ON i.topic_code = t.code AND i.grade = $1
        WHERE $1 BETWEEN t.grade_min AND t.grade_max
        GROUP BY t.code ORDER BY t.cluster, t.sort, t.code`,
      [grade],
    );
  }

  // ================================================================ build

  async build(actor: Actor, input: { source: PracticeSource; code: string; grade: number; size?: number }) {
    const size = Math.min(Math.max(input.size ?? DEFAULT_SET_SIZE, 3), MAX_SET_SIZE);
    const source = await this.describeSource(input.source, input.code);

    let scored: Candidate[] = [];
    if (input.source === 'misconception') {
      scored = await this.candidates.find({ mode: 'practice', grade: input.grade, role: 'scored', misconception: input.code, limit: 200 });
      // Not enough items carry this exact mistake: fill from its topic, so
      // the set still practises the same thing.
      if (scored.length < size) {
        const more = await this.candidates.find({ mode: 'practice', grade: input.grade, role: 'scored', topic: source.topicCode, limit: 200 });
        const have = new Set(scored.map((c) => c.itemId));
        scored = [...scored, ...more.filter((c) => !have.has(c.itemId)).map((c) => ({ ...c, fill: true }))];
      }
    } else {
      scored = await this.candidates.find({ mode: 'practice', grade: input.grade, role: 'scored', topic: input.code, limit: 200 });
    }
    if (!scored.length) throw new ConflictException({ error: 'NO_ITEMS', details: { source: input.source, code: input.code } });

    // One unscored pretest item in a full-size set, if the bank has one — it
    // earns its calibration data without counting towards "solved".
    const pretest =
      size >= 8
        ? (await this.candidates.find({
            mode: 'practice',
            grade: input.grade,
            role: 'pretest',
            ...(input.source === 'misconception' ? { topic: source.topicCode } : { topic: input.code }),
            limit: 1,
          }))[0] ?? null
        : null;

    const picked = spread(scored, pretest ? size - 1 : size);
    const formId = await this.db.transaction(async (client) => {
      const season = await client.query<{ id: string }>(`SELECT id FROM season WHERE is_current`);
      const form = await client.query<{ id: string }>(
        `INSERT INTO form (mode, season_id, grade, label, created_by, source_kind, source_code)
         VALUES ('practice', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [season.rows[0]?.id ?? null, input.grade, source.nameUz, actor.personId, input.source, input.code],
      );
      const id = form.rows[0].id;
      const slots = [...picked.map((c) => ({ c, pretest: false })), ...(pretest ? [{ c: pretest, pretest: true }] : [])];
      // Easy to hard; the pretest item sits in the middle so it is neither
      // the first impression nor skipped for lack of time.
      slots.sort((a, b) => difficultyValue(a.c) - difficultyValue(b.c));
      if (pretest) {
        const at = slots.findIndex((s) => s.pretest);
        const [p] = slots.splice(at, 1);
        slots.splice(Math.floor(slots.length / 2), 0, p);
      }
      for (const [i, s] of slots.entries()) {
        await this.insertSlot(client, id, i + 1, s.c, s.pretest, input.source === 'misconception' && !(s.c as { fill?: boolean }).fill ? input.code : s.c.topicCode);
      }
      return id;
    });
    await this.audit.write({ action: 'practice.form_built', personId: actor.personId, payload: { formId, source: input.source, taxonomy: input.code } });
    return this.preview(actor, formId);
  }

  async preview(actor: Actor, formId: string) {
    const form = await this.ownForm(actor, formId);
    const items = await this.db.query<{
      position: number;
      item_version_id: string;
      is_scored: boolean;
      source_code: string | null;
      stem_format: string;
      stem_uz: string;
      stem_ru: string;
      image_ref: string | null;
      topic_uz: string;
      topic_ru: string;
      cluster: string;
      expected_p: string | null;
      difficulty_b: string | null;
    }>(
      `SELECT fi.position, fi.item_version_id, fi.is_scored, fi.source_code, v.stem_format, v.stem_uz, v.stem_ru,
              v.image_ref, t.name_uz AS topic_uz, t.name_ru AS topic_ru, t.cluster::text AS cluster, v.expected_p,
              (SELECT s.difficulty_b FROM item_statistic s JOIN calibration_run cr ON cr.id = s.calibration_run_id
                WHERE s.item_version_id = v.id
                ORDER BY (cr.is_current AND EXISTS (SELECT 1 FROM season se WHERE se.id = cr.season_id AND se.is_current)) DESC,
                         cr.is_current DESC, cr.started_at DESC LIMIT 1) AS difficulty_b
         FROM form_item fi
         JOIN item_version v ON v.id = fi.item_version_id
         JOIN item i ON i.id = v.item_id
         JOIN topic t ON t.code = i.topic_code
        WHERE fi.form_id = $1 ORDER BY fi.position`,
      [formId],
    );
    const source = form.source_kind ? await this.describeSource(form.source_kind as PracticeSource, form.source_code!) : null;
    return {
      id: form.id,
      grade: form.grade,
      label: form.label,
      frozen: form.frozen_at !== null,
      source: source ? { kind: form.source_kind, code: form.source_code, nameUz: source.nameUz, nameRu: source.nameRu } : null,
      size: items.filter((i) => i.is_scored).length,
      items: items.map((i) => ({
        position: i.position,
        itemVersionId: i.item_version_id,
        // "Solved" counts scored items only; the pretest item is practice for the child too.
        scored: i.is_scored,
        fromMistake: form.source_kind === 'misconception' && i.source_code === form.source_code,
        stemFormat: i.stem_format,
        stemUz: i.stem_uz,
        stemRu: i.stem_ru,
        hasImage: !!i.image_ref,
        topic: { nameUz: i.topic_uz, nameRu: i.topic_ru },
        cluster: i.cluster,
        difficulty: difficultyLabel(i.difficulty_b === null ? null : Number(i.difficulty_b), i.expected_p === null ? null : Number(i.expected_p)),
      })),
    };
  }

  /** design/09 "Swap a question": another item of the same topic and about the same difficulty. */
  async swap(actor: Actor, formId: string, position: number) {
    const form = await this.ownForm(actor, formId);
    if (form.frozen_at) throw new ConflictException({ error: 'FORM_FROZEN' });
    const slot = await this.db.one<{ item_version_id: string; topic_code: string; cluster: string; source_code: string | null; expected_p: string | null }>(
      `SELECT fi.item_version_id, i.topic_code, t.cluster::text AS cluster, fi.source_code, v.expected_p
         FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id JOIN item i ON i.id = v.item_id
         JOIN topic t ON t.code = i.topic_code
        WHERE fi.form_id = $1 AND fi.position = $2`,
      [formId, position],
    );
    if (!slot) throw new NotFoundException({ error: 'NOT_FOUND' });

    // The repository already leaves out every item the form holds. Same topic
    // first; a topic with nothing left falls back to its cluster.
    let pool = await this.candidates.find({ mode: 'practice', grade: form.grade, role: 'scored', topic: slot.topic_code, formId, limit: 200 });
    if (!pool.length) {
      pool = await this.candidates.find({ mode: 'practice', grade: form.grade, role: 'scored', cluster: slot.cluster, formId, limit: 200 });
    }
    if (!pool.length) throw new ConflictException({ error: 'NO_ALTERNATIVE' });
    const target = slot.expected_p === null ? 0 : logit(Number(slot.expected_p));
    const next = [...pool].sort((a, b) => Math.abs(difficultyValue(a) - target) - Math.abs(difficultyValue(b) - target))[0];

    await this.db.transaction(async (client) => {
      await client.query(`DELETE FROM form_item WHERE form_id = $1 AND position = $2`, [formId, position]);
      await this.insertSlot(client, formId, position, next, false, slot.source_code ?? next.topicCode);
    });
    return this.preview(actor, formId);
  }

  // =============================================================== assign

  async assign(actor: Actor, input: { formId: string; childIds: string[]; groupId?: string | null; repeatOf?: string | null }) {
    const form = await this.ownForm(actor, input.formId);
    if (input.groupId) {
      const g = await this.db.one(`SELECT 1 FROM teaching_group WHERE id = $1 AND educator_person_id = $2`, [input.groupId, actor.personId]);
      if (!g) throw new NotFoundException({ error: 'NOT_FOUND' });
    }
    // INV-15: only children the educator can see now.
    const visible = await this.db.query<{ child_id: string }>(
      `SELECT child_id FROM v_educator_visible_child WHERE educator_person_id = $1 AND child_id = ANY($2::uuid[])`,
      [actor.personId, [...new Set(input.childIds)]],
    );
    if (!visible.length) throw new BadRequestException({ error: 'NO_CHILDREN' });

    const id = await this.db.transaction(async (client) => {
      // Assigning freezes the set: what a child solves must be what the
      // educator saw, and a frozen form cannot change under a session (INV-09).
      await client.query(`UPDATE form SET frozen_at = now() WHERE id = $1 AND frozen_at IS NULL`, [form.id]);
      const a = await client.query<{ id: string }>(
        `INSERT INTO practice_assignment (form_id, educator_person_id, group_id, source_misconception_code, source_topic_code, repeat_of)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          form.id,
          actor.personId,
          input.groupId ?? null,
          form.source_kind === 'misconception' ? form.source_code : null,
          form.source_kind === 'topic' ? form.source_code : null,
          input.repeatOf ?? null,
        ],
      );
      await client.query(
        `INSERT INTO practice_assignment_child (assignment_id, child_id) SELECT $1, unnest($2::uuid[])`,
        [a.rows[0].id, visible.map((v) => v.child_id)],
      );
      return a.rows[0].id;
    });

    const n = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM form_item WHERE form_id = $1 AND is_scored`, [form.id]);
    const educator = await this.db.one<{ full_name: string }>(`SELECT full_name FROM person WHERE id = $1`, [actor.personId]);
    const owners = await this.db.query<{ child_id: string; given_name: string; owner_id: string }>(
      `SELECT c.id AS child_id, c.given_name, g.person_id AS owner_id
         FROM child c JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE c.id = ANY($1::uuid[])`,
      [visible.map((v) => v.child_id)],
    );
    for (const o of owners) {
      await this.notify.queue({
        personId: o.owner_id,
        template: 'practice_assigned',
        vars: { educator: educator?.full_name ?? '', child: o.given_name, title: form.label, n: n?.n ?? 0, link: `${this.config.webOrigin}/uz/family/children/${o.child_id}` },
        throttleKey: `practice_assigned:${id}:${o.child_id}`,
      });
    }
    await this.audit.write({ action: 'practice.assigned', personId: actor.personId, payload: { assignmentId: id, formId: form.id, children: visible.length, repeatOf: input.repeatOf ?? null } });
    return { id, assigned: visible.length, skipped: input.childIds.length - visible.length, undoUntil: new Date(Date.now() + UNDO_MINUTES * 60_000) };
  }

  async repeat(actor: Actor, assignmentId: string, childIds: string[]) {
    const a = await this.ownAssignment(actor, assignmentId);
    return this.assign(actor, { formId: a.form_id, childIds, groupId: a.group_id, repeatOf: a.id });
  }

  /** design/09 "Undo": only while nobody has opened it, and only for a few minutes. */
  async undo(actor: Actor, assignmentId: string) {
    const a = await this.ownAssignment(actor, assignmentId);
    if (Date.now() - a.created_at.getTime() > UNDO_MINUTES * 60_000) throw new ConflictException({ error: 'UNDO_EXPIRED' });
    const started = await this.db.one(`SELECT 1 FROM session WHERE assignment_id = $1`, [a.id]);
    if (started) throw new ConflictException({ error: 'ALREADY_STARTED' });
    await this.db.query(`DELETE FROM practice_assignment WHERE id = $1`, [a.id]);
    await this.audit.write({ action: 'practice.unassigned', personId: actor.personId, payload: { assignmentId: a.id } });
    return { ok: true };
  }

  // ============================================================== results

  async list(actor: Actor, groupId?: string) {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM practice_assignment
        WHERE educator_person_id = $1 AND ($2::uuid IS NULL OR group_id = $2)
        ORDER BY created_at DESC LIMIT 30`,
      [actor.personId, groupId ?? null],
    );
    const out = [];
    for (const r of rows) {
      const res = await this.results(actor, r.id);
      out.push({ ...res, children: undefined });
    }
    return out;
  }

  /**
   * "How many solved" per child — scored items only — and the three numbers
   * on design/09's card: the typical result (median), how many completed, and
   * who struggled (fewer than 60 % solved), for "Repeat for those who struggled".
   */
  async results(actor: Actor, assignmentId: string) {
    const a = await this.ownAssignment(actor, assignmentId);
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM form_item WHERE form_id = $1 AND is_scored`, [a.form_id]);
    const rows = await this.db.query<{ child_id: string; given_name: string; family_name: string; status: string | null; solved: number | null }>(
      `SELECT c.id AS child_id, c.given_name, initcap(c.family_name) AS family_name, s.status::text AS status,
              (SELECT count(*)::int FROM response r JOIN form_item fi ON fi.form_id = s.form_id
                                     AND fi.item_version_id = r.item_version_id AND fi.is_scored
                WHERE r.session_id = s.id AND r.is_correct) AS solved
         FROM practice_assignment_child pac
         -- INV-15: a child whose link ended drops out of the results too.
         JOIN v_educator_visible_child v ON v.child_id = pac.child_id AND v.educator_person_id = $2
         JOIN child c ON c.id = pac.child_id
    LEFT JOIN LATERAL (SELECT * FROM session s WHERE s.assignment_id = pac.assignment_id AND s.child_id = pac.child_id
                        AND s.status <> 'voided' ORDER BY s.status = 'submitted' DESC, s.started_at DESC LIMIT 1) s ON true
        WHERE pac.assignment_id = $1
        ORDER BY c.given_name`,
      [a.id, actor.personId],
    );
    const n = total?.n ?? 0;
    const children = rows.map((r) => ({
      id: r.child_id,
      name: `${r.given_name} ${r.family_name}`,
      givenName: r.given_name,
      status: r.status === 'submitted' ? ('done' as const) : r.status === 'started' ? ('started' as const) : ('not_started' as const),
      solved: r.status === 'submitted' ? (r.solved ?? 0) : null,
    }));
    const done = children.filter((c) => c.status === 'done');
    const struggled = done.filter((c) => (c.solved ?? 0) < Math.ceil(n * STRUGGLED_SHARE));
    return {
      id: a.id,
      label: a.label,
      labelRu: a.label_ru,
      source: a.source_kind ? { kind: a.source_kind, code: a.source_code } : null,
      formId: a.form_id,
      groupId: a.group_id,
      groupName: a.group_name,
      repeatOf: a.repeat_of,
      createdAt: a.created_at,
      undoUntil: new Date(a.created_at.getTime() + UNDO_MINUTES * 60_000),
      total: n,
      summary: {
        assigned: children.length,
        completed: done.length,
        notStarted: children.filter((c) => c.status === 'not_started').length,
        typicalSolved: median(done.map((c) => c.solved ?? 0)),
        struggledCount: struggled.length,
        struggledIds: struggled.map((c) => c.id),
        struggledBelow: Math.ceil(n * STRUGGLED_SHARE),
      },
      children,
    };
  }

  // ========================================================= family side

  /**
   * The parent's practice list for a child: what was assigned and whether it
   * is done — "the parent sees the practice count only" (§ 12 M6), so no
   * solved counts here; the child sees theirs at the end of the set.
   */
  async forChild(childId: string) {
    return this.db.query(
      `SELECT pa.id AS "assignmentId", f.label AS title,
              COALESCE((SELECT m.name_ru FROM misconception m WHERE f.source_kind = 'misconception' AND m.code = f.source_code),
                       (SELECT t.name_ru FROM topic t WHERE f.source_kind = 'topic' AND t.code = f.source_code), f.label) AS "titleRu", p.full_name AS "educatorName", pa.created_at AS "assignedAt",
              (SELECT count(*)::int FROM form_item fi WHERE fi.form_id = f.id AND fi.is_scored) AS items,
              CASE WHEN s.status = 'submitted' THEN 'done' WHEN s.status = 'started' THEN 'started' ELSE 'not_started' END AS status,
              s.id AS "sessionId", s.submitted_at AS "doneAt"
         FROM practice_assignment_child pac
         JOIN practice_assignment pa ON pa.id = pac.assignment_id
         JOIN form f ON f.id = pa.form_id
         JOIN person p ON p.id = pa.educator_person_id
    LEFT JOIN LATERAL (SELECT s.id, s.status, s.submitted_at FROM session s
                        WHERE s.assignment_id = pa.id AND s.child_id = pac.child_id AND s.status <> 'voided'
                        ORDER BY s.status = 'submitted' DESC, s.started_at DESC LIMIT 1) s ON true
        WHERE pac.child_id = $1
        ORDER BY (s.status = 'submitted') NULLS FIRST, pa.created_at DESC
        LIMIT 50`,
      [childId],
    );
  }

  /** Start (or resume) an assigned set in kid mode. One attempt per assignment. */
  async start(actor: Actor, childId: string, assignmentId: string) {
    const a = await this.db.one<{ form_id: string }>(
      `SELECT pa.form_id FROM practice_assignment pa
         JOIN practice_assignment_child pac ON pac.assignment_id = pa.id AND pac.child_id = $2
        WHERE pa.id = $1`,
      [assignmentId, childId],
    );
    if (!a) throw new NotFoundException({ error: 'NOT_FOUND' });
    const child = await this.db.one<{ grade: number; region_id: number; school_id: string | null; consent: boolean }>(
      `SELECT e.grade, e.school_region_id AS region_id, e.school_id,
              EXISTS (SELECT 1 FROM consent k WHERE k.child_id = e.child_id
                       AND k.type = 'data_processing' AND k.revoked_at IS NULL) AS consent
         FROM enrolment e JOIN child c ON c.id = e.child_id AND c.anonymised_at IS NULL
        WHERE e.child_id = $1 AND e.ended_at IS NULL
        ORDER BY e.school_year DESC, e.started_at DESC LIMIT 1`,
      [childId],
    );
    if (!child) throw new ConflictException({ error: 'NO_ENROLMENT' });
    if (!child.consent) throw new ConflictException({ error: 'CONSENT_REQUIRED' });

    const existing = await this.db.one<{ id: string; status: string }>(
      `SELECT id, status FROM session WHERE assignment_id = $1 AND child_id = $2 AND status <> 'voided'
        ORDER BY status = 'submitted' DESC, started_at DESC LIMIT 1`,
      [assignmentId, childId],
    );
    if (existing?.status === 'submitted') throw new ConflictException({ error: 'PRACTICE_DONE' });
    if (existing) return { sessionId: existing.id, resumed: true };

    const row = await this.db.one<{ id: string }>(
      `INSERT INTO session (child_id, mode, form_id, assignment_id, launched_by, launch_context,
                            grade_snapshot, region_snapshot, school_snapshot)
       VALUES ($1, 'practice', $2, $3, $4, 'home', $5, $6, $7) RETURNING id`,
      [childId, a.form_id, assignmentId, actor.personId, child.grade, child.region_id, child.school_id],
    );
    await this.audit.write({ action: 'session.started', personId: actor.personId, payload: { sessionId: row!.id, childId, assignmentId, mode: 'practice' } });
    return { sessionId: row!.id, resumed: false };
  }

  // ============================================================= helpers

  private async insertSlot(client: PoolClient, formId: string, position: number, c: Candidate, pretest: boolean, sourceCode: string) {
    await client.query(
      `INSERT INTO form_item (form_id, position, item_version_id, slot_role, is_scored, source_code)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [formId, position, c.itemVersionId, pretest ? 'pretest' : 'scored', !pretest, sourceCode],
    );
  }

  private async describeSource(kind: PracticeSource, code: string) {
    if (kind === 'misconception') {
      const m = await this.db.one<{ name_uz: string; name_ru: string; topic_code: string }>(
        `SELECT name_uz, name_ru, topic_code FROM misconception WHERE code = $1 AND retired_at IS NULL`,
        [code],
      );
      if (!m) throw new NotFoundException({ error: 'SOURCE_NOT_FOUND' });
      return { nameUz: m.name_uz, nameRu: m.name_ru, topicCode: m.topic_code };
    }
    const t = await this.db.one<{ name_uz: string; name_ru: string }>(`SELECT name_uz, name_ru FROM topic WHERE code = $1`, [code]);
    if (!t) throw new NotFoundException({ error: 'SOURCE_NOT_FOUND' });
    return { nameUz: t.name_uz, nameRu: t.name_ru, topicCode: code };
  }

  private async ownForm(actor: Actor, formId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(formId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const f = await this.db.one<{ id: string; grade: number; label: string; frozen_at: Date | null; source_kind: string | null; source_code: string | null }>(
      `SELECT id, grade, label, frozen_at, source_kind, source_code FROM form
        WHERE id = $1 AND created_by = $2 AND mode = 'practice'`,
      [formId, actor.personId],
    );
    if (!f) throw new NotFoundException({ error: 'NOT_FOUND' });
    return f;
  }

  private async ownAssignment(actor: Actor, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ error: 'NOT_FOUND' });
    const a = await this.db.one<{
      id: string;
      form_id: string;
      group_id: string | null;
      group_name: string | null;
      repeat_of: string | null;
      created_at: Date;
      label: string;
      label_ru: string;
      source_kind: string | null;
      source_code: string | null;
    }>(
      `SELECT pa.id, pa.form_id, pa.group_id, tg.name AS group_name, pa.repeat_of, pa.created_at, f.label,
              COALESCE((SELECT m.name_ru FROM misconception m WHERE f.source_kind = 'misconception' AND m.code = f.source_code),
                       (SELECT t.name_ru FROM topic t WHERE f.source_kind = 'topic' AND t.code = f.source_code), f.label) AS label_ru,
              f.source_kind, f.source_code
         FROM practice_assignment pa JOIN form f ON f.id = pa.form_id
    LEFT JOIN teaching_group tg ON tg.id = pa.group_id
        WHERE pa.id = $1 AND pa.educator_person_id = $2`,
      [id, actor.personId],
    );
    if (!a) throw new NotFoundException({ error: 'NOT_FOUND' });
    return a;
  }
}

function logit(p: number): number {
  const q = Math.min(Math.max(p, 0.05), 0.95);
  return Math.log((1 - q) / q);
}

/** Harder = larger. The current run's difficulty when there is one, else the author's expected p. */
function difficultyValue(c: Candidate): number {
  if (c.difficultyB !== null) return c.difficultyB;
  if (c.expectedP !== null) return logit(c.expectedP);
  return 0;
}

function difficultyLabel(b: number | null, p: number | null): Difficulty {
  const v = b ?? (p === null ? 0 : logit(p));
  return v < -0.5 ? 'easy' : v > 0.5 ? 'hard' : 'medium';
}

/** `n` candidates spread evenly over the difficulty range (easy → hard). */
function spread<T extends Candidate>(pool: T[], n: number): T[] {
  const sorted = [...pool].sort((a, b) => difficultyValue(a) - difficultyValue(b));
  if (sorted.length <= n) return sorted;
  const out: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let idx = n === 1 ? Math.floor(sorted.length / 2) : Math.round((i * (sorted.length - 1)) / (n - 1));
    while (used.has(idx)) idx += 1;
    used.add(idx);
    out.push(sorted[idx]);
  }
  return out;
}
