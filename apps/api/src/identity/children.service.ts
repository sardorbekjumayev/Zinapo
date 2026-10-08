import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { ActorService, Actor } from '../authz';
import { CasesService } from '../trust/cases.service';
import { NotifyService } from '../notify/notify.service';
import { PinflService } from './pinfl.service';
import { CreateChildDto, CreateEnrolmentDto, PatchChildDto } from './dto/children.dto';
import {
  ChildAlreadyRegisteredException,
  ConsentRequiredException,
  FifthChildReviewException,
  PinflDobMismatchException,
  PinflMalformedException,
} from './identity.errors';

/** task.md § 3: max 4 children per owner, then manual review. */
const SELF_SERVE_CHILD_LIMIT = 4;

/** The consent document in force. Bumped when the wording changes. */
export const CONSENT_DOCUMENT_VERSION = 'v1-2026-09';

export interface ChildSummary {
  id: string;
  familyName: string;
  givenName: string;
  patronymic: string | null;
  dob: string;
  /** 'owner' | 'co_guardian' for a parent; 'educator_link' for an educator. */
  via: string;
  grade: number | null;
  schoolRegionId: number | null;
  schoolName: string | null;
}

/**
 * task.md § 6 (`identity`) and § 8.2.
 *
 * Two things this service must never do, both from § 6: return a PINFL, and let
 * an educator create a child. The first is structural — `PinflService` is the
 * only thing that sees the digits and nothing here selects those columns. The
 * second is structural too: creation is reachable only through
 * `@RequireWorkspace('family')` plus the owner check, and an educator's path to
 * a child is `educator_link` alone.
 */
@Injectable()
export class ChildrenService {
  private readonly logger = new Logger(ChildrenService.name);

