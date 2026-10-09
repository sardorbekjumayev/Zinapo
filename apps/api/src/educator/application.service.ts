import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../notify/notify.service';
import { CasesService } from '../trust/cases.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { toE164 } from '../common/phone.util';
import { Actor, ActorService } from '../authz';
import { publicCodeFor } from './educator.util';

export type EducatorKind = 'tutor' | 'school_teacher' | 'learning_centre';

export interface ApplyInput {
  kind: EducatorKind;
  regionId: number;
  schoolId?: string | null;
  subjects: string[];
}

/**
 * task.md § 8.4.1 — becoming an educator.
 *
 *   /onboarding → "I'm a tutor/teacher" → kind, region, school, subjects →
 *   `educator_profile.status = 'applied'` → a trust & safety case → decided.
 *
 * "The first ~100 educators are invited by staff and pre-approved": staff
 * vouch for a phone number (`educator_preapproval`), and that person's
 * application is approved the moment it is made — no case, no wait.
 */
@Injectable()
export class ApplicationService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly cases: CasesService,
    private readonly actors: ActorService,
  ) {}

  async profile(actor: Actor) {
    const row = await this.db.one<{
      status: string;
      kind: string;
      public_code: string;
      region_id: number | null;
      region_uz: string | null;
      region_ru: string | null;
      school_id: string | null;
      school_name: string | null;
      subjects: string[] | null;
      applied_at: Date;
      decided_at: Date | null;
      note: string | null;
    }>(
      `SELECT ep.status::text, ep.kind::text, ep.public_code, ep.region_id, r.name_uz AS region_uz,
              r.name_ru AS region_ru, ep.school_id, s.name AS school_name, ep.subjects, ep.applied_at,
              ep.decided_at, ep.note
         FROM educator_profile ep
    LEFT JOIN region r ON r.id = ep.region_id
    LEFT JOIN school s ON s.id = ep.school_id
        WHERE ep.person_id = $1`,
      [actor.personId],
    );
    if (!row) return { status: null };
    return {
      status: row.status,
      kind: row.kind,
      // The code is only useful — and only printed on invites — once approved.
      publicCode: row.status === 'approved' ? row.public_code : null,
      region: row.region_id ? { id: row.region_id, nameUz: row.region_uz, nameRu: row.region_ru } : null,
      school: row.school_id ? { id: row.school_id, name: row.school_name } : null,
      subjects: row.subjects ?? [],
      appliedAt: row.applied_at,
      decidedAt: row.decided_at,
      // A rejection may carry a reason for the applicant; staff notes on an
      // approval are internal.
      note: row.status === 'rejected' ? row.note : null,
    };
  }

  async apply(actor: Actor, input: ApplyInput) {
    const existing = await this.db.one<{ status: string }>(
      `SELECT status::text FROM educator_profile WHERE person_id = $1`,
      [actor.personId],
    );
    if (existing && existing.status !== 'rejected') {
      throw new ConflictException({ error: 'ALREADY_APPLIED', details: { status: existing.status } });
    }
    if (input.schoolId) {
      const school = await this.db.one(`SELECT 1 FROM school WHERE id = $1 AND region_id = $2`, [input.schoolId, input.regionId]);
      if (!school) throw new ConflictException({ error: 'SCHOOL_NOT_IN_REGION' });
    }

    const person = await this.db.one<{ full_name: string; phone: string }>(
      `SELECT full_name, phone FROM person WHERE id = $1`,
      [actor.personId],
    );
    const subjects = [...new Set(input.subjects)];

    const result = await this.db.transaction(async (client) => {
      const pre = await client.query<{ id: string; invited_by: string }>(
        `SELECT id, invited_by FROM educator_preapproval
          WHERE phone_e164 = $1 AND used_at IS NULL AND cancelled_at IS NULL
          FOR UPDATE`,
        [person!.phone],
      );
      const preapproved = pre.rows[0] ?? null;
      const status = preapproved ? 'approved' : 'applied';

      await this.upsertProfile(client, actor.personId, person!.full_name, input, subjects, status, preapproved?.invited_by ?? null);

      if (preapproved) {
        await client.query(`UPDATE educator_preapproval SET used_by = $2, used_at = now() WHERE id = $1`, [
          preapproved.id,
          actor.personId,
        ]);
        return { status, caseId: null as string | null };
      }
      const caseId = await this.cases.open(
        {
          kind: 'educator_application',
          subjectPersonId: actor.personId,
          payload: { kind: input.kind, regionId: input.regionId, schoolId: input.schoolId ?? null, subjects },
        },
        client,
      );
      return { status, caseId };
    });

    // The educator workspace exists from this moment (applied or approved).
    await this.actors.invalidate(actor.personId);
    await this.audit.write({
      action: 'educator.applied',
      personId: actor.personId,
      payload: { kind: input.kind, preapproved: result.status === 'approved' },
    });
    if (result.status === 'approved') await this.announceDecision(actor.personId, 'approved', null);
    return this.profile(actor);
  }

  private async upsertProfile(
    client: PoolClient,
    personId: string,
    fullName: string,
    input: ApplyInput,
    subjects: string[],
    status: 'applied' | 'approved',
    decidedBy: string | null,
  ): Promise<void> {
    // A re-application after a rejection keeps the code: it may already be on
    // paper somewhere, and codes are never reused for someone else anyway.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await client.query('SAVEPOINT ep');
        await client.query(
          `INSERT INTO educator_profile
             (person_id, kind, status, public_code, region_id, school_id, subjects, applied_at,
              decided_by, decided_at, note)
           VALUES ($1, $2, $3::educator_status, $4, $5, $6, $7, now(), $8,
                   CASE WHEN $3::text = 'approved' THEN now() END,
                   CASE WHEN $3::text = 'approved' THEN 'pre-approved by staff' END)
           ON CONFLICT (person_id) DO UPDATE
              SET kind = EXCLUDED.kind, status = EXCLUDED.status, region_id = EXCLUDED.region_id,
                  school_id = EXCLUDED.school_id, subjects = EXCLUDED.subjects, applied_at = now(),
                  decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at, note = EXCLUDED.note`,
          [personId, input.kind, status, publicCodeFor(fullName), input.regionId, input.schoolId ?? null, subjects, decidedBy],
        );
        await client.query('RELEASE SAVEPOINT ep');
        return;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT ep');
        // 23505 on public_code: another educator drew the same digits.
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
    throw new ConflictException({ error: 'PUBLIC_CODE_EXHAUSTED' });
  }

  // =========================================================== staff side

  /** The trust & safety tab: open applications first, then recent decisions. */
  async applications(status: 'applied' | 'decided') {
    return this.db.query(
      `SELECT p.id AS "personId", p.full_name AS "fullName", p.phone, ep.kind::text AS kind,
              ep.status::text AS status, r.name_uz AS "regionUz", r.name_ru AS "regionRu",
              s.name AS "schoolName", ep.subjects, ep.applied_at AS "appliedAt",
              ep.decided_at AS "decidedAt", ep.note, d.full_name AS "decidedBy",
              rc.id AS "caseId"
         FROM educator_profile ep
         JOIN person p ON p.id = ep.person_id
    LEFT JOIN region r ON r.id = ep.region_id
    LEFT JOIN school s ON s.id = ep.school_id
    LEFT JOIN person d ON d.id = ep.decided_by
    LEFT JOIN LATERAL (SELECT id FROM review_case c
                        WHERE c.kind = 'educator_application' AND c.subject_person_id = ep.person_id
                        ORDER BY c.opened_at DESC LIMIT 1) rc ON true
        WHERE CASE WHEN $1 = 'applied' THEN ep.status = 'applied' ELSE ep.status <> 'applied' END
        ORDER BY CASE WHEN $1 = 'applied' THEN ep.applied_at END ASC,
                 ep.decided_at DESC NULLS LAST
        LIMIT 200`,
      [status],
    );
  }

  async decide(actor: Actor, personId: string, decision: 'approved' | 'rejected', note: string | null) {
    const done = await this.db.transaction(async (client) => {
      const row = await client.query<{ status: string }>(
        `SELECT status::text FROM educator_profile WHERE person_id = $1 FOR UPDATE`,
        [personId],
      );
      if (!row.rowCount) throw new NotFoundException({ error: 'NOT_FOUND' });
      if (row.rows[0].status !== 'applied') {
        throw new ConflictException({ error: 'ALREADY_DECIDED', details: { status: row.rows[0].status } });
      }
      await client.query(
        `UPDATE educator_profile SET status = $2, decided_by = $3, decided_at = now(), note = $4
          WHERE person_id = $1`,
        [personId, decision, actor.personId, note],
      );
      await client.query(
        `UPDATE review_case SET status = 'resolved', resolution = $2, resolved_at = now(), assigned_to = $3
          WHERE kind = 'educator_application' AND subject_person_id = $1 AND status IN ('open', 'waiting_owner')`,
        [personId, decision, actor.personId],
      );
      return true;
    });
    if (done) {
      await this.actors.invalidate(personId);
      await this.audit.write({ action: 'educator.decided', personId: actor.personId, payload: { educatorId: personId, decision } });
      await this.announceDecision(personId, decision, note);
    }
    return { personId, status: decision };
  }

  async preapprovals() {
    return this.db.query(
      `SELECT pa.id, pa.phone_e164 AS phone, pa.kind::text AS kind, pa.note, pa.created_at AS "createdAt",
              i.full_name AS "invitedBy", pa.used_at AS "usedAt", u.full_name AS "usedBy", pa.cancelled_at AS "cancelledAt"
         FROM educator_preapproval pa
         JOIN person i ON i.id = pa.invited_by
    LEFT JOIN person u ON u.id = pa.used_by
        ORDER BY pa.cancelled_at IS NOT NULL, pa.used_at IS NOT NULL, pa.created_at DESC
        LIMIT 300`,
    );
  }

  /**
   * Vouch for a phone number. If that person already applied and is waiting,
   * the vouching is the decision: approve them now rather than leave a
   * pre-approval that can never be used.
   */
  async preapprove(actor: Actor, rawPhone: string, kind: EducatorKind, note: string | null) {
    const phone = toE164(rawPhone);
    if (!phone) throw new ConflictException({ error: 'PHONE_INVALID' });

    const waiting = await this.db.one<{ person_id: string }>(
      `SELECT ep.person_id FROM educator_profile ep JOIN person p ON p.id = ep.person_id
        WHERE p.phone = $1 AND ep.status = 'applied'`,
      [phone],
    );
    if (waiting) {
      await this.decide(actor, waiting.person_id, 'approved', note ?? 'pre-approved by staff');
      return { phone, approvedNow: true };
    }
    const already = await this.db.one<{ status: string }>(
      `SELECT ep.status::text FROM educator_profile ep JOIN person p ON p.id = ep.person_id WHERE p.phone = $1`,
      [phone],
    );
    if (already?.status === 'approved') throw new ConflictException({ error: 'ALREADY_EDUCATOR' });

    try {
      await this.db.one(
        `INSERT INTO educator_preapproval (phone_e164, kind, note, invited_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [phone, kind, note, actor.personId],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException({ error: 'ALREADY_PREAPPROVED' });
      throw err;
    }
    await this.audit.write({ action: 'educator.preapproved', personId: actor.personId, payload: { kind } });
    return { phone, approvedNow: false };
  }

  async cancelPreapproval(actor: Actor, id: string) {
    const row = await this.db.one(
      `UPDATE educator_preapproval SET cancelled_at = now()
        WHERE id = $1 AND used_at IS NULL AND cancelled_at IS NULL RETURNING id`,
      [id],
    );
    if (!row) throw new NotFoundException({ error: 'NOT_FOUND' });
    await this.audit.write({ action: 'educator.preapproved', personId: actor.personId, payload: { cancelled: true } });
    return { ok: true };
  }

  private async announceDecision(personId: string, decision: 'approved' | 'rejected', note: string | null) {
    const code = await this.db.one<{ public_code: string }>(`SELECT public_code FROM educator_profile WHERE person_id = $1`, [personId]);
    await this.notify.queue({
      personId,
      template: 'educator_application_decided',
      vars: {
        decision,
        code: code?.public_code ?? '',
        note: note ?? '',
        link: `${this.config.webOrigin}/uz/educator/invites`,
      },
    });
  }
}
