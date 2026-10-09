import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../authz';
import { TaxonomyConflictException, BankNotFoundException } from './bank.errors';
import {
  CreateMisconceptionDto,
  CreateSkillDto,
  CreateTopicDto,
  PatchMisconceptionDto,
  PatchSkillDto,
  PatchTopicDto,
} from './dto/taxonomy.dto';

/** The prefix of a topic code must name its cluster: `num.` is numeracy. */
const PREFIX: Record<string, string> = { numeracy: 'num.', reasoning: 'rea.', language: 'lan.' };

/**
 * task.md § 12 M3: "Taxonomy CRUD: topics (3 clusters), skills (grades 0–2),
 * misconceptions". The vocabulary items, reports and the practice builder all
 * speak — so codes never change once created, and nothing referenced by an
 * item is deleted: a misconception is retired, not removed.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async all() {
    const [topics, skills, misconceptions] = await Promise.all([
      this.db.query(
        `SELECT t.code, t.cluster, t.grade_min AS "gradeMin", t.grade_max AS "gradeMax",
                t.name_uz AS "nameUz", t.name_ru AS "nameRu", t.sort,
                (SELECT count(*)::int FROM item i WHERE i.topic_code = t.code) AS "itemCount"
           FROM topic t ORDER BY t.sort, t.code`,
      ),
      this.db.query(
        `SELECT s.code, s.topic_code AS "topicCode", s.grade,
                s.name_uz AS "nameUz", s.name_ru AS "nameRu",
                (SELECT count(*)::int FROM item i WHERE i.skill_code = s.code) AS "itemCount"
           FROM skill s ORDER BY s.topic_code, s.grade, s.code`,
      ),
      this.db.query(
        `SELECT m.code, m.topic_code AS "topicCode", m.name_uz AS "nameUz", m.name_ru AS "nameRu",
                m.explain_uz AS "explainUz", m.explain_ru AS "explainRu", m.retired_at AS "retiredAt",
                (SELECT count(*)::int FROM item_option o WHERE o.misconception_code = m.code) AS "optionCount"
           FROM misconception m ORDER BY m.topic_code, m.code`,
      ),
    ]);
    return { topics, skills, misconceptions };
  }

  // ---------------------------------------------------------------- topics

  async createTopic(actor: Actor, dto: CreateTopicDto) {
    if (!dto.code.startsWith(PREFIX[dto.cluster])) throw new TaxonomyConflictException('cluster_mismatch');
    if (dto.gradeMin > dto.gradeMax) throw new TaxonomyConflictException('grade_range');
    await this.insert(
      `INSERT INTO topic (code, cluster, grade_min, grade_max, name_uz, name_ru, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [dto.code, dto.cluster, dto.gradeMin, dto.gradeMax, dto.nameUz.trim(), dto.nameRu.trim(), dto.sort ?? 0],
    );
    await this.log(actor, 'topic.created', dto.code);
    return this.all();
  }

  async patchTopic(actor: Actor, code: string, dto: PatchTopicDto) {
    const current = await this.db.one<{ grade_min: number; grade_max: number }>(
      `SELECT grade_min, grade_max FROM topic WHERE code = $1`,
      [code],
    );
    if (!current) throw new BankNotFoundException();
    const min = dto.gradeMin ?? current.grade_min;
    const max = dto.gradeMax ?? current.grade_max;
    if (min > max) throw new TaxonomyConflictException('grade_range');
    // Narrowing must not strand existing items or skills outside the range.
    const outside = await this.db.one<{ n: number }>(
      `SELECT ((SELECT count(*) FROM item WHERE topic_code = $1 AND grade NOT BETWEEN $2 AND $3)
             + (SELECT count(*) FROM skill WHERE topic_code = $1 AND grade NOT BETWEEN $2 AND $3))::int AS n`,
      [code, min, max],
    );
    if (outside && outside.n > 0) throw new TaxonomyConflictException('in_use');

    await this.db.query(
      `UPDATE topic SET name_uz = COALESCE($2, name_uz), name_ru = COALESCE($3, name_ru),
                        grade_min = $4, grade_max = $5, sort = COALESCE($6, sort)
        WHERE code = $1`,
      [code, dto.nameUz?.trim() || null, dto.nameRu?.trim() || null, min, max, dto.sort ?? null],
    );
    await this.log(actor, 'topic.updated', code);
    return this.all();
  }

  // ---------------------------------------------------------------- skills

  async createSkill(actor: Actor, dto: CreateSkillDto) {
    await this.assertTopicCovers(dto.topicCode, dto.grade);
    await this.insert(
      `INSERT INTO skill (code, topic_code, grade, name_uz, name_ru) VALUES ($1, $2, $3, $4, $5)`,
      [dto.code, dto.topicCode, dto.grade, dto.nameUz.trim(), dto.nameRu.trim()],
    );
    await this.log(actor, 'skill.created', dto.code);
    return this.all();
  }

  async patchSkill(actor: Actor, code: string, dto: PatchSkillDto) {
    const rows = await this.db.query(
      `UPDATE skill SET name_uz = COALESCE($2, name_uz), name_ru = COALESCE($3, name_ru)
        WHERE code = $1 RETURNING code`,
      [code, dto.nameUz?.trim() || null, dto.nameRu?.trim() || null],
    );
    if (!rows.length) throw new BankNotFoundException();
    await this.log(actor, 'skill.updated', code);
    return this.all();
  }

  // -------------------------------------------------------- misconceptions

  async createMisconception(actor: Actor, dto: CreateMisconceptionDto) {
    const topic = await this.db.one(`SELECT 1 FROM topic WHERE code = $1`, [dto.topicCode]);
    if (!topic) throw new TaxonomyConflictException('topic_unknown');
    await this.insert(
      `INSERT INTO misconception (code, topic_code, name_uz, name_ru, explain_uz, explain_ru)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        dto.code,
        dto.topicCode,
        dto.nameUz.trim(),
        dto.nameRu.trim(),
        dto.explainUz.trim(),
        dto.explainRu.trim(),
      ],
    );
    await this.log(actor, 'misconception.created', dto.code);
    return this.all();
  }

  async patchMisconception(actor: Actor, code: string, dto: PatchMisconceptionDto) {
    const rows = await this.db.query(
      `UPDATE misconception
          SET name_uz = COALESCE($2, name_uz), name_ru = COALESCE($3, name_ru),
              explain_uz = COALESCE($4, explain_uz), explain_ru = COALESCE($5, explain_ru)
        WHERE code = $1 RETURNING code`,
      [
        code,
        dto.nameUz?.trim() || null,
        dto.nameRu?.trim() || null,
        dto.explainUz?.trim() || null,
        dto.explainRu?.trim() || null,
      ],
    );
    if (!rows.length) throw new BankNotFoundException();
    await this.log(actor, 'misconception.updated', code);
    return this.all();
  }

  /**
   * Retired codes stay on the options that already use them (a frozen version
   * cannot change, INV-09) but are no longer offered for new ones.
   */
  async setMisconceptionRetired(actor: Actor, code: string, retired: boolean) {
    const rows = await this.db.query(
      `UPDATE misconception SET retired_at = CASE WHEN $2 THEN COALESCE(retired_at, now()) ELSE NULL END
        WHERE code = $1 RETURNING code`,
      [code, retired],
    );
    if (!rows.length) throw new BankNotFoundException();
    await this.log(actor, retired ? 'misconception.retired' : 'misconception.restored', code);
    return this.all();
  }

  // ------------------------------------------------------------- helpers

  private async assertTopicCovers(topicCode: string, grade: number): Promise<void> {
    const t = await this.db.one<{ grade_min: number; grade_max: number }>(
      `SELECT grade_min, grade_max FROM topic WHERE code = $1`,
      [topicCode],
    );
    if (!t) throw new TaxonomyConflictException('topic_unknown');
    if (grade < t.grade_min || grade > t.grade_max) throw new TaxonomyConflictException('grade_range');
  }

  private async insert(sql: string, params: unknown[]): Promise<void> {
    try {
      await this.db.query(sql, params);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new TaxonomyConflictException('exists');
      throw err;
    }
  }

  private log(actor: Actor, change: string, code: string) {
    return this.audit.write({ action: 'taxonomy.changed', personId: actor.personId, payload: { change, entry: code } });
  }
}