  constructor(
    private readonly db: DbService,
    private readonly pinfl: PinflService,
    private readonly cases: CasesService,
    private readonly notify: NotifyService,
    private readonly actors: ActorService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The add-child wizard's one write (task.md § 8.2).
   *
   * Order matters and is deliberate:
   *   1. validate the PINFL's shape, then that it encodes the entered DOB
   *      — a mismatch is a hard stop, checked before anything is written
   *   2. require `data_processing` consent
   *   3. look the PINFL hash up; if it exists, open a dispute and stop
   *   4. count the owner's children; the fifth opens a review and stops
   *   5. create child + enrolment + owner guardianship + consents, in ONE
   *      transaction, because INV-04 is checked at COMMIT
   */
  async create(actor: Actor, dto: CreateChildDto): Promise<{ id: string }> {
    if (!PinflService.isWellFormed(dto.pinfl)) throw new PinflMalformedException();
    if (!PinflService.dobMatches(dto.pinfl, dto.dob)) throw new PinflDobMismatchException();

    const dataProcessing = dto.consents.find((c) => c.type === 'data_processing');
    if (!dataProcessing?.given) throw new ConsentRequiredException();

    const pinflHash = this.pinfl.hash(dto.pinfl);

    // Step 3, outside the transaction: if this child exists, the dispute case
    // and the owner's notification must survive, and nothing else happens.
    const existing = await this.db.one<{ id: string; owner_id: string | null }>(
      `SELECT c.id,
              (SELECT g.person_id FROM guardianship g
                WHERE g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL) AS owner_id
         FROM child c
        WHERE c.pinfl_hash = $1`,
      [pinflHash],
    );
    if (existing) {
      return this.raiseOwnershipDispute(actor, existing, dto);
    }

    const owned = await this.cases.ownedChildCount(actor.personId);
    if (owned >= SELF_SERVE_CHILD_LIMIT) {
      // Step 4. No child row — the case carries what a reviewer needs, and the
      // parent retries once it is approved.
      const caseId = await this.cases.open({
        kind: 'fifth_child',
        subjectPersonId: actor.personId,
        payload: {
          // No PINFL (INV-06). The names and the grade are enough to judge it.
          familyName: dto.familyName,
          givenName: dto.givenName,
          grade: dto.grade,
          alreadyOwns: owned,
        },
      });
      await this.audit.write({
        action: 'child.fifth_child_review',
        personId: actor.personId,
        payload: { caseId, alreadyOwns: owned },
      });
      throw new FifthChildReviewException(caseId);
    }

    const childId = await this.db.transaction(async (client) => {
      const child = await client.query<{ id: string }>(
        `INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, patronymic, dob, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          pinflHash,
          this.pinfl.seal(dto.pinfl),
          dto.familyName.trim(),
          dto.givenName.trim(),
          dto.patronymic?.trim() || null,
          dto.dob,
          actor.personId,
        ],
      );
      const id = child.rows[0].id;

      await client.query(
        `INSERT INTO guardianship (child_id, person_id, role, granted_by)
         VALUES ($1, $2, 'owner', $2)`,
        [id, actor.personId],
      );

      await client.query(
        `INSERT INTO enrolment (child_id, school_year, grade, school_id, school_region_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, schoolYearFor(dto.grade), dto.grade, dto.schoolId ?? null, dto.schoolRegionId],
      );

      for (const consent of dto.consents) {
        if (!consent.given) continue;
        await client.query(
          `INSERT INTO consent (child_id, person_id, type, document_version)
           VALUES ($1, $2, $3, $4)`,
          [id, actor.personId, consent.type, CONSENT_DOCUMENT_VERSION],
        );
      }

      return id;
    });

    // The actor now owns one more child, so `workspacesOf` and the family
    // counts are stale.
    await this.actors.invalidate(actor.personId);
    await this.audit.write({
      action: 'child.created',
      personId: actor.personId,
      payload: { childId, grade: dto.grade, schoolRegionId: dto.schoolRegionId },
    });
    this.logger.log(`child ${childId} created by ${actor.personId}`);
    return { id: childId };
  }

  /**
   * task.md § 8.2: "Already registered: open an `ownership_dispute` case and
   * notify the current owner. Don't create a duplicate."
   *
   * The claimant learns only that a profile exists — never who holds it.
   */
  private async raiseOwnershipDispute(
    actor: Actor,
    existing: { id: string; owner_id: string | null },
    dto: CreateChildDto,
  ): Promise<never> {
    // One live dispute per (child, claimant). A parent tapping twice should not
    // produce two cases for a human to read.
    const open = await this.db.one<{ id: string }>(
      `SELECT id FROM review_case
        WHERE kind = 'ownership_dispute'
          AND subject_child_id = $1
          AND payload->>'claimantPersonId' = $2
          AND status IN ('open', 'waiting_owner')`,
      [existing.id, actor.personId],
    );

    const caseId =
      open?.id ??
      (await this.cases.open({
        kind: 'ownership_dispute',
        subjectPersonId: actor.personId,
        subjectChildId: existing.id,
        payload: {
          claimantPersonId: actor.personId,
          claimedFamilyName: dto.familyName,
          claimedGivenName: dto.givenName,
          currentOwnerPersonId: existing.owner_id,
        },
      }));

    if (!open && existing.owner_id) {
      await this.notify.queue({
        personId: existing.owner_id,
        template: 'case_needs_owner_confirmation',
        vars: {
          child: `${dto.givenName} ${dto.familyName}`,
          reason: 'Boshqa foydalanuvchi shu farzand profiliga egalik qilmoqchi.',
          link: '/family/access',
        },
      });
    }

    await this.audit.write({
      action: 'child.duplicate_attempt',
      personId: actor.personId,
      payload: { childId: existing.id, caseId },
    });
    throw new ChildAlreadyRegisteredException(caseId);
  }

  /**
   * Every child this person can see as a parent, with the current enrolment.
   * The educator's list is a different read model and goes through
   * `v_educator_visible_child` (INV-15).
   */
  async listForParent(actor: Actor): Promise<ChildSummary[]> {
    return this.db.query<ChildSummary>(
      `SELECT c.id,
              c.family_name  AS "familyName",
              c.given_name   AS "givenName",
              c.patronymic,
              c.dob::text,
              g.role::text   AS via,
              e.grade,
              e.school_region_id AS "schoolRegionId",
              s.name         AS "schoolName"
         FROM guardianship g
         JOIN child c ON c.id = g.child_id
    LEFT JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL
    LEFT JOIN school s ON s.id = e.school_id
        WHERE g.person_id = $1
          AND g.revoked_at IS NULL
          AND c.anonymised_at IS NULL
        ORDER BY c.dob`,
      [actor.personId],
    );
  }

  /** One child. The caller has already been authorised by `@ChildAccess`. */
  async get(childId: string): Promise<ChildSummary | null> {
    return this.db.one<ChildSummary>(
      `SELECT c.id,
              c.family_name AS "familyName",
              c.given_name  AS "givenName",
              c.patronymic,
              c.dob::text,
              'owner'::text AS via,
              e.grade,
              e.school_region_id AS "schoolRegionId",
              s.name        AS "schoolName"
         FROM child c
    LEFT JOIN enrolment e ON e.child_id = c.id AND e.ended_at IS NULL
    LEFT JOIN school s ON s.id = e.school_id
        WHERE c.id = $1 AND c.anonymised_at IS NULL`,
      [childId],
    );
  }

  async patch(actor: Actor, childId: string, dto: PatchChildDto): Promise<ChildSummary | null> {
    await this.db.query(
      `UPDATE child
          SET family_name = COALESCE($2, family_name),
              given_name  = COALESCE($3, given_name),
              patronymic  = COALESCE($4, patronymic),
              updated_at  = now()
        WHERE id = $1 AND anonymised_at IS NULL`,
      [childId, dto.familyName ?? null, dto.givenName ?? null, dto.patronymic ?? null],
    );
    await this.audit.write({
      action: 'child.updated',
      personId: actor.personId,
      payload: { childId, fields: Object.keys(dto) },
    });
    return this.get(childId);
  }

  /** A school or grade change closes the current enrolment and opens the next. */
  async addEnrolment(actor: Actor, childId: string, dto: CreateEnrolmentDto): Promise<void> {
    await this.db.transaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE enrolment SET ended_at = now()
          WHERE child_id = $1 AND ended_at IS NULL AND school_year = $2`,
        [childId, dto.schoolYear],
      );
      await client.query(
        `INSERT INTO enrolment (child_id, school_year, grade, school_id, school_region_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [childId, dto.schoolYear, dto.grade, dto.schoolId ?? null, dto.schoolRegionId],
      );
    });
    await this.audit.write({
      action: 'child.enrolment_added',
      personId: actor.personId,
      payload: { childId, grade: dto.grade, schoolRegionId: dto.schoolRegionId },
    });
  }

  async enrolments(childId: string) {
    return this.db.query(
      `SELECT e.id,
              e.school_year AS "schoolYear",
              e.grade,
              e.school_region_id AS "schoolRegionId",
              r.name_uz AS "regionNameUz",
              r.name_ru AS "regionNameRu",
              s.name    AS "schoolName",
              e.started_at AS "startedAt",
              e.ended_at   AS "endedAt"
         FROM enrolment e
         JOIN region r ON r.id = e.school_region_id
    LEFT JOIN school s ON s.id = e.school_id
        WHERE e.child_id = $1
        ORDER BY e.school_year DESC, e.started_at DESC`,
      [childId],
    );
  }
}

/**
 * The school year a grade belongs to. The season runs September to June, so
 * anything from July onwards is the coming year — a parent adding a child in
 * August is enrolling them for the year that is about to start, not the one
 * that just ended.
 */
function schoolYearFor(_grade: number): number {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
