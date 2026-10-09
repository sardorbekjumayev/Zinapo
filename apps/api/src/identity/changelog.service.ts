import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Actor } from '../authz';

/** The actions a family sees in its change log (design/06, "Change log"). */
const FAMILY_ACTIONS = [
  'child.created',
  'child.updated',
  'child.enrolment_added',
  'guardian.invited',
  'guardian.invite_accepted',
  'guardian.invite_cancelled',
  'guardian.removed',
  'ownership.transfer_offered',
  'ownership.transfer_cancelled',
  'ownership.transferred',
  'consent.given',
  'consent.revoked',
  'access.requested',
  'access.granted',
  'access.declined',
  'access.revoked',
  'access.restored',
  'access.suspended',
  'privacy.anonymisation_requested',
  'privacy.anonymisation_cancelled',
] as const;

export interface ChangeLogEntry {
  id: string;
  action: (typeof FAMILY_ACTIONS)[number];
  at: string;
  /** Who did it. `isMe` lets the client say "You" instead of a name. */
  by: { name: string | null; isMe: boolean };
  /** The other person the change is about — an educator, a co-guardian. */
  subject: string | null;
  /** The few payload fields the copy needs; never the raw payload. */
  details: {
    type?: string;
    documentVersion?: string;
    validUntil?: string;
    grade?: number;
    via?: string;
  };
}

/**
 * The change log is the audit log, filtered to one child and to the actions a
 * family should see — not a second table that could disagree with it
 * (task.md § 1.15: everything that changes access, consent or ownership is in
 * `audit_log` anyway).
 *
 * Names are resolved at read time from the ids in the payload, so the log
 * itself never stores a name, and a person who renames themselves is shown by
 * their current name everywhere.
 */
@Injectable()
export class ChangelogService {
  constructor(private readonly db: DbService) {}

  async forChild(
    actor: Actor,
    childId: string,
    opts: { limit: number; before?: string },
  ): Promise<{ entries: ChangeLogEntry[]; total: number; nextCursor: string | null }> {
    const rows = await this.db.query<{
      id: string;
      action: ChangeLogEntry['action'];
      created_at: Date;
      person_id: string | null;
      by_name: string | null;
      subject_name: string | null;
      payload: Record<string, unknown>;
    }>(
      `SELECT a.id::text, a.action, a.created_at, a.person_id,
              p.full_name AS by_name,
              sp.full_name AS subject_name,
              a.payload
         FROM audit_log a
    LEFT JOIN person p  ON p.id = a.person_id
    LEFT JOIN person sp ON sp.id = COALESCE(
                 NULLIF(a.payload->>'educatorPersonId', ''),
                 NULLIF(a.payload->>'guardianPersonId', ''),
                 NULLIF(a.payload->>'toPersonId', ''))::uuid
        WHERE a.payload->>'childId' = $1
          AND a.action = ANY($2::text[])
          AND ($3::bigint IS NULL OR a.id < $3::bigint)
        ORDER BY a.id DESC
        LIMIT $4`,
      [childId, FAMILY_ACTIONS, opts.before ?? null, opts.limit + 1],
    );

    const total = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE payload->>'childId' = $1 AND action = ANY($2::text[])`,
      [childId, FAMILY_ACTIONS],
    );

    const page = rows.slice(0, opts.limit);
    return {
      entries: page.map((r) => ({
        id: r.id,
        action: r.action,
        at: new Date(r.created_at).toISOString(),
        by: { name: r.by_name, isMe: r.person_id === actor.personId },
        subject: r.subject_name,
        details: pick(r.payload),
      })),
      total: total?.n ?? 0,
      nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
    };
  }
}

function pick(payload: Record<string, unknown>): ChangeLogEntry['details'] {
  const out: ChangeLogEntry['details'] = {};
  if (typeof payload.type === 'string') out.type = payload.type;
  if (typeof payload.documentVersion === 'string') out.documentVersion = payload.documentVersion;
  if (typeof payload.validUntil === 'string') out.validUntil = payload.validUntil;
  if (typeof payload.grade === 'number') out.grade = payload.grade;
  if (typeof payload.via === 'string') out.via = payload.via;
  return out;
}
