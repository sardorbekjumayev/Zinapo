import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

type Cluster = 'numeracy' | 'reasoning' | 'language';

interface Spec {
  cluster: Cluster;
  topic: string;
  status: 'approved' | 'accepted' | 'in_review' | 'draft';
  anchor?: boolean;
  /** The author's expected p — the anchors need a spread (design/14). */
  p: number;
}

/**
 * The M3 development fixture: a grade 4 bank big enough to build a monitoring
 * form from the template and a practice form, through the real API.
 *
 *   12 anchors (4 per cluster, easy → hard) · 26 core items · 8 accepted
 *   (pretest-only) · 3 in review · 2 drafts
 *
 * Written straight into the tables the API writes (no shortcuts the schema
 * would refuse: every distractor has a misconception and a rationale, every
 * submitted version is frozen). Idempotent: items are tagged `[seed]` and the
 * seed does nothing if grade 4 already has them. Development only.
 */
@Injectable()
export class SeedBankService {
  private readonly logger = new Logger(SeedBankService.name);

  constructor(private readonly db: DbService) {}

  async run(): Promise<{ created: number; skipped: boolean }> {
    const existing = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM item WHERE construct LIKE '[seed]%' AND grade = 4`,
    );
    if (existing && existing.n > 0) return { created: 0, skipped: true };

    const people = await this.db.query<{ phone: string; id: string }>(
      `SELECT phone, id FROM person WHERE phone IN ('+998901110011', '+998901110012', '+998901110013')`,
    );
    const by = Object.fromEntries(people.map((p) => [p.phone, p.id]));
    const author = by['+998901110011']; // item_author
    const reviewer = by['+998901110012']; // item_reviewer
    const editor = by['+998901110013']; // bank_editor
    if (!author || !reviewer || !editor) throw new Error('run POST /api/dev/seed first');

    const specs: Spec[] = [];
    // Anchors: 4 per cluster, spread from easy (p .85) to hard (p .25).
    const anchorP = [0.85, 0.62, 0.48, 0.25];
    for (const [cluster, topic] of [
      ['numeracy', 'num.muldiv'],
      ['reasoning', 'rea.pattern'],
      ['language', 'lan.read'],
    ] as const) {
      for (const p of anchorP) specs.push({ cluster, topic, status: 'approved', anchor: true, p });
    }
    // Core items.
    for (const [cluster, topic, n] of [
      ['numeracy', 'num.fraction', 5],
      ['numeracy', 'num.word', 4],
      ['reasoning', 'rea.logic', 5],
      ['reasoning', 'rea.space', 4],
      ['language', 'lan.vocab', 4],
      ['language', 'lan.read', 4],
    ] as const) {
      for (let i = 0; i < n; i++) specs.push({ cluster, topic, status: 'approved', p: 0.35 + (i % 5) * 0.12 });
    }
    // Pretest-only (accepted, awaiting approval).
    for (const [cluster, topic] of [
      ['numeracy', 'num.fraction'], ['numeracy', 'num.word'], ['numeracy', 'num.muldiv'],
      ['reasoning', 'rea.logic'], ['reasoning', 'rea.pattern'], ['reasoning', 'rea.space'],
      ['language', 'lan.vocab'], ['language', 'lan.read'],
    ] as const) {
      specs.push({ cluster, topic, status: 'accepted', p: 0.5 });
    }
    specs.push({ cluster: 'numeracy', topic: 'num.word', status: 'in_review', p: 0.45 });
    specs.push({ cluster: 'reasoning', topic: 'rea.logic', status: 'in_review', p: 0.4 });
    specs.push({ cluster: 'language', topic: 'lan.read', status: 'in_review', p: 0.55 });
    specs.push({ cluster: 'numeracy', topic: 'num.fraction', status: 'draft', p: 0.5 });
    specs.push({ cluster: 'language', topic: 'lan.vocab', status: 'draft', p: 0.6 });

    const misconceptions = await this.db.query<{ code: string; topic_code: string }>(
      `SELECT code, topic_code FROM misconception WHERE retired_at IS NULL`,
    );

    let created = 0;
    await this.db.transaction(async (client) => {
      for (const [i, spec] of specs.entries()) {
        await this.item(client, i + 1, spec, author, reviewer, misconceptions);
        created += 1;
      }
      // Season targets for the bank tiles (design/11's numbers).
      await client.query(
        `INSERT INTO item_bank_target (season_id, grade, target_live, updated_by)
         SELECT s.id, g.grade, g.target, $1 FROM season s,
                (VALUES (0, 45), (1, 45), (2, 45), (3, 60), (4, 90)) AS g(grade, target)
          WHERE s.is_current
         ON CONFLICT (season_id, grade) DO NOTHING`,
        [editor],
      );
    });
    this.logger.log(`seeded ${created} grade 4 items`);
    return { created, skipped: false };
  }

  private async item(
    client: PoolClient,
    n: number,
    spec: Spec,
    author: string,
    reviewer: string,
    misconceptions: { code: string; topic_code: string }[],
  ): Promise<void> {
    const content = stemFor(spec.cluster, n);
    const item = await client.query<{ id: string }>(
      `INSERT INTO item (author_person_id, topic_code, grade, construct, status, is_anchor, anchor_kind, accepted_at)
       VALUES ($1, $2, 4, $3, $4, $5, $6, $7) RETURNING id`,
      [
        author,
        spec.topic,
        `[seed] ${content.construct}`,
        spec.status,
        !!spec.anchor,
        spec.anchor ? 'horizontal' : null,
        spec.status === 'approved' || spec.status === 'accepted' ? new Date() : null,
      ],
    );
    const itemId = item.rows[0].id;

    if (spec.status === 'draft') {
      await client.query(
        `INSERT INTO item_version (item_id, version, stem_uz, stem_ru, created_by, draft)
         VALUES ($1, 1, '', '', $2, $3::jsonb)`,
        [
          itemId,
          author,
          JSON.stringify({
            stemFormat: 'text',
            stemUz: content.uz,
            stemRu: '',
            imageRef: null,
            audioRefUz: null,
            audioRefRu: null,
            expectedP: spec.p,
            options: content.options.map((o, i) => ({
              labelUz: o,
              labelRu: '',
              imageRef: null,
              isKey: i === content.key,
              misconceptionCode: null,
              rationale: null,
            })),
          }),
        ],
      );
      return;
    }

    const version = await client.query<{ id: string }>(
      `INSERT INTO item_version (item_id, version, stem_format, stem_uz, stem_ru, expected_p, created_by, submitted_at)
       VALUES ($1, 1, 'text', $2, $3, $4, $5, now()) RETURNING id`,
      [itemId, content.uz, content.ru, spec.p, author],
    );
    const versionId = version.rows[0].id;

    const pool = misconceptions.filter((m) => m.topic_code === spec.topic);
    const fallback = misconceptions[0];
    for (const [i, label] of content.options.entries()) {
      const isKey = i === content.key;
      const m = pool[i % Math.max(pool.length, 1)] ?? fallback;
      await client.query(
        `INSERT INTO item_option
           (item_version_id, position, label_uz, label_ru, is_key, misconception_code, rationale)
         VALUES ($1, $2, $3, $3, $4, $5, $6)`,
        [versionId, i + 1, label, isKey, isKey ? null : m.code, isKey ? null : 'Seed: a typical slip for this topic.'],
      );
    }
    await client.query(`UPDATE item_version SET frozen_at = now() WHERE id = $1`, [versionId]);

    if (spec.status === 'approved' || spec.status === 'accepted') {
      const key = await client.query<{ id: string }>(
        `SELECT id FROM item_option WHERE item_version_id = $1 AND is_key`,
        [versionId],
      );
      await client.query(
        `INSERT INTO item_review
           (item_version_id, reviewer_person_id, blind_option_id, blind_submitted_at, blind_was_correct,
            verdict, decided_at)
         VALUES ($1, $2, $3, now(), true, 'accept', now())`,
        [versionId, reviewer, key.rows[0].id],
      );
    }
  }
}

/** Simple, distinct grade 4 stems per cluster. The numbers keep them unique. */
function stemFor(cluster: Cluster, n: number) {
  if (cluster === 'numeracy') {
    const a = 12 + n * 3;
    const b = 4 + (n % 5);
    const right = a * b;
    return {
      construct: `multiplies a two-digit number (${n})`,
      uz: `${a} × ${b} = ?`,
      ru: `${a} × ${b} = ?`,
      options: [String(right), String(a + b), String(right + 10), String(right - b)],
      key: 0,
    };
  }
  if (cluster === 'reasoning') {
    const s = 2 + (n % 4);
    const seq = [s, s * 2, s * 4, s * 8];
    return {
      construct: `continues a doubling sequence (${n})`,
      uz: `Qatorni davom ettiring: ${seq.join(', ')}, …`,
      ru: `Продолжите ряд: ${seq.join(', ')}, …`,
      options: [String(s * 12), String(s * 16), String(s * 10), String(s * 9)],
      key: 1,
    };
  }
  return {
    construct: `chooses the word that fits the sentence (${n})`,
    uz: `Gapni toʻldiring (${n}): “Men har kuni ___ oʻqiyman.”`,
    ru: `Дополните предложение (${n}): «Я каждый день читаю ___».`,
    options: ['kitob', 'daryo', 'quyosh', 'bahor'],
    key: 0,
  };
}
