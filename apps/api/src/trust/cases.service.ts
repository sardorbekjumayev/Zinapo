import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { AuditService } from '../common/audit.service';

export type CaseKind = 'ownership_dispute' | 'fifth_child' | 'educator_application' | 'fraud_flag';
export type CaseStatus = 'open' | 'waiting_owner' | 'resolved' | 'dismissed';

export interface OpenCase {
  kind: CaseKind;
  subjectPersonId?: string | null;
  subjectChildId?: string | null;
  registrationFlagId?: number | null;
  payload?: Record<string, unknown>;
}

/**
 * The single trust & safety queue (task.md § 5, § 8.5): fraud flags, ownership
 * disputes, fifth-child reviews and educator applications all land in
 * `review_case`.
 *
 * M2 only needs to OPEN cases — the queue UI and the resolutions are M8. Having
 * one place that opens them now means M8 inherits a consistent payload shape
 * instead of four ad-hoc ones.
 *
 * The payload must never contain a PINFL (INV-06). What a reviewer needs is the
 * child id and the names, and both are already in the database.
 */
@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async open(input: OpenCase, client?: PoolClient): Promise<string> {
    const sql = `
      INSERT INTO review_case
        (kind, subject_person_id, subject_child_id, registration_flag_id, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id`;
    const params = [
      input.kind,
      input.subjectPersonId ?? null,
      input.subjectChildId ?? null,
      input.registrationFlagId ?? null,
      JSON.stringify(input.payload ?? {}),
    ];

    const id = client
      ? (await client.query<{ id: string }>(sql, params as never[])).rows[0].id
      : (await this.db.one<{ id: string }>(sql, params))!.id;

    await this.audit.write({
      action: 'case.opened',
      personId: input.subjectPersonId ?? null,
      payload: { kind: input.kind, caseId: id, childId: input.subjectChildId ?? null },
    });
    this.logger.log(`opened ${input.kind} case ${id}`);
    return id;
  }

  /**
   * How many children this person already owns. task.md § 8.2: the fifth goes
   * to manual review instead of failing, because large families are real and a
   * hard cap would lock them out.
   */
  async ownedChildCount(personId: string, client?: PoolClient): Promise<number> {
    const sql = `SELECT count(*)::int AS n
                   FROM guardianship
                  WHERE person_id = $1 AND role = 'owner' AND revoked_at IS NULL`;
    const rows = client
      ? (await client.query<{ n: number }>(sql, [personId] as never[])).rows
      : await this.db.query<{ n: number }>(sql, [personId]);
    return rows[0]?.n ?? 0;
  }
}
