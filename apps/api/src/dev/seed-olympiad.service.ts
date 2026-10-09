import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { Actor } from '../authz';
import { OlympiadResultsService } from '../olympiad/olympiad-results.service';

const DAY = 86400_000;

/**
 * `POST /api/dev/seed-olympiad` — M7: an olympiad with something in every
 * state, so each screen has data.
 *
 *   "Zinapo olimpiadasi · 3–4-sinf" (`zinapo-2026`, ranked):
 *     autumn online — closed, taken by Madina + 40 synthetic grade 4 children,
 *                     results computed and PUBLISHED (bands, certificates,
 *                     mini-final invitations; two "too fast" sessions flagged);
 *     mini-final    — in 12 days, a venue, registration open by invitation;
 *     spring online — OPEN now (to take a stage in kid mode);
 *     spring final  — in 30 days, two venues, registration open; six synthetic
 *                     children with a ticket already registered at the first,
 *                     whose proctor is the seeded proctor (+998901110016).
 *   "Bahorgi diagnostika marafoni · 0–2-sinf" (`marafon-2027`, not ranked):
 *     spring online — OPEN now; Temur is not registered yet.
 *
 * Needs seed, seed-bank and seed-results. Idempotent: skipped once
 * `zinapo-2026` exists.
 */
@Injectable()
export class SeedOlympiadService {
  private readonly logger = new Logger(SeedOlympiadService.name);

  constructor(
    private readonly db: DbService,
    private readonly results: OlympiadResultsService,
  ) {}

