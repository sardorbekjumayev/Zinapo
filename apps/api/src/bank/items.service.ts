import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { Actor, hasPermission } from '../authz';
import { MediaService } from '../media/media.service';
import {
  BankNotFoundException,
  ItemIncompleteException,
  ItemInvalidException,
  ItemStateException,
} from './bank.errors';
import {
  CreateItemDto,
  DraftOptionDto,
  ItemListQueryDto,
  SaveDraftDto,
  SetAnchorDto,
  StemFormat,
} from './dto/items.dto';

export type ItemStatus = 'draft' | 'in_review' | 'accepted' | 'approved' | 'rejected' | 'retired';

/** What an unsubmitted version holds (`item_version.draft`). */
export interface DraftContent {
  stemFormat: StemFormat;
  stemUz: string;
  stemRu: string;
  imageRef: string | null;
  audioRefUz: string | null;
  audioRefRu: string | null;
  expectedP: number | null;
  options: DraftOption[];
}

export interface DraftOption {
  labelUz: string;
  labelRu: string;
  imageRef: string | null;
  isKey: boolean;
  misconceptionCode: string | null;
  rationale: string | null;
}

/** design/12 shows four options, A–D. Three to five is allowed. */
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 5;

/** design/11 flags: p outside 0.20–0.85, point-biserial < 0.20, a distractor < 5 %, DIF. */
const FLAG = { pLow: 0.2, pHigh: 0.85, rMin: 0.2, deadShare: 0.05, difMax: 0.5 } as const;

function blankDraft(): DraftContent {
  return {
    stemFormat: 'text',
    stemUz: '',
    stemRu: '',
    imageRef: null,
    audioRefUz: null,
    audioRefRu: null,
    expectedP: null,
    options: Array.from({ length: 4 }, () => ({
      labelUz: '',
      labelRu: '',
      imageRef: null,
      isKey: false,
      misconceptionCode: null,
      rationale: null,
    })),
  };
}

interface ItemRow {
  id: string;
  code: string;
  author_person_id: string;
  topic_code: string;
  skill_code: string | null;
  grade: number;
  construct: string;
  status: ItemStatus;
  is_anchor: boolean;
  anchor_kind: 'horizontal' | 'vertical' | null;
  anchor_link_grade: number | null;
  accepted_at: Date | null;
  retired_at: Date | null;
}

