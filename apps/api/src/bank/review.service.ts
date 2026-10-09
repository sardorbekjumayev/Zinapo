import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor } from '../authz';
import { MediaService } from '../media/media.service';
import { NotifyService } from '../notify/notify.service';
import { BankNotFoundException, ReviewStateException } from './bank.errors';

export type Verdict = 'accept' | 'revise' | 'reject';

/**
 * Two-hand review (task.md § 8.5, design/13).
 *
 *   1. The reviewer gets the stem and options WITHOUT the key and solves blind.
 *      The answer is stored before anything is revealed.
 *   2. The key and the rationales are revealed. If the reviewer's answer
 *      disagrees with the author's key, the item is rejected automatically —
 *      either it reads two ways or the key is wrong.
 *   3. Otherwise the reviewer gives a verdict: accept / revise / reject, with a
 *      required note for revise and reject (the schema checks that too).
 *
 * Nobody reviews their own item (`item_review_no_self` in the DB; here a clean
 * 409). One decided review settles a version: the first verdict wins.
 *
 * Accept sets `accepted_at` — authors are paid per ACCEPTED item (§ 2.1) — and
 * moves the item to `accepted`; the bank editor approves it later (M3-b).
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
    private readonly notify: NotifyService,
  ) {}

  /** The queue: versions under review that are not mine and not yet decided. */
  async queue(actor: Actor) {
    const items = await this.db.query(
      `SELECT v.id AS "versionId", i.id AS "itemId", i.code, i.grade, t.cluster,
              i.topic_code AS "topicCode", a.full_name AS "authorName", v.version,
              v.submitted_at AS "submittedAt",
              (SELECT r.blind_submitted_at IS NOT NULL FROM item_review r
                WHERE r.item_version_id = v.id AND r.reviewer_person_id = $1) AS "solvedByMe"
         FROM item i
         JOIN item_version v ON v.item_id = i.id
          AND v.version = (SELECT max(version) FROM item_version WHERE item_id = i.id)
         JOIN topic t ON t.code = i.topic_code
         JOIN person a ON a.id = i.author_person_id
        WHERE i.status = 'in_review'
          AND v.frozen_at IS NOT NULL
          AND i.author_person_id <> $1
          AND v.created_by <> $1
          AND NOT EXISTS (SELECT 1 FROM item_review r
                           WHERE r.item_version_id = v.id AND r.decided_at IS NOT NULL)
        ORDER BY v.submitted_at`,
      [actor.personId],
    );
    const mine = await this.db.one<{ accept: number; revise: number; reject: number }>(
      `SELECT count(*) FILTER (WHERE verdict = 'accept')::int AS accept,
              count(*) FILTER (WHERE verdict = 'revise')::int AS revise,
              count(*) FILTER (WHERE verdict IN ('reject', 'auto_reject'))::int AS reject
         FROM item_review
        WHERE reviewer_person_id = $1
          AND decided_at >= COALESCE((SELECT starts_on FROM season WHERE is_current), '1970-01-01')`,
      [actor.personId],
    );
    return { items, mine };
  }

  /**
   * Opens one version for review. Before the blind solve: stem and options
   * only — no key, no misconception codes, no rationales. After it: everything.
   */
  async open(actor: Actor, versionId: string) {
    const v = await this.loadVersion(versionId);
    if (v.author_person_id === actor.personId || v.created_by === actor.personId) {
      throw new ReviewStateException('own_item');
    }
    const decided = await this.decidedReview(versionId);
    const mine = await this.db.one<{
      blind_option_id: string | null;
      blind_submitted_at: Date | null;
      blind_was_correct: boolean | null;
      verdict: string | null;
      note: string | null;
      decided_at: Date | null;
    }>(
      `SELECT * FROM item_review WHERE item_version_id = $1 AND reviewer_person_id = $2`,
      [versionId, actor.personId],
    );
    if (v.status !== 'in_review' && !mine) throw new ReviewStateException('not_in_review');

    const solved = !!mine?.blind_submitted_at;
    const options = await this.db.query<{
      id: string;
      position: number;
      label_uz: string;
      label_ru: string;
      image_ref: string | null;
      is_key: boolean;
      misconception_code: string | null;
      rationale: string | null;
      m_name_uz: string | null;
      m_name_ru: string | null;
    }>(
      `SELECT o.*, m.name_uz AS m_name_uz, m.name_ru AS m_name_ru
         FROM item_option o LEFT JOIN misconception m ON m.code = o.misconception_code
        WHERE o.item_version_id = $1 ORDER BY o.position`,
      [versionId],
    );

    return {
      versionId,
      itemId: v.item_id,
      code: v.code,
      grade: v.grade,
      cluster: v.cluster,
      topicCode: v.topic_code,
      construct: v.construct,
      authorName: v.author_name,
      version: v.version,
      expectedP: solved && v.expected_p !== null ? Number(v.expected_p) : null,
      stemFormat: v.stem_format,
      stemUz: v.stem_uz,
      stemRu: v.stem_ru,
      image: v.image_ref ? { ref: v.image_ref, url: this.media.signedUrl(v.image_ref) } : null,
      audioUz: v.audio_ref_uz ? { ref: v.audio_ref_uz, url: this.media.signedUrl(v.audio_ref_uz) } : null,
      audioRu: v.audio_ref_ru ? { ref: v.audio_ref_ru, url: this.media.signedUrl(v.audio_ref_ru) } : null,
      options: options.map((o) => ({
        id: o.id,
        position: o.position,
        labelUz: o.label_uz,
        labelRu: o.label_ru,
        image: o.image_ref ? { ref: o.image_ref, url: this.media.signedUrl(o.image_ref) } : null,
        ...(solved
          ? {
              isKey: o.is_key,
              misconceptionCode: o.misconception_code,
              misconceptionNameUz: o.m_name_uz,
              misconceptionNameRu: o.m_name_ru,
              rationale: o.rationale,
            }
          : {}),
      })),
      step: !solved ? 'solve' : mine?.decided_at ? 'done' : 'verdict',
      myAnswer: solved ? mine!.blind_option_id : null,
      agreed: solved ? mine!.blind_was_correct : null,
      verdict: mine?.verdict ?? null,
      note: mine?.note ?? null,
      // Someone else already settled this version.
      decidedByOther: !!decided && decided.reviewer_person_id !== actor.personId,
    };
  }

  /** Step 1: the blind answer. A disagreement rejects the item on the spot. */
  async solve(actor: Actor, versionId: string, optionId: string) {
    const v = await this.loadVersion(versionId);
    if (v.author_person_id === actor.personId || v.created_by === actor.personId) {
      throw new ReviewStateException('own_item');
    }
    if (v.status !== 'in_review') throw new ReviewStateException('not_in_review');
    if (await this.decidedReview(versionId)) throw new ReviewStateException('decided');

    const option = await this.db.one<{ is_key: boolean }>(
      `SELECT is_key FROM item_option WHERE id = $1 AND item_version_id = $2`,
      [optionId, versionId],
    );
    if (!option) throw new BankNotFoundException('OPTION_NOT_FOUND');

    const agreed = option.is_key;
    const outcome = await this.db.transaction(async (client) => {
      const row = await client.query<{ id: string; blind_submitted_at: Date | null }>(
        `INSERT INTO item_review (item_version_id, reviewer_person_id)
         VALUES ($1, $2)
         ON CONFLICT (item_version_id, reviewer_person_id) DO UPDATE SET assigned_at = item_review.assigned_at
         RETURNING id, blind_submitted_at`,
        [versionId, actor.personId],
      );
      if (row.rows[0].blind_submitted_at) throw new ReviewStateException('already_solved');

      await client.query(
        `UPDATE item_review
            SET blind_option_id = $2, blind_submitted_at = now(), blind_was_correct = $3
          WHERE id = $1`,
        [row.rows[0].id, optionId, agreed],
      );
      if (agreed) return 'continue';

      // Disagreement: rejected automatically, no note needed (design/13).
      await client.query(
        `UPDATE item_review SET verdict = 'auto_reject', decided_at = now() WHERE id = $1`,
        [row.rows[0].id],
      );
      await client.query(`UPDATE item SET status = 'rejected' WHERE id = $1`, [v.item_id]);
      return 'auto_reject';
    });

    if (outcome === 'auto_reject') await this.after(actor, v, 'auto_reject');
    return this.open(actor, versionId);
  }

  /** Step 2: the verdict, only after an agreeing blind solve. */
  async decide(actor: Actor, versionId: string, verdict: Verdict, note: string | undefined) {
    const v = await this.loadVersion(versionId);
    if (v.status !== 'in_review') throw new ReviewStateException('not_in_review');
    if (await this.decidedReview(versionId)) throw new ReviewStateException('decided');

    const mine = await this.db.one<{ id: string; blind_submitted_at: Date | null; blind_was_correct: boolean }>(
      `SELECT id, blind_submitted_at, blind_was_correct FROM item_review
        WHERE item_version_id = $1 AND reviewer_person_id = $2`,
      [versionId, actor.personId],
    );
    if (!mine?.blind_submitted_at) throw new ReviewStateException('not_solved');
    if (!mine.blind_was_correct) throw new ReviewStateException('disagreed');
    if (verdict !== 'accept' && !note?.trim()) throw new ReviewStateException('note_required');

    const status = verdict === 'accept' ? 'accepted' : verdict === 'revise' ? 'draft' : 'rejected';
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE item_review SET verdict = $2, note = $3, decided_at = now() WHERE id = $1`,
        [mine.id, verdict, note?.trim() || null],
      );
      await client.query(
        `UPDATE item SET status = $2::item_status,
                accepted_at = CASE WHEN $3 THEN COALESCE(accepted_at, now()) ELSE accepted_at END
          WHERE id = $1`,
        [v.item_id, status, status === 'accepted'],
      );
    });

    await this.after(actor, v, verdict);
    return this.open(actor, versionId);
  }

  // ------------------------------------------------------------ helpers

  private async after(actor: Actor, v: VersionRow, verdict: Verdict | 'auto_reject'): Promise<void> {
    await this.audit.write({
      action: 'item.reviewed',
      personId: actor.personId,
      payload: { itemId: v.item_id, version: v.version, verdict },
    });
    await this.notify.queue({
      personId: v.author_person_id,
      template: 'item_reviewed',
      vars: { item: v.code, verdict },
    });
  }

  private async decidedReview(versionId: string) {
    return this.db.one<{ reviewer_person_id: string }>(
      `SELECT reviewer_person_id FROM item_review WHERE item_version_id = $1 AND decided_at IS NOT NULL LIMIT 1`,
      [versionId],
    );
  }

  private async loadVersion(versionId: string): Promise<VersionRow> {
    if (!UUID.test(versionId)) throw new BankNotFoundException();
    const v = await this.db.one<VersionRow>(
      `SELECT v.*, i.code, i.grade, i.status, i.topic_code, i.construct, i.author_person_id,
              t.cluster, a.full_name AS author_name
         FROM item_version v
         JOIN item i ON i.id = v.item_id
         JOIN topic t ON t.code = i.topic_code
         JOIN person a ON a.id = i.author_person_id
        WHERE v.id = $1 AND v.frozen_at IS NOT NULL`,
      [versionId],
    );
    if (!v) throw new BankNotFoundException();
    return v;
  }
}

interface VersionRow {
  id: string;
  item_id: string;
  version: number;
  created_by: string;
  stem_format: string;
  stem_uz: string;
  stem_ru: string;
  image_ref: string | null;
  audio_ref_uz: string | null;
  audio_ref_ru: string | null;
  expected_p: string | null;
  code: string;
  grade: number;
  status: string;
  topic_code: string;
  construct: string;
  author_person_id: string;
  cluster: string;
  author_name: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
