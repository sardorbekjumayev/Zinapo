import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../authz';
import { BankNotFoundException, FormStateException, SlotInvalidException } from './bank.errors';
import { CandidatesRepository, FormMode, SlotRole } from './candidates.repository';
import { FilledSlot, PlanSlot, checkForm, templatePlan } from './form-rules';

interface FormRow {
  id: string;
  mode: FormMode;
  season_id: string | null;
  grade: number;
  label: string;
  time_limit_sec: number | null;
  created_by: string;
  created_at: Date;
  frozen_at: Date | null;
  frozen_by: string | null;
  copied_from: string | null;
  plan: PlanSlot[];
}

/**
 * task.md § 6 (`forms`) and § 8.5 — the bank editor's form builder (design/14).
 *
 * A form is a PLAN (which role each position should hold) plus the filled
 * positions (`form_item`). Positions are filled one at a time, and only with a
 * version the candidate query offers for that role (INV-08 lives there). The
 * rule checks decide whether the form may be frozen; freezing is irreversible
 * and the schema refuses any later change to the form's items.
 *
 * Must never: put an anchor into a practice form.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly candidates: CandidatesRepository,
  ) {}

  async list(q: { mode?: string; grade?: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.mode) {
      params.push(q.mode);
      where.push(`f.mode = $${params.length}`);
    }
    if (q.grade !== undefined) {
      params.push(q.grade);
      where.push(`f.grade = $${params.length}`);
    }
    return this.db.query(
      `SELECT f.id, f.mode, f.grade, f.label, f.frozen_at AS "frozenAt", f.created_at AS "createdAt",
              s.code AS "seasonCode", jsonb_array_length(f.plan) AS planned,
              (SELECT count(*)::int FROM form_item fi WHERE fi.form_id = f.id) AS filled,
              (SELECT w.ordinal FROM wave w WHERE w.form_id = f.id LIMIT 1) AS "waveOrdinal"
         FROM form f LEFT JOIN season s ON s.id = f.season_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY f.frozen_at IS NULL DESC, f.created_at DESC
        LIMIT 200`,
      params,
    );
  }

  async create(
    actor: Actor,
    dto: { mode: FormMode; grade: number; label: string; template?: boolean; timeLimitSec?: number },
  ) {
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    const plan = dto.template ? templatePlan(dto.mode) : [];
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO form (mode, season_id, grade, label, time_limit_sec, created_by, plan)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [
        dto.mode,
        dto.mode === 'practice' ? null : (season?.id ?? null),
        dto.grade,
        dto.label.trim(),
        dto.timeLimitSec ?? null,
        actor.personId,
        JSON.stringify(plan),
      ],
    );
    await this.audit.write({
      action: 'form.created',
      personId: actor.personId,
      payload: { formId: row!.id, mode: dto.mode, grade: dto.grade, template: !!dto.template },
    });
    return this.get(row!.id);
  }

  async get(id: string) {
    const form = await this.load(id);
    const slots = await this.slots(id);
    const rules = checkForm({
      mode: form.mode,
      plan: form.plan,
      slots,
      clustersForGrade: await this.clustersFor(form.grade),
    });
    const people = await this.db.one<{ created_by: string; frozen_by: string | null }>(
      `SELECT (SELECT full_name FROM person WHERE id = $1) AS created_by,
              (SELECT full_name FROM person WHERE id = $2) AS frozen_by`,
      [form.created_by, form.frozen_by],
    );
    return {
      id: form.id,
      mode: form.mode,
      grade: form.grade,
      label: form.label,
      timeLimitSec: form.time_limit_sec,
      createdAt: form.created_at,
      createdByName: people?.created_by ?? null,
      frozenAt: form.frozen_at,
      frozenByName: people?.frozen_by ?? null,
      copiedFrom: form.copied_from,
      plan: form.plan,
      slots,
      rules,
      canFreeze: !form.frozen_at && rules.every((r) => !r.applicable || r.ok),
    };
  }

  /** Replace the plan (positions and their roles). Draft forms only. */
  async setPlan(actor: Actor, id: string, plan: PlanSlot[]) {
    const form = await this.load(id);
    this.assertDraft(form);
    const positions = new Set(plan.map((p) => p.position));
    if (positions.size !== plan.length) throw new FormStateException('duplicate_position');
    if (form.mode === 'practice' && plan.some((p) => p.role === 'anchor')) {
      // INV-08: a practice form has no anchor slots to fill in the first place.
      throw new SlotInvalidException('anchor_in_practice');
    }
    const before = new Map(form.plan.map((p) => [p.position, p.role]));
    const changed = plan.filter((p) => before.has(p.position) && before.get(p.position) !== p.role).map((p) => p.position);
    await this.db.transaction(async (client) => {
      // Positions dropped from the plan, or whose role changed, lose their
      // items: an item chosen for one role is not automatically right for another.
      await client.query(
        `DELETE FROM form_item
          WHERE form_id = $1 AND (NOT (position = ANY($2::smallint[])) OR position = ANY($3::smallint[]))`,
        [id, [...positions], changed],
      );
      await client.query(`UPDATE form SET plan = $2::jsonb WHERE id = $1`, [
        id,
        JSON.stringify([...plan].sort((a, b) => a.position - b.position)),
      ]);
    });
    await this.audit.write({ action: 'form.updated', personId: actor.personId, payload: { formId: id, change: 'plan', positions: plan.length } });
    return this.get(id);
  }

  /** The versions the candidate query offers for one position (design/14 "Replace"). */
  async candidatesFor(id: string, position: number, filters: { cluster?: string; topic?: string; q?: string }) {
    const form = await this.load(id);
    const slot = form.plan.find((p) => p.position === position);
    if (!slot) throw new FormStateException('no_such_position');
    return this.candidates.find({
      mode: form.mode,
      grade: form.grade,
      role: slot.role,
      formId: form.id,
      ...filters,
    });
  }

  /**
   * Fill (or clear, with `null`) one position. The version must be one the
   * candidate query would offer for that slot — the same INV-08 query, not a
   * second set of rules — and the schema's trigger checks once more.
   */
  async fill(actor: Actor, id: string, position: number, itemVersionId: string | null) {
    const form = await this.load(id);
    this.assertDraft(form);
    const slot = form.plan.find((p) => p.position === position);
    if (!slot) throw new FormStateException('no_such_position');

    if (itemVersionId === null) {
      await this.db.query(`DELETE FROM form_item WHERE form_id = $1 AND position = $2`, [id, position]);
    } else {
      // Replacing frees the position first, so the item it held is not counted
      // as "already in the form".
      const current = await this.db.one<{ item_version_id: string }>(
        `SELECT item_version_id FROM form_item WHERE form_id = $1 AND position = $2`,
        [id, position],
      );
      if (current?.item_version_id === itemVersionId) return this.get(id);

      const ok = await this.candidates.find({
        mode: form.mode,
        grade: form.grade,
        role: slot.role,
        formId: form.id,
        itemVersionId,
        limit: 1,
      });
      if (!ok.length) throw new SlotInvalidException(form.mode === 'practice' ? 'not_a_practice_candidate' : 'not_a_candidate');

      await this.db.transaction(async (client) => {
        await client.query(`DELETE FROM form_item WHERE form_id = $1 AND position = $2`, [id, position]);
        await client.query(
          `INSERT INTO form_item (form_id, position, item_version_id, slot_role, is_scored)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, position, itemVersionId, slot.role, slot.role !== 'pretest'],
        );
      });
    }
    await this.audit.write({
      action: 'form.updated',
      personId: actor.personId,
      payload: { formId: id, change: itemVersionId ? 'fill' : 'clear', position },
    });
    return this.get(id);
  }

  /** Irreversible (task.md § 8.5). Every applicable rule must pass. */
  async freeze(actor: Actor, id: string) {
    const current = await this.get(id);
    if (current.frozenAt) throw new FormStateException('frozen');
    if (!current.canFreeze) {
      throw new FormStateException('rules_failing', {
        failing: current.rules.filter((r) => r.applicable && !r.ok).map((r) => r.id),
      });
    }
    await this.db.query(
      `UPDATE form SET frozen_at = now(), frozen_by = $2 WHERE id = $1 AND frozen_at IS NULL`,
      [id, actor.personId],
    );
    await this.audit.write({
      action: 'form.frozen',
      personId: actor.personId,
      payload: { formId: id, mode: current.mode, grade: current.grade, positions: current.slots.length },
    });
    return this.get(id);
  }

  /** "New form from this one" (design/14): same plan and items, a fresh draft. */
  async copy(actor: Actor, id: string) {
    const form = await this.load(id);
    const created = await this.db.transaction(async (client) => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO form (mode, season_id, grade, label, time_limit_sec, created_by, plan, copied_from)
         SELECT mode, season_id, grade, label || ' · 2', time_limit_sec, $2, plan, id
           FROM form WHERE id = $1 RETURNING id`,
        [id, actor.personId],
      );
      await client.query(
        `INSERT INTO form_item (form_id, position, item_version_id, slot_role, is_scored, source_code)
         SELECT $2, position, item_version_id, slot_role, is_scored, source_code
           FROM form_item WHERE form_id = $1`,
        [id, row.rows[0].id],
      );
      return row.rows[0].id;
    });
    await this.audit.write({
      action: 'form.created',
      personId: actor.personId,
      payload: { formId: created, mode: form.mode, grade: form.grade, copiedFrom: id },
    });
    return this.get(created);
  }

  // ------------------------------------------------------------ helpers

  private async slots(formId: string): Promise<(FilledSlot & Record<string, unknown>)[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT fi.position, fi.slot_role::text AS "slotRole", fi.is_scored AS "isScored",
              v.id AS "itemVersionId", v.version, i.id AS "itemId", i.code, t.cluster::text AS cluster,
              i.topic_code AS "topicCode", i.is_anchor AS "isAnchor", i.anchor_kind::text AS "anchorKind",
              i.status::text AS status, (i.retired_at IS NOT NULL) AS retired,
              v.expected_p::float8 AS "expectedP", st.difficulty_b::float8 AS "difficultyB",
              left(v.stem_uz, 160) AS "stemUz",
              (length(trim(v.stem_uz)) > 0 AND length(trim(v.stem_ru)) > 0
               AND NOT EXISTS (SELECT 1 FROM item_option o WHERE o.item_version_id = v.id
                                AND o.image_ref IS NULL
                                AND (length(trim(o.label_uz)) = 0 OR length(trim(o.label_ru)) = 0))) AS bilingual,
              (SELECT array_agg(DISTINCT w.ordinal ORDER BY w.ordinal)
                 FROM form_item fi2 JOIN wave w ON w.form_id = fi2.form_id
                WHERE fi2.item_version_id = v.id AND fi2.form_id <> fi.form_id) AS "usedInWaves"
         FROM form_item fi
         JOIN item_version v ON v.id = fi.item_version_id
         JOIN item i ON i.id = v.item_id
         JOIN topic t ON t.code = i.topic_code
    LEFT JOIN LATERAL (SELECT s.difficulty_b FROM item_statistic s
                         JOIN calibration_run cr ON cr.id = s.calibration_run_id
                        WHERE s.item_version_id = v.id
                        ORDER BY (cr.is_current AND EXISTS (SELECT 1 FROM season se WHERE se.id = cr.season_id AND se.is_current)) DESC,
                                 cr.is_current DESC, cr.started_at DESC LIMIT 1) st ON true
        WHERE fi.form_id = $1
        ORDER BY fi.position`,
      [formId],
    );
    return rows as (FilledSlot & Record<string, unknown>)[];
  }

  private async clustersFor(grade: number): Promise<string[]> {
    const rows = await this.db.query<{ cluster: string }>(
      `SELECT DISTINCT cluster::text AS cluster FROM topic WHERE $1 BETWEEN grade_min AND grade_max ORDER BY 1`,
      [grade],
    );
    return rows.map((r) => r.cluster);
  }

  private assertDraft(form: FormRow): void {
    if (form.frozen_at) throw new FormStateException('frozen');
  }

  private async load(id: string): Promise<FormRow> {
    if (!UUID.test(id)) throw new BankNotFoundException();
    const row = await this.db.one<FormRow>(`SELECT * FROM form WHERE id = $1`, [id]);
    if (!row) throw new BankNotFoundException();
    return row;
  }
}

/** Kept for the controller's DTO typing. */
export type { SlotRole };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
