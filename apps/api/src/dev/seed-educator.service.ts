import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CasesService } from '../trust/cases.service';
import { Actor } from '../authz';
import { PracticeService } from '../educator/practice.service';
import { SeedResultsService } from './seed-results.service';

const DAY = 86400_000;

/**
 * `POST /api/dev/seed-educator` — M6: Aziza's workspace with something in it.
 *
 *   · 17 synthetic grade 4 children linked to Aziza (active, until 31 May) in
 *     her "4-sinf · Shanba" group, next to Madina — so the overview has a gain
 *     list, common mistakes from real distractors, and a "not taken" list;
 *   · 12 of them took the open wave 4;
 *   · invitations in every state (waiting, joined, expired);
 *   · one past practice set, assigned to 12 and done by 9 — design/09's
 *     "did it work?" card;
 *   · an applicant waiting for trust & safety, and a pre-approved phone.
 *
 * Needs seed, seed-bank and seed-results first. Idempotent: it does nothing
 * once Aziza has its invitations (codes `SEED…`).
 */
@Injectable()
export class SeedEducatorService {
  private readonly logger = new Logger(SeedEducatorService.name);

  constructor(
    private readonly db: DbService,
    private readonly cases: CasesService,
    private readonly practice: PracticeService,
    private readonly results: SeedResultsService,
  ) {}

