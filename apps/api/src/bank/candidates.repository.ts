import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type FormMode = 'monitoring' | 'practice' | 'olympiad';
export type SlotRole = 'scored' | 'anchor' | 'pretest';

export interface Candidate {
  itemVersionId: string;
  itemId: string;
  code: string;
  grade: number;
  cluster: string;
  topicCode: string;
  isAnchor: boolean;
  anchorKind: 'horizontal' | 'vertical' | null;
  anchorLinkGrade: number | null;
  status: string;
  version: number;
  expectedP: number | null;
  difficultyB: number | null;
  stemUz: string;
}

/**
 * The ONE query that decides which item versions may fill a form position.
 *
 * task.md § 1.8 / INV-08: "Anchor items never appear in practice forms. Enforce
 * this in the QUERY that selects candidate items, not in the UI." The line
 * marked INV-08 below is that enforcement; the `form_item_anchor_rules` trigger
 * is only the second line of defence. The form builder uses this repository,
 * and so must M6's practice builder — there is no other door into a form.
 *
 * Eligibility by slot (note M3-b):
 *   anchor  — an approved anchor
 *   scored  — an approved non-anchor
 *   pretest — an accepted item (reviewed, not yet calibrated or approved)
 * Always the latest FROZEN version, never a retired item, never an item the
 * form already holds.
 */
@Injectable()
export class CandidatesRepository {
  constructor(private readonly db: DbService) {}

  async find(opts: {
    mode: FormMode;
    grade: number;
    role: SlotRole;
    formId?: string | null;
    cluster?: string;
    topic?: string;
    q?: string;
    itemVersionId?: string;
    limit?: number;
  }): Promise<Candidate[]> {
    const params: unknown[] = [opts.mode, opts.grade, opts.role, opts.formId ?? null];
    const extra: string[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (opts.cluster) extra.push(`t.cluster = ${p(opts.cluster)}`);
    if (opts.topic) extra.push(`i.topic_code = ${p(opts.topic)}`);
    if (opts.q) extra.push(`i.code ILIKE ${p(`%${opts.q}%`)}`);
    if (opts.itemVersionId) extra.push(`v.id = ${p(opts.itemVersionId)}`);
    const limit = p(opts.limit ?? 50);

    return this.db.query<Candidate>(
      `SELECT v.id AS "itemVersionId", i.id AS "itemId", i.code, i.grade, t.cluster::text AS cluster,
              i.topic_code AS "topicCode", i.is_anchor AS "isAnchor", i.anchor_kind::text AS "anchorKind",
              i.anchor_link_grade AS "anchorLinkGrade", i.status::text AS status, v.version,
              v.expected_p::float8 AS "expectedP", st.difficulty_b::float8 AS "difficultyB",
              left(v.stem_uz, 160) AS "stemUz"
         FROM item i
         JOIN topic t ON t.code = i.topic_code
         JOIN LATERAL (SELECT * FROM item_version v
                        WHERE v.item_id = i.id AND v.frozen_at IS NOT NULL
                        ORDER BY v.version DESC LIMIT 1) v ON true
    LEFT JOIN LATERAL (SELECT s.difficulty_b FROM item_statistic s
                         JOIN calibration_run cr ON cr.id = s.calibration_run_id
                        WHERE s.item_version_id = v.id
                        ORDER BY (cr.is_current AND EXISTS (SELECT 1 FROM season se WHERE se.id = cr.season_id AND se.is_current)) DESC,
                                 cr.is_current DESC, cr.started_at DESC LIMIT 1) st ON true
        WHERE i.retired_at IS NULL
          -- INV-08: an anchor can never be a candidate for a practice form.
          AND NOT ($1::form_mode = 'practice' AND i.is_anchor)
          AND (i.grade = $2
               OR (i.is_anchor AND i.anchor_kind = 'vertical' AND i.anchor_link_grade = $2))
          AND CASE $3::text
                WHEN 'anchor'  THEN i.is_anchor AND i.status = 'approved'
                WHEN 'scored'  THEN NOT i.is_anchor AND i.status = 'approved'
                WHEN 'pretest' THEN i.status = 'accepted'
                ELSE false
              END
          AND NOT EXISTS (SELECT 1 FROM form_item fi JOIN item_version v2 ON v2.id = fi.item_version_id
                           WHERE fi.form_id = $4::uuid AND v2.item_id = i.id)
          ${extra.length ? `AND ${extra.join(' AND ')}` : ''}
        ORDER BY t.cluster, COALESCE(st.difficulty_b, 0), i.code
        LIMIT ${limit}`,
      params,
    );
  }
}
