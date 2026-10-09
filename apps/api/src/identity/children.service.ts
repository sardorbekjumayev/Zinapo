import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { maskPhoneForDisplay } from '../common/phone.util';
import { AppConfig, CONFIG } from '../config/configuration';
import { ActorService, Actor, workspacesOf } from '../authz';
import { CasesService } from '../trust/cases.service';
import { NotifyService } from '../notify/notify.service';
import { PinflService } from './pinfl.service';
import { SeasonLookup, currentSchoolYear } from './season.lookup';
import { CreateChildDto, CreateEnrolmentDto, PatchChildDto } from './dto/children.dto';
import {
  ChildAlreadyLinkedException,
  ChildAlreadyRegisteredException,
  ChildCreateForbiddenException,
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
  /** How the caller relates to the child: 'owner' | 'co_guardian'. */
  via: string;
  grade: number | null;
  schoolYear: number | null;
  schoolRegionId: number | null;
  regionNameUz: string | null;
  regionNameRu: string | null;
  schoolId: string | null;
  schoolName: string | null;
  /** The owner's name — what a co-guardian needs to know who decides. */
  ownerName: string | null;
  /** An anonymisation request is waiting out its grace window. */
  deletionRequested: boolean;
}

/** What the wizard's "done" step and the 202/409 screens need back. */
export interface CreateChildResult {
  id: string;
  /** The same owner submitted the same PINFL again — nothing was created. */
  alreadyYours?: boolean;
  /** An educator link was created from the invite toggle. */
  sharedWith?: { educatorName: string; validUntil: string } | null;
}

/** An educator invite as the wizard shows it — never the educator's phone. */
export interface InvitePreview {
  educatorName: string;
  publicCode: string;
  /** Access would last until this date if the parent leaves the toggle on. */
  validUntil: string;
}