  async run() {
    const aziza = await this.db.one<{ id: string }>(`SELECT id FROM person WHERE phone = '+998901110003'`);
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    if (!aziza || !season) return { skipped: 'run /dev/seed first' };
    if (await this.db.one(`SELECT 1 FROM educator_invite WHERE educator_person_id = $1 AND code LIKE 'SEED%'`, [aziza.id])) {
      return { skipped: 'already seeded' };
    }
    const kids = await this.db.query<{ id: string; owner_id: string }>(
      `SELECT c.id, g.person_id AS owner_id FROM child c
         JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL AND e.grade = 4
         JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE c.family_name = 'KOHORT' ORDER BY c.given_name LIMIT 17`,
    );
    if (kids.length < 17) return { skipped: 'run /dev/seed-results first' };
    const openWave = await this.db.one<{ id: string; form_id: string }>(
      `SELECT id, form_id FROM wave WHERE season_id = $1 AND grade = 4 AND opens_at <= now() AND closes_at > now()
        ORDER BY ordinal LIMIT 1`,
      [season.id],
    );

    await this.db.transaction(async (client) => {
      const group = await client.query<{ id: string }>(
        `SELECT id FROM teaching_group WHERE educator_person_id = $1 AND grade = 4 ORDER BY created_at LIMIT 1`,
        [aziza.id],
      );
      for (const k of kids) {
        await client.query(
          `INSERT INTO educator_link (educator_person_id, child_id, status, valid_from, valid_until, decided_by, decided_at, season_id)
           VALUES ($1, $2, 'active', now() - interval '40 days', date '2027-05-31', $3, now() - interval '40 days', $4)
           ON CONFLICT DO NOTHING`,
          [aziza.id, k.id, k.owner_id, season.id],
        );
        if (group.rowCount) {
          await client.query(`INSERT INTO group_member (group_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [group.rows[0].id, k.id]);
        }
      }
      // Wave 4 is open: 12 of the 17 have taken it.
      if (openWave) {
        for (const [i, k] of kids.slice(0, 12).entries()) {
          const done = await client.query(`SELECT 1 FROM session WHERE child_id = $1 AND wave_id = $2`, [k.id, openWave.id]);
          if (!done.rowCount) await this.results.takeWave(client, openWave.id, k.id, openWave.form_id, ((i * 37) % 21) / 10 - 0.6, 14, 'uz');
        }
      }

      // Invitations: 3 waiting, 2 joined (by two of the parents above), 1 expired.
      const now = Date.now();
      const invite = (phone: string, created: number, accepted: string | null) =>
        client.query(
          `INSERT INTO educator_invite (educator_person_id, phone_e164, code, created_at, expires_at, accepted_by, accepted_at)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE $4::timestamptz + interval '1 day' END)`,
          [aziza.id, phone, `SEED${phone.slice(-6)}`, new Date(created), new Date(created + 14 * DAY), accepted],
        );
      await invite('+998900005001', now - 5 * DAY, null);
      await invite('+998900005002', now - 4 * DAY, null);
      await invite('+998900005003', now - 1 * DAY, null);
      const joined = await client.query<{ phone: string; id: string }>(`SELECT phone, id FROM person WHERE id = ANY($1::uuid[])`, [
        [kids[0].owner_id, kids[1].owner_id],
      ]);
      for (const p of joined.rows) await invite(p.phone, now - 30 * DAY, p.id);
      await invite('+998900005004', now - 20 * DAY, null);

      // An applicant waiting for trust & safety.
      const applicant = await client.query<{ id: string }>(
        `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via)
         VALUES ('Jasur Toshmatov', '+998901110030', 'uz', now(), 'manual')
         ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
      );
      const applied = await client.query(
        `INSERT INTO educator_profile (person_id, kind, status, public_code, region_id, subjects, applied_at)
         VALUES ($1, 'school_teacher', 'applied', 'JT2210', 14, ARRAY['numeracy','language'], now() - interval '2 days')
         ON CONFLICT (person_id) DO NOTHING RETURNING person_id`,
        [applicant.rows[0].id],
      );
      if (applied.rowCount) {
        await this.cases.open(
          { kind: 'educator_application', subjectPersonId: applicant.rows[0].id, payload: { kind: 'school_teacher', regionId: 14, subjects: ['numeracy', 'language'] } },
          client,
        );
      }
      // A phone staff vouched for: that person's application is approved at once.
      const staff = await client.query<{ person_id: string }>(
        `SELECT person_id FROM staff_role_assignment WHERE role = 'trust_safety' AND revoked_at IS NULL LIMIT 1`,
      );
      if (staff.rowCount) {
        await client.query(
          `INSERT INTO educator_preapproval (phone_e164, kind, note, invited_by)
           VALUES ('+998901110031', 'tutor', 'Toshkent markazidagi tajribali repetitor', $1) ON CONFLICT DO NOTHING`,
          [staff.rows[0].person_id],
        );
      }
    });

    // A past practice set, built and assigned through the real service.
    const actor: Actor = { personId: aziza.id, staffRoles: [], educatorStatus: 'approved', ownerOf: 0, coGuardianOf: 0, lastWorkspace: 'educator' };
    const mistake = await this.db.one<{ code: string }>(
      `SELECT o.misconception_code AS code FROM item_option o
         JOIN item_version v ON v.id = o.item_version_id JOIN item i ON i.id = v.item_id
        WHERE i.grade = 4 AND NOT i.is_anchor AND i.status = 'approved' AND o.misconception_code IS NOT NULL
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
    );
    let practice: { assigned: number; done: number } | null = null;
    if (mistake) {
      const form = await this.practice.build(actor, { source: 'misconception', code: mistake.code, grade: 4 });
      const assignment = await this.practice.assign(actor, { formId: form.id, childIds: kids.slice(0, 12).map((k) => k.id) });
      await this.db.query(`UPDATE practice_assignment SET created_at = now() - interval '6 days' WHERE id = $1`, [assignment.id]);
      let done = 0;
      for (const [i, k] of kids.slice(0, 9).entries()) {
        await this.practiceSession({ ...actor, personId: k.owner_id, educatorStatus: null, lastWorkspace: 'family' }, k.id, assignment.id, form.id, i);
        done += 1;
      }
      practice = { assigned: assignment.assigned, done };
    }

    const out = { linked: kids.length, tookOpenWave: openWave ? 12 : 0, invites: 6, practice };
    this.logger.log(`seed-educator: ${JSON.stringify(out)}`);
    return out;
  }

  /** A submitted practice session, launched by the parent at home: child i solves a different number, so the card has a spread. */
  private async practiceSession(actor: Actor, childId: string, assignmentId: string, formId: string, i: number) {
    const { sessionId } = await this.practice.start(actor, childId, assignmentId);
    const items = await this.db.query<{ item_version_id: string; key: string; wrong: string }>(
      `SELECT fi.item_version_id,
              (SELECT id FROM item_option o WHERE o.item_version_id = fi.item_version_id AND o.is_key) AS key,
              (SELECT id FROM item_option o WHERE o.item_version_id = fi.item_version_id AND NOT o.is_key ORDER BY o.position LIMIT 1) AS wrong
         FROM form_item fi WHERE fi.form_id = $1 ORDER BY fi.position`,
      [formId],
    );
    const right = Math.round(items.length * ([0.9, 0.8, 0.7, 0.7, 0.6, 0.5, 0.4, 0.3, 0.8][i] ?? 0.5));
    const at = new Date(Date.now() - (5 - (i % 4)) * DAY);
    for (const [n, it] of items.entries()) {
      const chosen = n < right ? it.key : it.wrong;
      await this.db.query(
        `INSERT INTO response (session_id, item_version_id, chosen_option_id, is_correct, response_ms, client_recorded_at)
         VALUES ($1, $2, $3, $4, 30000, $5)`,
        [sessionId, it.item_version_id, chosen, chosen === it.key, at],
      );
    }
    await this.db.query(
      `UPDATE session SET status = 'submitted', started_at = $2, submitted_at = $3, device = 'seed' WHERE id = $1`,
      [sessionId, at, new Date(at.getTime() + 25 * 60_000)],
    );
  }
}
