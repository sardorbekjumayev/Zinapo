import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { PinflService } from '../identity/pinfl.service';
import { ActorService, STAFF_ROLES, StaffRole } from '../authz';

export interface SeedResult {
  people: Record<string, { phone: string; personId: string; note: string }>;
  children: { id: string; name: string; grade: number }[];
  groups: { id: string; name: string }[];
  season: { id: string; code: string };
}

/**
 * The M1 seed (task.md § 12): one owner with 2 children, one co-guardian, one
 * approved educator with a group, and one person per staff role.
 *
 * It goes through `PinflService`, so seeded children carry real hashes and a
 * real sealed PINFL — the duplicate-detection and outcomes-matching paths can
 * be exercised against them rather than against placeholder bytes.
 *
 * Idempotent: running it twice leaves the same rows. Development only.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  /**
   * Fixture PINFLs. Digit 1 is century+sex (5 = 2000s male, 6 = 2000s female),
   * digits 2–7 are DDMMYY and must agree with the DOB below — `PinflService`
   * treats a mismatch as a hard stop, and the seed must not bypass its own
   * validation.
   */
  private static readonly CHILDREN = [
    {
      key: 'madina',
      pinfl: '60312160000011',
      dob: '2016-12-03',
      family: 'KARIMOVA',
      given: 'Madina',
      patronymic: 'Rustamovna',
      grade: 4,
    },
    {
      key: 'temur',
      pinfl: '52108200000022',
      dob: '2020-08-21',
      family: 'KARIMOV',
      given: 'Temur',
      patronymic: 'Rustamovich',
      grade: 1,
    },
  ] as const;

  constructor(
    private readonly db: DbService,
    private readonly pinfl: PinflService,
    private readonly actors: ActorService,
  ) {}

  async run(): Promise<SeedResult> {
    // The fixtures assert their own premise: if a PINFL and its DOB ever drift
    // apart the seed must fail loudly, not quietly write an impossible child.
    for (const c of SeedService.CHILDREN) {
      if (!PinflService.isWellFormed(c.pinfl)) {
        throw new Error(`seed fixture ${c.key}: PINFL is not well formed`);
      }
      if (!PinflService.dobMatches(c.pinfl, c.dob)) {
        throw new Error(`seed fixture ${c.key}: PINFL does not encode ${c.dob}`);
      }
    }

    const result = await this.db.transaction(async (client) => {
      const people: SeedResult['people'] = {};

      const owner = await this.person(client, '+998901110001', 'Dilnoza Karimova');
      people.owner = { ...owner, note: 'owns Madina (grade 4) and Temur (grade 1)' };

      const coGuardian = await this.person(client, '+998901110002', 'Rustam Karimov');
      people.coGuardian = { ...coGuardian, note: 'co-guardian of both children, view only' };

      const educator = await this.person(client, '+998901110003', 'Aziza Rakhimovna');
      people.educator = { ...educator, note: 'approved tutor, public code AZR-4821' };

      // task.md § 8.4.7: an educator may also be a parent. One person, two
      // relationships (INV-01) — and the one case where an educator sees a
      // percentile band is their own child.
      const educatorParent = await this.person(client, '+998901110004', 'Nodira Yusupova');
      people.educatorParent = {
        ...educatorParent,
        note: 'approved tutor AND owner of her own child — exercises is_own_child',
      };

      const tashkentCity = 14;
      const school = await this.school(client, tashkentCity, '110-maktab, Toshkent');

      // ---- children ------------------------------------------------------
      const children: SeedResult['children'] = [];
      for (const c of SeedService.CHILDREN) {
        const id = await this.child(client, c, owner.personId);
        await this.enrol(client, id, c.grade, school, tashkentCity);
        await this.guardian(client, id, owner.personId, 'owner');
        await this.guardian(client, id, coGuardian.personId, 'co_guardian');
        await this.consents(client, id, owner.personId);
        children.push({ id, name: `${c.given} ${c.family}`, grade: c.grade });
      }

      // The educator's own child, so `is_own_child` has something to be true for.
      const ownChild = {
        key: 'sevinch',
        pinfl: '60509170000033',
        dob: '2017-09-05',
        family: 'YUSUPOVA',
        given: 'Sevinch',
        patronymic: 'Alisherovna',
        grade: 3,
      } as const;
      if (!PinflService.dobMatches(ownChild.pinfl, ownChild.dob)) {
        throw new Error('seed fixture sevinch: PINFL does not encode its DOB');
      }
      const ownChildId = await this.child(client, ownChild, educatorParent.personId);
      await this.enrol(client, ownChildId, ownChild.grade, school, tashkentCity);
      await this.guardian(client, ownChildId, educatorParent.personId, 'owner');
      await this.consents(client, ownChildId, educatorParent.personId);
      children.push({ id: ownChildId, name: 'Sevinch YUSUPOVA', grade: ownChild.grade });

      // ---- season --------------------------------------------------------
      const season = await this.season(client);

      // ---- educators -----------------------------------------------------
      await this.educatorProfile(client, educator.personId, 'AZR-4821', tashkentCity, school);
      await this.educatorProfile(client, educatorParent.personId, 'NYU-1907', tashkentCity, school);

      // Aziza gets an active link to Madina (grade 4) and a pending request for
      // Temur, so the access page has both states to render.
      await this.link(client, educator.personId, children[0].id, 'active', owner.personId, season);
      await this.link(client, educator.personId, children[1].id, 'requested', null, season);
      // Nodira links to her own child: the trigger sets is_own_child = true.
      await this.link(
        client,
        educatorParent.personId,
        ownChildId,
        'active',
        educatorParent.personId,
        season,
      );

      const groups: SeedResult['groups'] = [];
      groups.push(await this.group(client, educator.personId, '4-sinf · Shanba', 4, [children[0].id]));
      groups.push(
        // INV-15: Temur sits in the group with no active link, so the group
        // overview must still not show his data.
        await this.group(client, educator.personId, '3-sinf · Ish kunlari', 3, [
          children[0].id,
          children[1].id,
        ]),
      );

      // ---- staff ---------------------------------------------------------
      // One person per staff role, plus one holding two roles, because the
      // permission union is a thing the console has to get right.
      let n = 10;
      for (const role of STAFF_ROLES) {
        n += 1;
        const staff = await this.person(
          client,
          `+9989011100${n}`,
          `Staff · ${role.replace(/_/g, ' ')}`,
        );
        await this.staffRole(client, staff.personId, role);
        people[role] = { ...staff, note: `staff role: ${role}` };
      }

      const multi = await this.person(client, '+998901110099', 'Staff · reviewer + bank editor');
      await this.staffRole(client, multi.personId, 'item_reviewer');
      await this.staffRole(client, multi.personId, 'bank_editor');
      people.multiRoleStaff = { ...multi, note: 'holds item_reviewer AND bank_editor' };

      return { people, children, groups, season };
    });

    // Relationships just changed for everyone the seed touched.
    await this.actors.invalidate(...Object.values(result.people).map((p) => p.personId));
    this.logger.log(
      `seeded ${Object.keys(result.people).length} people, ${result.children.length} children`,
    );
    return result;
  }

  // ------------------------------------------------------------- helpers

  private async person(
    client: PoolClient,
    phone: string,
    fullName: string,
  ): Promise<{ phone: string; personId: string }> {
    const row = await client.query<{ id: string }>(
      `INSERT INTO person (full_name, phone, locale, phone_verified_at, verified_via)
       VALUES ($1, $2, 'uz', now(), 'manual')
       ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [fullName, phone],
    );
    return { phone, personId: row.rows[0].id };
  }

  private async school(client: PoolClient, regionId: number, name: string): Promise<string> {
    const found = await client.query<{ id: string }>(
      `SELECT id FROM school WHERE name = $1 AND region_id = $2`,
      [name, regionId],
    );
    if (found.rowCount) return found.rows[0].id;

    const row = await client.query<{ id: string }>(
      `INSERT INTO school (region_id, kind, name, district)
       VALUES ($1, 'general', $2, 'Yunusobod') RETURNING id`,
      [regionId, name],
    );
    return row.rows[0].id;
  }

  private async child(
    client: PoolClient,
    c: { pinfl: string; dob: string; family: string; given: string; patronymic: string },
    createdBy: string,
  ): Promise<string> {
    const hash = this.pinfl.hash(c.pinfl);
    const found = await client.query<{ id: string }>(
      `SELECT id FROM child WHERE pinfl_hash = $1`,
      [hash],
    );
    if (found.rowCount) return found.rows[0].id;

    const row = await client.query<{ id: string }>(
      `INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, patronymic, dob, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [hash, this.pinfl.seal(c.pinfl), c.family, c.given, c.patronymic, c.dob, createdBy],
    );
    return row.rows[0].id;
  }

  private async enrol(
    client: PoolClient,
    childId: string,
    grade: number,
    schoolId: string,
    regionId: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO enrolment (child_id, school_year, grade, school_id, school_region_id)
       VALUES ($1, 2026, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [childId, grade, schoolId, regionId],
    );
  }

  private async guardian(
    client: PoolClient,
    childId: string,
    personId: string,
    role: 'owner' | 'co_guardian',
  ): Promise<void> {
    await client.query(
      `INSERT INTO guardianship (child_id, person_id, role, granted_by)
       VALUES ($1, $2, $3, $2)
       ON CONFLICT DO NOTHING`,
      [childId, personId, role],
    );
  }

  private async consents(client: PoolClient, childId: string, ownerId: string): Promise<void> {
    // Only `data_processing` is required; the other two are left ungiven so the
    // consents screen has a realistic mix.
    await client.query(
      `INSERT INTO consent (child_id, person_id, type, document_version)
       VALUES ($1, $2, 'data_processing', 'v1-2026-09')
       ON CONFLICT DO NOTHING`,
      [childId, ownerId],
    );
  }

  private async season(client: PoolClient): Promise<{ id: string; code: string }> {
    const row = await client.query<{ id: string; code: string }>(
      `INSERT INTO season (code, name_uz, name_ru, starts_on, ends_on, is_current)
       VALUES ('2026/27', '2026/27 mavsumi', 'Сезон 2026/27', '2026-09-01', '2027-06-30', true)
       ON CONFLICT (code) DO UPDATE SET is_current = true
       RETURNING id, code`,
    );
    return row.rows[0];
  }

  private async educatorProfile(
    client: PoolClient,
    personId: string,
    publicCode: string,
    regionId: number,
    schoolId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO educator_profile
         (person_id, kind, status, public_code, region_id, school_id, subjects, decided_at, note)
       VALUES ($1, 'tutor', 'approved', $2, $3, $4, ARRAY['numeracy','reasoning'], now(),
               'pre-approved: one of the first hand-picked educators')
       ON CONFLICT (person_id) DO UPDATE SET status = 'approved'`,
      [personId, publicCode, regionId, schoolId],
    );
  }

  private async link(
    client: PoolClient,
    educatorId: string,
    childId: string,
    status: 'active' | 'requested',
    decidedBy: string | null,
    season: { id: string },
  ): Promise<void> {
    await client.query(
      `INSERT INTO educator_link
         (educator_person_id, child_id, status, valid_from, valid_until,
          decided_by, decided_at, season_id)
       VALUES ($1, $2, $3, now() - interval '30 days', date '2027-05-31',
               $4, CASE WHEN $4::uuid IS NULL THEN NULL ELSE now() END, $5)
       ON CONFLICT DO NOTHING`,
      [educatorId, childId, status, decidedBy, season.id],
    );
  }

  private async group(
    client: PoolClient,
    educatorId: string,
    name: string,
    grade: number,
    childIds: string[],
  ): Promise<{ id: string; name: string }> {
    const found = await client.query<{ id: string }>(
      `SELECT id FROM teaching_group WHERE educator_person_id = $1 AND name = $2`,
      [educatorId, name],
    );
    const id = found.rowCount
      ? found.rows[0].id
      : (
          await client.query<{ id: string }>(
            `INSERT INTO teaching_group (educator_person_id, name, grade) VALUES ($1, $2, $3)
             RETURNING id`,
            [educatorId, name, grade],
          )
        ).rows[0].id;

    for (const childId of childIds) {
      await client.query(
        `INSERT INTO group_member (group_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, childId],
      );
    }
    return { id, name };
  }

  private async staffRole(client: PoolClient, personId: string, role: StaffRole): Promise<void> {
    await client.query(
      `INSERT INTO staff_role_assignment (person_id, role) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [personId, role],
    );
  }
}