/**
 * task.md § 6 (`identity`) and § 8.1.
 *
 * Two things this service must never do, both from § 6: return a PINFL, and let
 * an educator create a child. The first is structural — `PinflService` is the
 * only thing that sees the digits and nothing here selects those columns. The
 * second is `canCreate` below plus the fact that an educator's only path to a
 * child is `educator_link`.
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
    private readonly seasons: SeasonLookup,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * task.md § 3, "Create a child profile": ✅ owner, ❌ co-guardian, ❌ educator
   * ("never"), ❌ staff — and § 2.2 sends a person with no role to onboarding,
   * whose first door is "add my child". So: someone who already owns a child,
   * or someone who holds nothing yet. Note M2-c records the gap this leaves.
   */
  canCreate(actor: Actor): boolean {
    return actor.ownerOf > 0 || workspacesOf(actor).length === 0;
  }

  /**
   * The add-child wizard's one write (task.md § 8.1.2).
   *
   * Order matters and is deliberate:
   *   1. validate the PINFL's shape, then that it encodes the entered DOB
   *      — a mismatch is a hard stop, checked before anything is written
   *   2. require `data_processing` consent
   *   3. look the PINFL hash up; if it exists, open a dispute and stop
   *   4. count the owner's children; the fifth opens a review and stops
   *   5. create child + enrolment + owner guardianship + consents (+ the
   *      invite's educator link), in ONE transaction, because INV-04 is
   *      checked at COMMIT
   */
  async create(actor: Actor, dto: CreateChildDto, device?: { ip: string | null; userAgent: string | null }): Promise<CreateChildResult> {
    if (!this.canCreate(actor)) throw new ChildCreateForbiddenException();
    if (!PinflService.isWellFormed(dto.pinfl)) throw new PinflMalformedException();
    if (!PinflService.dobMatches(dto.pinfl, dto.dob)) throw new PinflDobMismatchException();

    const dataProcessing = dto.consents.find((c) => c.type === 'data_processing');
    if (!dataProcessing?.given) throw new ConsentRequiredException();

    const pinflHash = this.pinfl.hash(dto.pinfl);

    // Step 3, outside the transaction: if this child exists, the dispute case
    // and the owner's notification must survive, and nothing else happens.
    const existing = await this.db.one<{
      id: string;
      owner_id: string | null;
      my_role: 'owner' | 'co_guardian' | null;
    }>(
      `SELECT c.id,
              (SELECT g.person_id FROM guardianship g
                WHERE g.child_id = c.id AND g.role = 'owner' AND g.revoked_at IS NULL) AS owner_id,
              (SELECT g.role FROM guardianship g
                WHERE g.child_id = c.id AND g.person_id = $2 AND g.revoked_at IS NULL) AS my_role
         FROM child c
        WHERE c.pinfl_hash = $1`,
      [pinflHash, actor.personId],
    );
    if (existing) {
      // Submitting your own child twice (a double tap, a retry after a dropped
      // connection — design/02's error state promises "nothing will be sent
      // twice") is not a dispute.
      if (existing.my_role === 'owner') return { id: existing.id, alreadyYours: true };
      if (existing.my_role === 'co_guardian') throw new ChildAlreadyLinkedException();
      return this.raiseOwnershipDispute(actor, existing, dto);
    }

    const owned = await this.cases.ownedChildCount(actor.personId);
    // M8: trust & safety approved a fifth (or later) child — that approval
    // admits exactly one more, and is used up by it.
    const approved =
      owned >= SELF_SERVE_CHILD_LIMIT
        ? await this.db.one<{ id: string }>(
            `UPDATE review_case SET payload = payload || '{"used": true}'::jsonb
              WHERE id = (SELECT id FROM review_case
                           WHERE kind = 'fifth_child' AND subject_person_id = $1 AND status = 'resolved'
                             AND resolution = 'approved' AND COALESCE((payload->>'used')::boolean, false) = false
                           ORDER BY resolved_at LIMIT 1)
              RETURNING id`,
            [actor.personId],
          )
        : null;
    if (owned >= SELF_SERVE_CHILD_LIMIT && !approved) {
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
      throw new FifthChildReviewException(caseId, await this.maskedPhone(actor.personId));
    }

    const invite = dto.inviteCode ? await this.findInvite(dto.inviteCode) : null;
    const season = await this.seasons.current();

    const { childId, sharedWith } = await this.db.transaction(async (client) => {
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
        [id, currentSchoolYear(), dto.grade, dto.schoolId ?? null, dto.schoolRegionId],
      );

      for (const consent of dto.consents) {
        if (!consent.given) continue;
        await client.query(
          `INSERT INTO consent (child_id, person_id, type, document_version)
           VALUES ($1, $2, $3, $4)`,
          [id, actor.personId, consent.type, CONSENT_DOCUMENT_VERSION],
        );
      }

      const shared = invite
        ? await this.applyInvite(client, actor, id, invite, dto.shareWithInviter !== false, season)
        : null;

      return { childId: id, sharedWith: shared };
    });

    // The actor now owns one more child, so `workspacesOf` and the family
    // counts are stale.
    await this.actors.invalidate(actor.personId);
    await this.audit.write({
      action: 'child.created',
      personId: actor.personId,
      payload: {
        childId,
        grade: dto.grade,
        schoolRegionId: dto.schoolRegionId,
        consents: dto.consents.filter((c) => c.given).map((c) => c.type),
        documentVersion: CONSENT_DOCUMENT_VERSION,
      },
      ip: device?.ip ?? null,
      userAgent: device?.userAgent?.slice(0, 300) ?? null,
    });
    this.logger.log(`child ${childId} created by ${actor.personId}`);
    return { id: childId, sharedWith };
  }

  /**
   * task.md § 8.1.2: "Already registered: open an `ownership_dispute` case and
   * notify the current owner. Don't create a duplicate."
   *
   * The claimant learns only that a profile exists — never who holds it. The
   * case is opened now, as the spec says; the claimant's explicit "open a
   * dispute" on design/02 is recorded by `confirmDispute`, which is what moves
   * the case from "someone typed this PINFL" to "someone claims this child"
   * (note M2-d).
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
          claimantConfirmed: false,
        },
      }));

    if (!open && existing.owner_id) {
      const child = await this.db.one<{ name: string }>(
        `SELECT given_name || ' ' || family_name AS name FROM child WHERE id = $1`,
        [existing.id],
      );
      await this.notify.queue({
        personId: existing.owner_id,
        template: 'case_needs_owner_confirmation',
        vars: {
          // The OWNER's record of the name, not what the claimant typed.
          child: child?.name ?? '',
          reason: 'Boshqa foydalanuvchi shu farzand profiliga egalik qilmoqchi.',
          link: `${this.config.webOrigin}/uz/family/access`,
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
   * design/02 "Open an ownership dispute": the claimant confirms they mean it.
   * Only the person who raised the case may confirm it, and only once.
   */
  async confirmDispute(
    actor: Actor,
    caseId: string,
  ): Promise<{ caseId: string; reference: string; phone: string }> {
    const row = await this.db.one<{ id: string; subject_child_id: string }>(
      `UPDATE review_case
          SET payload = payload || '{"claimantConfirmed": true}'::jsonb
        WHERE id = $1
          AND kind = 'ownership_dispute'
          AND payload->>'claimantPersonId' = $2
          AND status IN ('open', 'waiting_owner')
        RETURNING id, subject_child_id`,
      [caseId, actor.personId],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });

    await this.audit.write({
      action: 'child.dispute_confirmed',
      personId: actor.personId,
      // `childId` deliberately omitted: this row belongs to the claimant, and
      // the owner's change log reads by child — the claimant is not family.
      payload: { caseId },
    });
    return {
      caseId,
      reference: caseReference('D', caseId),
      phone: await this.maskedPhone(actor.personId),
    };
  }

  /**
   * Every child this person can see as a parent, with the current enrolment.
   * The educator's list is a different read model and goes through
   * `v_educator_visible_child` (INV-15).
   */
  async listForParent(actor: Actor): Promise<ChildSummary[]> {
    return this.db.query<ChildSummary>(
      `${SUMMARY_SELECT}
        WHERE g.person_id = $1
          AND g.revoked_at IS NULL
          AND c.anonymised_at IS NULL
        ORDER BY c.dob`,
      [actor.personId],
    );
  }

  /** One child, as the caller relates to them. Authorised by `@ChildAccess`. */
  async get(actor: Actor, childId: string): Promise<ChildSummary | null> {
    return this.db.one<ChildSummary>(
      `${SUMMARY_SELECT}
        WHERE g.person_id = $1
          AND g.child_id = $2
          AND g.revoked_at IS NULL
          AND c.anonymised_at IS NULL`,
      [actor.personId, childId],
    );
  }

  async patch(actor: Actor, childId: string, dto: PatchChildDto): Promise<ChildSummary | null> {
    await this.db.query(
      `UPDATE child
          SET family_name = COALESCE($2, family_name),
              given_name  = COALESCE($3, given_name),
              patronymic  = COALESCE($4, patronymic)
        WHERE id = $1 AND anonymised_at IS NULL`,
      [
        childId,
        dto.familyName?.trim() || null,
        dto.givenName?.trim() || null,
        dto.patronymic?.trim() || null,
      ],
    );
    await this.audit.write({
      action: 'child.updated',
      personId: actor.personId,
      payload: { childId, fields: Object.keys(dto) },
    });
    return this.get(actor, childId);
  }

  /**
   * A school or grade change closes the current enrolment of that school year
   * and opens the next — history, not an edit (task.md § 12 M2). The session
   * snapshots grade and region anyway, so an old wave's cohort never moves.
   */
  async addEnrolment(actor: Actor, childId: string, dto: CreateEnrolmentDto): Promise<void> {
    if (dto.schoolId) {
      const school = await this.db.one<{ region_id: number }>(
        `SELECT region_id FROM school WHERE id = $1`,
        [dto.schoolId],
      );
      // The school's region IS the cohort region (task.md § 8.1.2). Letting
      // them disagree would put the child in the wrong cohort silently.
      if (!school || school.region_id !== dto.schoolRegionId) {
        throw new NotFoundException({ error: 'SCHOOL_NOT_IN_REGION' });
      }
    }

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
      payload: {
        childId,
        schoolYear: dto.schoolYear,
        grade: dto.grade,
        schoolRegionId: dto.schoolRegionId,
      },
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

  // ------------------------------------------------------------ invites

  /**
   * design/02: a parent who arrived from an educator's invite sees "Share
   * Madina's reports with Aziza Rakhimovna until 31 May", ON, switchable
   * (task.md § 8.1.2). Only the educator's name and public code — the invite
   * itself is M6.
   */
  async previewInvite(code: string): Promise<InvitePreview | null> {
    const invite = await this.findInvite(code);
    if (!invite) return null;
    const season = await this.seasons.current();
    return {
      educatorName: invite.educator_name,
      publicCode: invite.public_code,
      validUntil: season?.schoolYearEnd ?? oneYearFromNow(),
    };
  }

  private async findInvite(code: string) {
    return this.db.one<{
      id: string;
      educator_person_id: string;
      educator_name: string;
      public_code: string;
    }>(
      `SELECT ei.id, ei.educator_person_id, p.full_name AS educator_name, ep.public_code
         FROM educator_invite ei
         JOIN educator_profile ep ON ep.person_id = ei.educator_person_id
         JOIN person p ON p.id = ei.educator_person_id
        WHERE ei.code = $1
          AND ei.cancelled_at IS NULL
          AND ei.expires_at > now()
          AND ep.status = 'approved'`,
      [code],
    );
  }

  /**
   * Marks the invite used (it attributes the family to the educator either
   * way) and, if the toggle stayed on, creates the active link the parent just
   * approved. An educator cannot reach this path for themselves: the link is
   * created by the OWNER's request, keyed by an invite the owner received.
   */
  private async applyInvite(
    client: PoolClient,
    actor: Actor,
    childId: string,
    invite: { id: string; educator_person_id: string; educator_name: string },
    share: boolean,
    season: Awaited<ReturnType<SeasonLookup['current']>>,
  ): Promise<{ educatorName: string; validUntil: string } | null> {
    await client.query(
      `UPDATE educator_invite SET accepted_by = $2, accepted_at = now()
        WHERE id = $1 AND accepted_at IS NULL`,
      [invite.id, actor.personId],
    );
    if (!share) return null;

    const validUntil = season?.schoolYearEnd ?? oneYearFromNow();
    const link = await client.query<{ id: string }>(
      `INSERT INTO educator_link
         (educator_person_id, child_id, status, valid_from, valid_until,
          decided_by, decided_at, season_id)
       VALUES ($1, $2, 'active', now(),
               ($3::date + interval '1 day' - interval '1 second') AT TIME ZONE 'Asia/Tashkent',
               $4, now(), $5)
       RETURNING id`,
      [invite.educator_person_id, childId, validUntil, actor.personId, season?.id ?? null],
    );
    await this.audit.write({
      action: 'access.granted',
      personId: actor.personId,
      payload: {
        childId,
        linkId: link.rows[0].id,
        educatorPersonId: invite.educator_person_id,
        validUntil,
        via: 'invite',
      },
    });
    await this.actors.invalidate(invite.educator_person_id);
    return { educatorName: invite.educator_name, validUntil };
  }

  private async maskedPhone(personId: string): Promise<string> {
    const row = await this.db.one<{ phone: string }>(`SELECT phone FROM person WHERE id = $1`, [
      personId,
    ]);
    return row ? maskPhoneForDisplay(row.phone) : '';
  }
}