/**
 * task.md § 6 (`bank`) and § 8.5 — the item card from writing to approval.
 *
 *   draft ──submit──▶ in_review ──accept──▶ accepted ──approve──▶ approved
 *     ▲                 │  revise                         (bank editor)
 *     └── new version ◀─┤  reject / auto-reject ──▶ rejected
 *
 * Submitting FREEZES the version (INV-09): the reviewer answers exactly what
 * was submitted, and any later change — "even a fixed comma" (design/12) — is
 * a new version with its own review and its own statistics. An accepted item
 * may fill pretest slots only; approval is what lets it be scored or anchored
 * (note M3-b).
 *
 * Must never: update a frozen version (the schema refuses anyway).
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  // =============================================================== list

  async list(actor: Actor, q: ItemListQueryDto) {
    const ownOnly = !hasPermission(actor.staffRoles, 'item.read.all') || q.scope === 'mine';
    const perPage = q.perPage ?? 25;
    const page = q.page ?? 1;

    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (ownOnly) where.push(`i.author_person_id = ${p(actor.personId)}`);
    if (q.grade !== undefined) where.push(`i.grade = ${p(q.grade)}`);
    if (q.cluster) where.push(`t.cluster = ${p(q.cluster)}`);
    if (q.topic) where.push(`i.topic_code = ${p(q.topic)}`);
    if (q.status) where.push(`i.status = ${p(q.status)}`);
    if (q.role === 'core') where.push(`i.status = 'approved' AND NOT i.is_anchor`);
    if (q.role === 'anchor_h') where.push(`i.is_anchor AND i.anchor_kind = 'horizontal'`);
    if (q.role === 'anchor_v') where.push(`i.is_anchor AND i.anchor_kind = 'vertical'`);
    if (q.role === 'pretest') where.push(`i.status = 'accepted'`);
    if (q.lang === 'uz') where.push(`length(trim(COALESCE(v.draft->>'stemUz', v.stem_uz))) > 0`);
    if (q.lang === 'ru') where.push(`length(trim(COALESCE(v.draft->>'stemRu', v.stem_ru))) > 0`);
    if (q.q) where.push(`i.code ILIKE ${p(`%${q.q.trim()}%`)}`);
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const joins = `
      FROM item i
      JOIN topic t ON t.code = i.topic_code
      JOIN person a ON a.id = i.author_person_id
      JOIN LATERAL (SELECT * FROM item_version v WHERE v.item_id = i.id
                     ORDER BY v.version DESC LIMIT 1) v ON true`;

    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n ${joins} ${filter}`, params);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT i.id, i.code, i.grade, t.cluster, i.topic_code AS "topicCode", i.status,
              i.is_anchor AS "isAnchor", i.anchor_kind AS "anchorKind",
              i.anchor_link_grade AS "anchorLinkGrade",
              a.full_name AS "authorName", (i.author_person_id = ${p(actor.personId)}) AS "isMine",
              v.version, v.frozen_at IS NOT NULL AS "frozen",
              left(COALESCE(NULLIF(v.draft->>'stemUz', ''), v.stem_uz), 140) AS "stemUz",
              left(COALESCE(NULLIF(v.draft->>'stemRu', ''), v.stem_ru), 140) AS "stemRu",
              s.p, s.point_biserial AS "pointBiserial", s.dif_uz_ru AS "difUzRu",
              s.distractor_share AS "distractorShare", s.n
         ${joins}
    LEFT JOIN LATERAL (
              SELECT st.* FROM item_statistic st
                JOIN calibration_run cr ON cr.id = st.calibration_run_id
               WHERE st.item_version_id = v.id
               ORDER BY (cr.is_current AND EXISTS (SELECT 1 FROM season se WHERE se.id = cr.season_id AND se.is_current)) DESC,
                                 cr.is_current DESC, cr.started_at DESC LIMIT 1) s ON true
         ${filter}
        ORDER BY i.grade, i.code
        LIMIT ${p(perPage)} OFFSET ${p((page - 1) * perPage)}`,
      params,
    );

    return {
      items: rows.map((r) => ({
        ...r,
        langs: (['uz', 'ru'] as const).filter((l) => String(r[l === 'uz' ? 'stemUz' : 'stemRu'] ?? '').trim()),
        flags: flagsOf(r),
        stats: r.n === null || r.n === undefined ? null : { n: r.n, p: num(r.p), pointBiserial: num(r.pointBiserial) },
      })),
      total: total?.n ?? 0,
      page,
      perPage,
      overview: ownOnly ? null : await this.overview(),
    };
  }

  /** design/11's tiles: per grade, live items against the season target. */
  async overview() {
    const season = await this.db.one<{ id: string; code: string; starts_on: string }>(
      `SELECT id, code, starts_on::text FROM season WHERE is_current`,
    );
    const tiles = await this.db.query<{
      grade: number;
      target: number | null;
      approved: number;
      accepted: number;
      in_review: number;
      draft: number;
    }>(
      `SELECT g.grade,
              tg.target_live AS target,
              count(i.*) FILTER (WHERE i.status = 'approved')::int  AS approved,
              count(i.*) FILTER (WHERE i.status = 'accepted')::int  AS accepted,
              count(i.*) FILTER (WHERE i.status = 'in_review')::int AS in_review,
              count(i.*) FILTER (WHERE i.status = 'draft')::int     AS draft
         FROM generate_series(0, 4) AS g(grade)
    LEFT JOIN item i ON i.grade = g.grade
    LEFT JOIN item_bank_target tg ON tg.grade = g.grade AND tg.season_id = $1
        GROUP BY g.grade, tg.target_live
        ORDER BY g.grade`,
      [season?.id ?? null],
    );
    const since = season?.starts_on ?? '1970-01-01';
    const totals = await this.db.one<{ written: number; approved: number; decided: number; rejected: number }>(
      `SELECT (SELECT count(*) FROM item WHERE created_at >= $1)::int AS written,
              (SELECT count(*) FROM item WHERE status = 'approved')::int AS approved,
              (SELECT count(*) FROM item_review WHERE decided_at >= $1)::int AS decided,
              (SELECT count(*) FROM item_review
                WHERE decided_at >= $1 AND verdict IN ('reject', 'auto_reject'))::int AS rejected`,
      [since],
    );
    return {
      season: season ? { id: season.id, code: season.code } : null,
      tiles: tiles.map((t) => ({
        grade: t.grade,
        target: t.target,
        approved: t.approved,
        accepted: t.accepted,
        inReview: t.in_review,
        draft: t.draft,
      })),
      totals,
    };
  }

  async setTargets(actor: Actor, targets: { grade: number; target: number }[]) {
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!season) throw new ItemStateException('no_current_season');
    for (const t of targets) {
      await this.db.query(
        `INSERT INTO item_bank_target (season_id, grade, target_live, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (season_id, grade)
         DO UPDATE SET target_live = EXCLUDED.target_live, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [season.id, t.grade, t.target, actor.personId],
      );
    }
    return this.overview();
  }

  // ================================================================ read

  /** The full card: item, every version with its options, reviews and statistics. */
  async get(actor: Actor, id: string) {
    const item = await this.load(id);
    const mine = item.author_person_id === actor.personId;
    const editor = hasPermission(actor.staffRoles, 'item.approve');
    if (!mine && !hasPermission(actor.staffRoles, 'item.read.all')) throw new BankNotFoundException();

    // A reviewer must not see the key before solving blind (task.md § 8.5).
    // Keys and rationales of a version under review are for its author and
    // the bank editor only; the reviewer gets them from the review flow.
    const canSeeKeys = (frozenUnderReview: boolean) => mine || editor || !frozenUnderReview;

    const topic = await this.db.one<{ cluster: string; name_uz: string; name_ru: string }>(
      `SELECT cluster, name_uz, name_ru FROM topic WHERE code = $1`,
      [item.topic_code],
    );
    const author = await this.db.one<{ full_name: string }>(`SELECT full_name FROM person WHERE id = $1`, [
      item.author_person_id,
    ]);

    const versions = await this.db.query<{
      id: string;
      version: number;
      stem_format: StemFormat;
      stem_uz: string;
      stem_ru: string;
      image_ref: string | null;
      audio_ref_uz: string | null;
      audio_ref_ru: string | null;
      expected_p: string | null;
      frozen_at: Date | null;
      submitted_at: Date | null;
      created_at: Date;
      created_by_name: string;
      draft: DraftContent | null;
    }>(
      `SELECT v.*, p.full_name AS created_by_name
         FROM item_version v JOIN person p ON p.id = v.created_by
        WHERE v.item_id = $1 ORDER BY v.version DESC`,
      [id],
    );

    const out = [];
    for (const v of versions) {
      const underReview = item.status === 'in_review' && v.version === versions[0].version;
      const showKeys = canSeeKeys(underReview);
      const content: DraftContent = v.frozen_at
        ? await this.frozenContent(v)
        : { ...blankDraft(), ...(v.draft ?? {}) };

      const reviews = await this.db.query(
        `SELECT r.id, p.full_name AS "reviewerName", r.verdict, r.note,
                r.blind_was_correct AS "blindWasCorrect", r.decided_at AS "decidedAt"
           FROM item_review r JOIN person p ON p.id = r.reviewer_person_id
          WHERE r.item_version_id = $1 AND r.decided_at IS NOT NULL
          ORDER BY r.decided_at`,
        [v.id],
      );
      const stats = await this.db.one(
        `SELECT st.n, st.p, st.point_biserial AS "pointBiserial", st.dif_uz_ru AS "difUzRu",
                st.difficulty_b AS "difficultyB", st.distractor_share AS "distractorShare",
                cr.method, cr.started_at AS "runAt"
           FROM item_statistic st JOIN calibration_run cr ON cr.id = st.calibration_run_id
          WHERE st.item_version_id = $1
          ORDER BY (cr.is_current AND EXISTS (SELECT 1 FROM season se WHERE se.id = cr.season_id AND se.is_current)) DESC,
                                 cr.is_current DESC, cr.started_at DESC LIMIT 1`,
        [v.id],
      );

      out.push({
        id: v.id,
        version: v.version,
        frozenAt: v.frozen_at,
        submittedAt: v.submitted_at,
        createdAt: v.created_at,
        createdByName: v.created_by_name,
        stemFormat: content.stemFormat,
        stemUz: content.stemUz,
        stemRu: content.stemRu,
        expectedP: content.expectedP,
        image: this.mediaOut(content.imageRef),
        audioUz: this.mediaOut(content.audioRefUz),
        audioRu: this.mediaOut(content.audioRefRu),
        options: content.options.map((o, i) => ({
          position: i + 1,
          labelUz: o.labelUz,
          labelRu: o.labelRu,
          image: this.mediaOut(o.imageRef),
          ...(showKeys
            ? { isKey: o.isKey, misconceptionCode: o.misconceptionCode, rationale: o.rationale }
            : {}),
        })),
        keysHidden: !showKeys,
        reviews: mine || editor ? reviews : [],
        stats,
      });
    }

    const usedIn = await this.db.query(
      `SELECT DISTINCT f.id, f.label, f.mode, f.grade, f.frozen_at AS "frozenAt", fi.slot_role AS "slotRole"
         FROM form_item fi JOIN form f ON f.id = fi.form_id
         JOIN item_version v ON v.id = fi.item_version_id
        WHERE v.item_id = $1`,
      [id],
    );
    const accepted = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM item
        WHERE author_person_id = $1 AND accepted_at >= (SELECT starts_on FROM season WHERE is_current)`,
      [item.author_person_id],
    );

    const latest = versions[0];
    const editable = !!latest && !latest.frozen_at && item.status === 'draft' && (mine || editor);
    return {
      id: item.id,
      code: item.code,
      grade: item.grade,
      topicCode: item.topic_code,
      topicNameUz: topic?.name_uz,
      topicNameRu: topic?.name_ru,
      cluster: topic?.cluster,
      skillCode: item.skill_code,
      construct: item.construct,
      status: item.status,
      isAnchor: item.is_anchor,
      anchorKind: item.anchor_kind,
      anchorLinkGrade: item.anchor_link_grade,
      acceptedAt: item.accepted_at,
      retiredAt: item.retired_at,
      authorName: author?.full_name ?? '',
      isMine: mine,
      authorAcceptedThisSeason: accepted?.n ?? 0,
      versions: out,
      usedIn,
      can: {
        edit: editable,
        // Item-level fields lock once anything has been submitted: statistics
        // and forms refer to the item as it was.
        editItemFields: editable && versions.every((v) => !v.submitted_at),
        submit: editable,
        newVersion:
          (mine || editor) && !!latest?.frozen_at && ['draft', 'rejected', 'accepted', 'approved'].includes(item.status),
        approve: editor && item.status === 'accepted',
        retire: editor && item.status !== 'retired',
        setAnchor: editor && item.status === 'approved',
      },
    };
  }

  // =============================================================== write

  async create(actor: Actor, dto: CreateItemDto): Promise<{ id: string; code: string }> {
    await this.assertTopicSkill(dto.topicCode, dto.grade, dto.skillCode ?? null);

    const created = await this.db.transaction(async (client) => {
      const item = await client.query<{ id: string; code: string }>(
        `INSERT INTO item (author_person_id, topic_code, skill_code, grade, construct)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, code`,
        [actor.personId, dto.topicCode, dto.skillCode ?? null, dto.grade, dto.construct.trim()],
      );
      await client.query(
        `INSERT INTO item_version (item_id, version, stem_uz, stem_ru, created_by, draft)
         VALUES ($1, 1, '', '', $2, $3::jsonb)`,
        [item.rows[0].id, actor.personId, JSON.stringify(blankDraft())],
      );
      return item.rows[0];
    });

    await this.audit.write({
      action: 'item.created',
      personId: actor.personId,
      payload: { itemId: created.id, ref: created.code, grade: dto.grade, topic: dto.topicCode },
    });
    return created;
  }

  /** Saves the open draft. Item-level fields only before the first submit. */
  async saveDraft(actor: Actor, id: string, dto: SaveDraftDto) {
    const item = await this.load(id);
    this.assertCanWrite(actor, item);
    if (item.status !== 'draft') throw new ItemStateException('not_draft', { status: item.status });

    const latest = await this.latest(id);
    if (latest.frozen_at) throw new ItemStateException('frozen');

    const itemFields = dto.grade !== undefined || dto.topicCode !== undefined || dto.skillCode !== undefined || dto.construct !== undefined;
    if (itemFields) {
      const everSubmitted = await this.db.one(
        `SELECT 1 FROM item_version WHERE item_id = $1 AND submitted_at IS NOT NULL LIMIT 1`,
        [id],
      );
      if (everSubmitted) throw new ItemStateException('item_fields_locked');
      const grade = dto.grade ?? item.grade;
      const topic = dto.topicCode ?? item.topic_code;
      const skill = dto.skillCode === undefined ? item.skill_code : dto.skillCode;
      await this.assertTopicSkill(topic, grade, skill);
      await this.db.query(
        `UPDATE item SET grade = $2, topic_code = $3, skill_code = $4, construct = COALESCE($5, construct)
          WHERE id = $1`,
        [id, grade, topic, skill, dto.construct?.trim() || null],
      );
    }

    const current: DraftContent = { ...blankDraft(), ...(latest.draft ?? {}) };
    const next: DraftContent = {
      stemFormat: dto.stemFormat ?? current.stemFormat,
      stemUz: dto.stemUz ?? current.stemUz,
      stemRu: dto.stemRu ?? current.stemRu,
      imageRef: dto.imageRef === undefined ? current.imageRef : dto.imageRef,
      audioRefUz: dto.audioRefUz === undefined ? current.audioRefUz : dto.audioRefUz,
      audioRefRu: dto.audioRefRu === undefined ? current.audioRefRu : dto.audioRefRu,
      expectedP: dto.expectedP === undefined ? current.expectedP : dto.expectedP,
      options: dto.options ? dto.options.map(normaliseOption) : current.options,
    };
    if (next.options.length > MAX_OPTIONS) throw new ItemInvalidException('too_many_options');
    await this.assertMediaKnown(next);

    await this.db.query(`UPDATE item_version SET draft = $2::jsonb WHERE id = $1`, [
      latest.id,
      JSON.stringify(next),
    ]);
    await this.audit.write({
      action: 'item.updated',
      personId: actor.personId,
      payload: { itemId: id, version: latest.version },
    });
    return this.get(actor, id);
  }

  /**
   * Submit for review: validate completeness, write the real columns and the
   * option rows, and FREEZE the version — all in one transaction.
   */
  async submit(actor: Actor, id: string) {
    const item = await this.load(id);
    this.assertCanWrite(actor, item);
    if (item.status !== 'draft') throw new ItemStateException('not_draft', { status: item.status });
    const latest = await this.latest(id);
    if (latest.frozen_at) throw new ItemStateException('frozen');

    const draft: DraftContent = { ...blankDraft(), ...(latest.draft ?? {}) };
    const fields = await this.incompleteFields(item, draft);
    if (fields.length) throw new ItemIncompleteException(fields);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE item_version
            SET stem_format = $2, stem_uz = $3, stem_ru = $4, image_ref = $5,
                audio_ref_uz = $6, audio_ref_ru = $7, expected_p = $8
          WHERE id = $1`,
        [
          latest.id,
          draft.stemFormat,
          draft.stemUz.trim(),
          draft.stemRu.trim(),
          draft.stemFormat === 'text' ? null : draft.imageRef,
          draft.stemFormat === 'image_audio' ? draft.audioRefUz : null,
          draft.stemFormat === 'image_audio' ? draft.audioRefRu : null,
          draft.expectedP,
        ],
      );
      await this.writeOptions(client, latest.id, draft.options);
      await client.query(
        `UPDATE item_version SET frozen_at = now(), submitted_at = now(), draft = NULL WHERE id = $1`,
        [latest.id],
      );
      await client.query(`UPDATE item SET status = 'in_review' WHERE id = $1`, [id]);
    });

    await this.audit.write({ action: 'item.submitted', personId: actor.personId, payload: { itemId: id, version: latest.version } });
    await this.audit.write({ action: 'item_version.frozen', personId: actor.personId, payload: { itemId: id, version: latest.version } });
    return this.get(actor, id);
  }

  /**
   * "Create a new version" (design/12): a copy of the latest frozen version as
   * an editable draft. The item goes back to `draft` — whatever comes next has
   * to pass review again — while frozen forms keep the version they froze.
   */
  async newVersion(actor: Actor, id: string) {
    const item = await this.load(id);
    this.assertCanWrite(actor, item);
    if (!['draft', 'rejected', 'accepted', 'approved'].includes(item.status)) {
      throw new ItemStateException('cannot_version', { status: item.status });
    }
    const latest = await this.latest(id);
    if (!latest.frozen_at) throw new ItemStateException('draft_exists');

    const content = await this.frozenContent(latest);
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO item_version (item_id, version, stem_format, stem_uz, stem_ru, created_by, draft)
         VALUES ($1, $2, 'text', '', '', $3, $4::jsonb)`,
        [id, latest.version + 1, actor.personId, JSON.stringify(content)],
      );
      await client.query(`UPDATE item SET status = 'draft' WHERE id = $1`, [id]);
    });
    await this.audit.write({
      action: 'item.version_created',
      personId: actor.personId,
      payload: { itemId: id, version: latest.version + 1, from: item.status },
    });
    return this.get(actor, id);
  }

  /** The bank editor's approval: an accepted (reviewed) item may now be scored. */
  async approve(actor: Actor, id: string) {
    const item = await this.load(id);
    if (item.status !== 'accepted') throw new ItemStateException('not_accepted', { status: item.status });
    await this.db.query(`UPDATE item SET status = 'approved' WHERE id = $1`, [id]);
    await this.audit.write({ action: 'item.approved', personId: actor.personId, payload: { itemId: id } });
    return this.get(actor, id);
  }

  async retire(actor: Actor, id: string) {
    const item = await this.load(id);
    if (item.status === 'retired') throw new ItemStateException('retired');
    await this.db.query(`UPDATE item SET status = 'retired', retired_at = now() WHERE id = $1`, [id]);
    await this.audit.write({ action: 'item.retired', personId: actor.personId, payload: { itemId: id, from: item.status } });
    return this.get(actor, id);
  }

  /**
   * Designate (or drop) an anchor — the bank editor's call, on an approved
   * item (task.md § 8.5). Vertical anchors link to the grade above (design/12:
   * "Shared with the grade above"); grade 4 is the top and has none. An anchor
   * already holding an anchor slot in a frozen form cannot be un-anchored: the
   * form's equating depends on it.
   */
  async setAnchor(actor: Actor, id: string, dto: SetAnchorDto) {
    const item = await this.load(id);
    if (item.status !== 'approved') throw new ItemStateException('not_approved', { status: item.status });

    if (!dto.isAnchor) {
      const pinned = await this.db.one(
        `SELECT 1 FROM form_item fi JOIN form f ON f.id = fi.form_id
           JOIN item_version v ON v.id = fi.item_version_id
          WHERE v.item_id = $1 AND fi.slot_role = 'anchor' AND f.frozen_at IS NOT NULL LIMIT 1`,
        [id],
      );
      if (pinned) throw new ItemStateException('anchor_in_frozen_form');
      await this.db.query(
        `UPDATE item SET is_anchor = false, anchor_kind = NULL, anchor_link_grade = NULL WHERE id = $1`,
        [id],
      );
    } else {
      const kind = dto.kind ?? 'horizontal';
      if (kind === 'vertical' && item.grade >= 4) throw new ItemInvalidException('no_vertical_above_grade_4');
      await this.db.query(
        `UPDATE item SET is_anchor = true, anchor_kind = $2, anchor_link_grade = $3 WHERE id = $1`,
        [id, kind, kind === 'vertical' ? item.grade + 1 : null],
      );
    }
    await this.audit.write({
      action: 'item.anchor_set',
      personId: actor.personId,
      payload: { itemId: id, isAnchor: dto.isAnchor, kind: dto.isAnchor ? (dto.kind ?? 'horizontal') : null },
    });
    return this.get(actor, id);
  }

  // ============================================================= helpers

  /**
   * design/12's "Fix before submitting": the keys of every field that is not
   * ready. Grades 0–1 need a picture with read-aloud audio in both languages
   * (task.md § 8.3); every distractor needs a misconception and a rationale
   * (INV-10); both language versions must exist (task.md § 8.5).
   */
  private async incompleteFields(item: ItemRow, d: DraftContent): Promise<string[]> {
    const out: string[] = [];
    if (!item.construct.trim()) out.push('construct');
    if (d.expectedP === null || d.expectedP === undefined || d.expectedP < 0 || d.expectedP > 1) out.push('expectedP');
    if (item.grade <= 1 && d.stemFormat !== 'image_audio') out.push('stemFormat');
    if (d.stemFormat !== 'text' && !d.imageRef) out.push('image');
    if (d.stemFormat === 'image_audio') {
      if (!d.audioRefUz) out.push('audioUz');
      if (!d.audioRefRu) out.push('audioRu');
    }
    if (!d.stemUz.trim()) out.push('stemUz');
    if (!d.stemRu.trim()) out.push('stemRu');

    if (d.options.length < MIN_OPTIONS || d.options.length > MAX_OPTIONS) out.push('options');
    const keys = d.options.filter((o) => o.isKey).length;
    if (keys !== 1) out.push('correct');

    const live = new Set(
      (await this.db.query<{ code: string }>(`SELECT code FROM misconception WHERE retired_at IS NULL`)).map(
        (r) => r.code,
      ),
    );
    d.options.forEach((o, i) => {
      const n = i + 1;
      if (!o.labelUz.trim() && !o.imageRef) out.push(`options.${n}.labelUz`);
      if (!o.labelRu.trim() && !o.imageRef) out.push(`options.${n}.labelRu`);
      if (!o.isKey) {
        if (!o.misconceptionCode || !live.has(o.misconceptionCode)) out.push(`options.${n}.misconception`);
        if (!o.rationale?.trim()) out.push(`options.${n}.rationale`);
      }
    });
    return out;
  }

  private async writeOptions(client: PoolClient, versionId: string, options: DraftOption[]): Promise<void> {
    let position = 0;
    for (const o of options) {
      position += 1;
      await client.query(
        `INSERT INTO item_option
           (item_version_id, position, label_uz, label_ru, image_ref, is_key, misconception_code, rationale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          versionId,
          position,
          o.labelUz.trim(),
          o.labelRu.trim(),
          o.imageRef,
          o.isKey,
          o.isKey ? null : o.misconceptionCode,
          o.isKey ? null : o.rationale?.trim() || null,
        ],
      );
    }
  }

  /** A frozen version's content in draft shape — what "new version" copies. */
  private async frozenContent(v: {
    id: string;
    stem_format: StemFormat;
    stem_uz: string;
    stem_ru: string;
    image_ref: string | null;
    audio_ref_uz: string | null;
    audio_ref_ru: string | null;
    expected_p: string | null;
  }): Promise<DraftContent> {
    const options = await this.db.query<{
      label_uz: string;
      label_ru: string;
      image_ref: string | null;
      is_key: boolean;
      misconception_code: string | null;
      rationale: string | null;
    }>(`SELECT * FROM item_option WHERE item_version_id = $1 ORDER BY position`, [v.id]);
    return {
      stemFormat: v.stem_format,
      stemUz: v.stem_uz,
      stemRu: v.stem_ru,
      imageRef: v.image_ref,
      audioRefUz: v.audio_ref_uz,
      audioRefRu: v.audio_ref_ru,
      expectedP: v.expected_p === null ? null : Number(v.expected_p),
      options: options.map((o) => ({
        labelUz: o.label_uz,
        labelRu: o.label_ru,
        imageRef: o.image_ref,
        isKey: o.is_key,
        misconceptionCode: o.misconception_code,
        rationale: o.rationale,
      })),
    };
  }

  private mediaOut(ref: string | null) {
    return ref ? { ref, url: this.media.signedUrl(ref) } : null;
  }

  private async assertMediaKnown(d: DraftContent): Promise<void> {
    const refs: [string | null, 'image' | 'audio'][] = [
      [d.imageRef, 'image'],
      [d.audioRefUz, 'audio'],
      [d.audioRefRu, 'audio'],
      ...d.options.map((o) => [o.imageRef, 'image'] as [string | null, 'image']),
    ];
    for (const [ref, kind] of refs) {
      if (ref && !(await this.media.isKnown(ref, kind))) throw new ItemInvalidException('unknown_media');
    }
  }

  private async assertTopicSkill(topicCode: string, grade: number, skillCode: string | null): Promise<void> {
    const topic = await this.db.one<{ grade_min: number; grade_max: number }>(
      `SELECT grade_min, grade_max FROM topic WHERE code = $1`,
      [topicCode],
    );
    if (!topic) throw new ItemInvalidException('topic_unknown');
    if (grade < topic.grade_min || grade > topic.grade_max) throw new ItemInvalidException('topic_grade');
    // INV-11 / schema `item_skill_for_low_grades`: grades 0–2 are measured by skill.
    if (grade <= 2 && !skillCode) throw new ItemInvalidException('skill_required');
    if (skillCode) {
      const skill = await this.db.one<{ topic_code: string; grade: number }>(
        `SELECT topic_code, grade FROM skill WHERE code = $1`,
        [skillCode],
      );
      if (!skill || skill.topic_code !== topicCode) throw new ItemInvalidException('skill_topic');
      if (grade > 2) throw new ItemInvalidException('skill_grade');
    }
  }

  /** Authors write their own items; the bank editor may write any. */
  private assertCanWrite(actor: Actor, item: ItemRow): void {
    const mine = item.author_person_id === actor.personId && hasPermission(actor.staffRoles, 'item.create');
    if (!mine && !hasPermission(actor.staffRoles, 'item.approve')) throw new BankNotFoundException();
  }

  async load(id: string): Promise<ItemRow> {
    if (!UUID.test(id)) throw new BankNotFoundException();
    const row = await this.db.one<ItemRow>(`SELECT * FROM item WHERE id = $1`, [id]);
    if (!row) throw new BankNotFoundException();
    return row;
  }

  private async latest(itemId: string) {
    const row = await this.db.one<{
      id: string;
      version: number;
      stem_format: StemFormat;
      stem_uz: string;
      stem_ru: string;
      image_ref: string | null;
      audio_ref_uz: string | null;
      audio_ref_ru: string | null;
      expected_p: string | null;
      frozen_at: Date | null;
      draft: DraftContent | null;
    }>(`SELECT * FROM item_version WHERE item_id = $1 ORDER BY version DESC LIMIT 1`, [itemId]);
    if (!row) throw new BankNotFoundException();
    return row;
  }
}

function normaliseOption(o: DraftOptionDto): DraftOption {
  return {
    labelUz: o.labelUz ?? '',
    labelRu: o.labelRu ?? '',
    imageRef: o.imageRef ?? null,
    isKey: !!o.isKey,
    misconceptionCode: o.misconceptionCode || null,
    rationale: o.rationale ?? null,
  };
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function flagsOf(r: Record<string, unknown>): string[] {
  if (r.n === null || r.n === undefined) return [];
  const out: string[] = [];
  const p = num(r.p);
  const rb = num(r.pointBiserial);
  const dif = num(r.difUzRu);
  if (p !== null && (p < FLAG.pLow || p > FLAG.pHigh)) out.push('p_out');
  if (rb !== null && rb < FLAG.rMin) out.push('low_r');
  const shares = (r.distractorShare ?? {}) as Record<string, number>;
  if (Object.values(shares).some((s) => Number(s) < FLAG.deadShare)) out.push('dead_distractor');
  if (dif !== null && Math.abs(dif) > FLAG.difMax) out.push('dif');
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