  async run() {
    if (await this.db.one(`SELECT 1 FROM olympiad WHERE slug = 'zinapo-2026'`)) return { skipped: 'already seeded' };
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    const operator = await this.db.one<{ id: string }>(
      `SELECT person_id AS id FROM staff_role_assignment WHERE role = 'olympiad_operator' AND revoked_at IS NULL LIMIT 1`,
    );
    const proctor = await this.db.one<{ id: string }>(
      `SELECT person_id AS id FROM staff_role_assignment sr JOIN person p ON p.id = sr.person_id
        WHERE sr.role = 'proctor' AND sr.revoked_at IS NULL AND p.phone = '+998901110016'`,
    );
    const kids4 = await this.db.query<{ id: string; owner: string }>(
      `SELECT c.id, g.person_id AS owner FROM child c
         JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL AND e.grade = 4
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE c.family_name = 'KOHORT' ORDER BY c.given_name`,
    );
    const madina = await this.db.one<{ id: string; owner: string }>(
      `SELECT c.id, g.person_id AS owner FROM child c JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner'
        WHERE c.given_name = 'Madina' AND g.revoked_at IS NULL LIMIT 1`,
    );
    if (!season || !operator || !proctor || !madina || kids4.length < 30) return { skipped: 'run seed, seed-bank and seed-results first' };

    const now = Date.now();
    const ids = await this.db.transaction(async (client) => {
      const form4 = await this.form(client, operator.id, 4, 'Olimpiada · 4-sinf', 12);
      const form4b = await this.form(client, operator.id, 4, 'Olimpiada · 4-sinf (bahor)', 12);
      const form1 = await this.form(client, operator.id, 1, 'Marafon · 1-sinf', 12);

      const o = (
        await client.query<{ id: string }>(
          `INSERT INTO olympiad (season_id, slug, title_uz, title_ru, grade_min, grade_max, is_ranked, bonus_rate)
           VALUES ($1, 'zinapo-2026', 'Zinapo olimpiadasi · 3–4-sinf', 'Олимпиада Zinapo · 3–4 класс', 3, 4, true, 50000)
           RETURNING id`,
          [season.id],
        )
      ).rows[0].id;
      const stage = async (oid: string, kind: string, opens: number, closes: number, reg?: number) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO olympiad_stage (olympiad_id, kind, opens_at, closes_at, registration_closes_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [oid, kind, new Date(opens), new Date(closes), reg === undefined ? null : new Date(reg)],
          )
        ).rows[0].id;
      const autumn = await stage(o, 'autumn_online', now - 30 * DAY, now - 10 * DAY);
      const mini = await stage(o, 'mini_final', now + 12 * DAY, now + 12 * DAY + 4 * 3600_000, now + 9 * DAY);
      const spring = await stage(o, 'spring_online', now - 2 * DAY, now + 14 * DAY);
      const final = await stage(o, 'spring_final', now + 30 * DAY, now + 30 * DAY + 5 * 3600_000, now + 25 * DAY);
      for (const st of [autumn, mini, spring, final]) {
        await client.query(`INSERT INTO olympiad_stage_form (stage_id, grade, form_id) VALUES ($1, 4, $2)`, [st, st === spring ? form4b : form4]);
      }

      const venue = async (stageId: string, name: string, address: string, capacity: number, starts: number) =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO olympiad_venue (olympiad_id, stage_id, region_id, name, address, capacity, starts_at)
             VALUES ($1, $2, 14, $3, $4, $5, $6) RETURNING id`,
            [o, stageId, name, address, capacity, new Date(starts)],
          )
        ).rows[0].id;
      await venue(mini, 'Toshkent shahar markazi', 'Amir Temur shoh ko‘chasi, 1', 120, now + 12 * DAY);
      const v1 = await venue(final, '110-maktab, Yunusobod', 'Yunusobod tumani, 4-mavze, 12-uy', 40, now + 30 * DAY);
      await venue(final, 'Chilonzor bilim markazi', 'Chilonzor tumani, Bunyodkor ko‘chasi, 21', 2, now + 31 * DAY);
      await client.query(`INSERT INTO proctor_assignment (venue_id, person_id) VALUES ($1, $2)`, [v1, proctor.id]);

      // Autumn online: Madina and the synthetic cohort took it at home.
      const all = [madina, ...kids4];
      for (const [i, k] of all.entries()) {
        const entry = await this.entry(client, o, autumn, k.id, k.owner, 'open', i === 0 ? 'telegram' : i % 4 === 0 ? 'school-poster' : null);
        const ability = i === 0 ? 0.9 : ((i * 37) % 21) / 10 - 1;
        // Two children answer implausibly fast and right — the cheating signal's case.
        const fast = i === 7 || i === 19;
        await this.take(client, entry, k.id, k.owner, form4, fast ? 4 : ability, fast ? 1800 : null, now - 25 * DAY);
      }
      // Six synthetic children with a ticket are already registered for the final, at v1.
      for (const k of kids4.slice(0, 6)) {
        await this.entry(client, o, final, k.id, k.owner, 'ticket', null, v1);
      }

      // The grades 0–2 marathon.
      const m = (
        await client.query<{ id: string }>(
          `INSERT INTO olympiad (season_id, slug, title_uz, title_ru, grade_min, grade_max, is_ranked)
           VALUES ($1, 'marafon-2027', 'Bahorgi diagnostika marafoni · 0–2-sinf', 'Весенний диагностический марафон · 0–2 класс', 0, 2, false)
           RETURNING id`,
          [season.id],
        )
      ).rows[0].id;
      const ms = await stage(m, 'spring_online', now - 2 * DAY, now + 20 * DAY);
      await client.query(`INSERT INTO olympiad_stage_form (stage_id, grade, form_id) VALUES ($1, 1, $2)`, [ms, form1]);
      return { o, autumn };
    });

    // The autumn results, computed and published by the real service.
    const actor: Actor = { personId: operator.id, staffRoles: ['olympiad_operator'], educatorStatus: null, ownerOf: 0, coGuardianOf: 0, lastWorkspace: 'staff' };
    const computed = await this.results.compute(actor, ids.o, ids.autumn);
    await this.results.publish(actor, ids.o, ids.autumn);
    const out = { olympiads: 2, autumn: computed };
    this.logger.log(`seed-olympiad: ${JSON.stringify(out)}`);
    return out;
  }

  /** A frozen olympiad form from the grade's approved items. */
  private async form(client: PoolClient, by: string, grade: number, label: string, n: number): Promise<string> {
    const f = (
      await client.query<{ id: string }>(
        `INSERT INTO form (mode, grade, label, created_by, time_limit_sec) VALUES ('olympiad', $1, $2, $3, 1800) RETURNING id`,
        [grade, label, by],
      )
    ).rows[0].id;
    await client.query(
      // Round-robin over the three clusters, so the diagnostic has all of them.
      `INSERT INTO form_item (form_id, position, item_version_id, slot_role, is_scored)
       SELECT $1, row_number() OVER (ORDER BY x.expected_p DESC NULLS LAST, x.code), x.id, 'scored', true
         FROM (SELECT v.id, v.expected_p, i.code,
                      row_number() OVER (PARTITION BY t.cluster ORDER BY ${label.includes('bahor') ? 'i.code DESC' : 'i.code'}) AS turn
                 FROM item i
                 JOIN topic t ON t.code = i.topic_code
                 JOIN LATERAL (SELECT * FROM item_version v WHERE v.item_id = i.id AND v.frozen_at IS NOT NULL
                                ORDER BY v.version DESC LIMIT 1) v ON true
                WHERE i.grade = $2 AND i.status = 'approved' AND i.retired_at IS NULL
                ORDER BY turn, t.cluster LIMIT $3) x`,
      [f, grade, n],
    );
    await client.query(`UPDATE form SET frozen_at = now() WHERE id = $1`, [f]);
    return f;
  }

  private async entry(client: PoolClient, o: string, stage: string, childId: string, owner: string, via: string, source: string | null, venue: string | null = null) {
    return (
      await client.query<{ id: string }>(
        `INSERT INTO olympiad_entry (olympiad_id, stage_id, child_id, registered_by, source, region_id, grade, entry_via, venue_id, ticket_from_waves)
         VALUES ($1, $2, $3, $4, $5, 14, 4, $6, $7, 3) RETURNING id`,
        [o, stage, childId, owner, source, via, venue],
      )
    ).rows[0].id;
  }

  /** A submitted olympiad session: P(correct) = logistic(ability − b), b from the expected p. */
  private async take(client: PoolClient, entryId: string, childId: string, owner: string, formId: string, ability: number, fastMs: number | null, at: number) {
    const s = (
      await client.query<{ id: string }>(
        `INSERT INTO session (child_id, mode, form_id, olympiad_entry_id, launched_by, launch_context, grade_snapshot,
                              region_snapshot, status, started_at, submitted_at, device)
         VALUES ($1, 'olympiad', $2, $3, $4, 'home', 4, 14, 'submitted', $5, $6, 'seed') RETURNING id`,
        [childId, formId, entryId, owner, new Date(at), new Date(at + 30 * 60_000)],
      )
    ).rows[0].id;
    const items = await client.query<{ iv: string; p: string | null; key: string; wrong: string }>(
      `SELECT fi.item_version_id AS iv, v.expected_p AS p,
              (SELECT id FROM item_option o WHERE o.item_version_id = v.id AND o.is_key) AS key,
              (SELECT id FROM item_option o WHERE o.item_version_id = v.id AND NOT o.is_key ORDER BY o.position LIMIT 1) AS wrong
         FROM form_item fi JOIN item_version v ON v.id = fi.item_version_id WHERE fi.form_id = $1 ORDER BY fi.position`,
      [formId],
    );
    let seed = parseInt(childId.replace(/-/g, '').slice(0, 8), 16) ^ 0x5eed;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 10000) / 10000;
    for (const it of items.rows) {
      const p = Math.min(Math.max(it.p === null ? 0.5 : Number(it.p), 0.05), 0.95);
      const right = rnd() < 1 / (1 + Math.exp(-(ability - Math.log((1 - p) / p))));
      await client.query(
        `INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, response_ms, client_recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [s, it.iv, right ? it.key : it.wrong, right, fastMs ?? 15_000 + Math.floor(rnd() * 60_000), new Date(at)],
      );
    }
  }
}