/**
 * The read model behind every family-side child listing. `g` is the caller's
 * own guardianship row, so `via` is always the caller's relationship.
 */
const SUMMARY_SELECT = `
  SELECT c.id,
         c.family_name  AS "familyName",
         c.given_name   AS "givenName",
         c.patronymic,
         c.dob::text,
         g.role::text   AS via,
         e.grade,
         e.school_year  AS "schoolYear",
         e.school_region_id AS "schoolRegionId",
         r.name_uz      AS "regionNameUz",
         r.name_ru      AS "regionNameRu",
         e.school_id    AS "schoolId",
         s.name         AS "schoolName",
         (SELECT p.full_name FROM guardianship og JOIN person p ON p.id = og.person_id
           WHERE og.child_id = c.id AND og.role = 'owner' AND og.revoked_at IS NULL) AS "ownerName",
         EXISTS (SELECT 1 FROM anonymisation_request ar
                  WHERE ar.child_id = c.id AND ar.executed_at IS NULL
                    AND ar.cancelled_at IS NULL) AS "deletionRequested"
    FROM guardianship g
    JOIN child c ON c.id = g.child_id
LEFT JOIN LATERAL (
           SELECT * FROM enrolment e
            WHERE e.child_id = c.id AND e.ended_at IS NULL
            ORDER BY e.school_year DESC, e.started_at DESC
            LIMIT 1) e ON true
LEFT JOIN region r ON r.id = e.school_region_id
LEFT JOIN school s ON s.id = e.school_id`;

/** "D-3F2A91C0" — the request number on design/02 and design/06. */
export function caseReference(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function oneYearFromNow(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
