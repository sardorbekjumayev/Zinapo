import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { DbService } from '../db/db.service';
import { FraudRulesService } from '../trust/fraud-rules.service';

/**
 * `POST /api/dev/seed-trust` — M8: a queue with one of everything.
 *
 *   · report views for every child with measured waves EXCEPT three synthetic
 *     ones (Bola 4-3, 4-5, 4-8) → "owner never opens reports";
 *   · three synthetic owners "adding a child" from one phone within an hour →
 *     "many owners from one device" (audit rows, as the API would write them);
 *   · a second educator, Botir Qodirov (+998901110050), whose evening group
 *     holds three children of ONE owner with three different surnames →
 *     "surname mismatch" — with active links, so "suspend links and ask the
 *     owners" can be tried without touching Aziza;
 *   · a confirmed ownership dispute over Bola 4-40, claimed by Shahlo
 *     Ergasheva (+998901110051), with a statement from each side.
 *
 * Then the real fraud job runs. Idempotent: skipped once Botir exists.
 */
@Injectable()
export class SeedTrustService {
  private readonly logger = new Logger(SeedTrustService.name);

  constructor(
    private readonly db: DbService,
    private readonly fraud: FraudRulesService,
  ) {}

  async run() {
    if (await this.db.one(`SELECT 1 FROM person WHERE phone = '+998901110050'`)) return { skipped: 'already seeded' };
    const season = await this.db.one<{ id: string }>(`SELECT id FROM season WHERE is_current`);
    const kid40 = await this.db.one<{ id: string; owner: string }>(
      `SELECT c.id, g.person_id AS owner FROM child c JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
        WHERE c.given_name = 'Bola 4-40' LIMIT 1`,
    );
    if (!season || !kid40) return { skipped: 'run seed, seed-bank and seed-results first' };

    await this.db.transaction(async (client) => {
      // Reports opened by most families.
      await client.query(
        `INSERT INTO report_view (child_id, person_id, viewed_on)
         SELECT DISTINCT s.child_id, g.person_id, (now() - interval '3 days')::date
           FROM session s JOIN child c ON c.id = s.child_id
           JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
          WHERE s.mode = 'monitoring' AND s.status = 'submitted' AND c.given_name NOT IN ('Bola 4-3', 'Bola 4-5', 'Bola 4-8')
         ON CONFLICT DO NOTHING`,
      );

      // One device, three "new" owners within an hour.
      const trio = await client.query<{ child_id: string; owner: string }>(
        `SELECT c.id AS child_id, g.person_id AS owner FROM child c
           JOIN guardianship g ON g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL
          WHERE c.given_name IN ('Bola 4-30', 'Bola 4-31', 'Bola 4-32') ORDER BY c.given_name`,
      );
      for (const [i, t] of trio.rows.entries()) {
        await client.query(
          `INSERT INTO audit_log (person_id, action, payload, ip, user_agent, created_at)
           VALUES ($1, 'child.created', $2::jsonb, '10.20.30.40', 'Mozilla/5.0 (Linux; Android 12; SM-A125F) Chrome/124.0', now() - make_interval(mins => $3))`,
          [t.owner, JSON.stringify({ childId: t.child_id, grade: 4, seeded: true }), 50 - i * 20],
        );
      }

      // A second educator and an evening group: one owner, three surnames.
      const botir = (
        await client.query<{ id: string }>(
          `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via)
           VALUES ('Botir Qodirov', '+998901110050', 'uz', now(), 'manual') RETURNING id`,
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO educator_profile (person_id, kind, status, public_code, region_id, subjects, decided_at, note)
         VALUES ($1, 'tutor', 'approved', 'BQ5050', 14, ARRAY['numeracy'], now() - interval '20 days', 'dev seed')`,
        [botir],
      );
      const owner = (
        await client.query<{ id: string }>(
          `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via)
           VALUES ('Nilufar Saidova', '+998901110052', 'uz', now(), 'manual') RETURNING id`,
        )
      ).rows[0].id;
      const group = (
        await client.query<{ id: string }>(
          `INSERT INTO teaching_group (educator_person_id, name, grade) VALUES ($1, 'Kechki guruh', 4) RETURNING id`,
          [botir],
        )
      ).rows[0].id;
      const salt = process.env.PINFL_HASH_SALT ?? 'dev';
      for (const [i, [family, given]] of [['SAIDOVA', 'Laylo'], ['TOSHEVA', 'Malika'], ['RAHIMOVA', 'Dilnoza']].entries()) {
        const fake = `6${String(10 + i).padStart(2, '0')}0516${String(9000000 + i)}`;
        const child = (
          await client.query<{ id: string }>(
            `INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, dob, created_by)
             VALUES ($1, '\\x00', $2, $3, '2016-05-1${i}', $4) RETURNING id`,
            [createHmac('sha256', salt).update(fake).digest(), family, given, owner],
          )
        ).rows[0].id;
        await client.query(`INSERT INTO guardianship (child_id, person_id, role, granted_by) VALUES ($1, $2, 'owner', $2)`, [child, owner]);
        await client.query(`INSERT INTO enrolment (child_id, school_year, grade, school_region_id) VALUES ($1, 2026, 4, 14)`, [child]);
        await client.query(`INSERT INTO consent (child_id, person_id, type, document_version) VALUES ($1, $2, 'data_processing', 'v1-2026-09')`, [child, owner]);
        await client.query(
          `INSERT INTO educator_link (educator_person_id, child_id, status, valid_from, valid_until, decided_by, decided_at, season_id)
           VALUES ($1, $2, 'active', now() - interval '15 days', date '2027-05-31', $3, now() - interval '15 days', $4)`,
          [botir, child, owner, season.id],
        );
        await client.query(`INSERT INTO group_member (group_id, child_id) VALUES ($1, $2)`, [group, child]);
      }

      // A confirmed ownership dispute with a statement from each side.
      const claimant = (
        await client.query<{ id: string }>(
          `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via)
           VALUES ('Shahlo Ergasheva', '+998901110051', 'uz', now(), 'manual') RETURNING id`,
        )
      ).rows[0].id;
      const dispute = (
        await client.query<{ id: string }>(
          `INSERT INTO review_case (kind, subject_person_id, subject_child_id, payload, opened_at)
           VALUES ('ownership_dispute', $1, $2, $3::jsonb, now() - interval '2 days') RETURNING id`,
          [claimant, kid40.id, JSON.stringify({ claimantPersonId: claimant, claimedFamilyName: 'ERGASHEVA', claimedGivenName: 'Bola', currentOwnerPersonId: kid40.owner, claimantConfirmed: true })],
        )
      ).rows[0].id;
      await client.query(
        `INSERT INTO case_note (case_id, author_id, author_role, body, created_at) VALUES
           ($1, $2, 'claimant', 'Men bolaning onasiman. Ajrashganimizdan keyin otasi profilni oʻz nomiga ochgan; tug‘ilganlik guvohnomasini ko‘rsata olaman.', now() - interval '2 days'),
           ($1, $3, 'owner', 'Bola men bilan yashaydi va maktabga men olib boraman. Sud qarori bor — qo‘ng‘iroqda ko‘rsataman.', now() - interval '1 day')`,
        [dispute, claimant, kid40.owner],
      );
    });

    const fraud = await this.fraud.tick();
    this.logger.log(`seed-trust: ${JSON.stringify(fraud)}`);
    return { fraud };
  }
}
