import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Actor } from '../actor';

/**
 * What the caller wants to do with the child. The scope decides which
 * relationship is enough — not the role the person happens to hold elsewhere.
 */
export type ChildScope =
  /** The full parent report, including a percentile band for grades 3–4. */
  | 'parent_report'
  /** The educator view: gain, clusters, misconceptions. Never a percentile. */
  | 'educator_view'
  /** Change the child: name, enrolment, consents, access, ownership. */
  | 'manage'
  /**
   * Read the family-side screens — who can see, consents, the change log.
   * Any live guardian: a co-guardian sees them read-only (task.md § 8.2).
   * Never an educator, even for their own child: that path is `parent_report`.
   */
  | 'family_view'
  /** Start a monitoring or practice session in kid mode. */
  | 'launch_session'
  /** Read practice results — "how many solved", nothing else. */
  | 'practice_result';

export interface ChildAccessResult {
  childId: string;
  /** Which relationship authorised this, for audit and for shaping the reply. */
  via: 'owner' | 'co_guardian' | 'educator_link' | 'proctor';
  /**
   * task.md § 3: an educator may see a percentile band ONLY for their own
   * child. Always true for a parent, and for an educator only when the link
   * row says `is_own_child`.
   */
  canSeePercentile: boolean;
}

/**
 * Child access is decided by SQL, never by loading arrays of ids into memory
 * (task.md § 4). Each check is one EXISTS against the relationship tables, so
 * the database stays the single source of truth and a stale cache cannot widen
 * access.
 *
 * Every denial returns null; the caller turns that into a 404, because telling
 * a stranger "this child exists but you may not see them" is itself a leak.
 */
@Injectable()
export class ChildPolicy {
  constructor(private readonly db: DbService) {}

  async check(actor: Actor, childId: string, scope: ChildScope): Promise<ChildAccessResult | null> {
    switch (scope) {
      case 'manage':
        // Only the owner. A co-guardian is view-only (task.md § 8.2).
        return this.asGuardian(actor, childId, 'owner');

      case 'family_view':
        return this.asGuardian(actor, childId, 'any');

      case 'parent_report': {
        const guardian = await this.asGuardian(actor, childId, 'any');
        if (guardian) return guardian;
        // An educator reaches the parent report only for their own child.
        const link = await this.asEducator(actor, childId);
        return link?.canSeePercentile ? link : null;
      }

      case 'launch_session': {
        const guardian = await this.asGuardian(actor, childId, 'any');
        if (guardian) return guardian;
        // An educator may launch in the office, but only for a linked child.
        return this.asEducator(actor, childId);
      }

      case 'practice_result': {
        const guardian = await this.asGuardian(actor, childId, 'any');
        if (guardian) return guardian;
        return this.asEducator(actor, childId);
      }

      case 'educator_view':
        // Parents do not get the educator view; it is a different read model.
        return this.asEducator(actor, childId);
    }
  }

  /** Owner or co-guardian, straight off `guardianship`. */
  private async asGuardian(
    actor: Actor,
    childId: string,
    want: 'owner' | 'any',
  ): Promise<ChildAccessResult | null> {
    const row = await this.db.one<{ role: 'owner' | 'co_guardian' }>(
      `SELECT g.role
         FROM guardianship g
        WHERE g.child_id = $1
          AND g.person_id = $2
          AND g.revoked_at IS NULL
          AND ($3 = 'any' OR g.role = 'owner')
        LIMIT 1`,
      [childId, actor.personId, want],
    );
    if (!row) return null;
    return { childId, via: row.role, canSeePercentile: true };
  }

  /**
   * INV-15: the educator path goes through `v_educator_visible_child` and
   * nothing else. The view already requires an approved profile, an active
   * link, and a window that contains `now()`. Group membership is not part of
   * it, so a child in the educator's group but without a link is invisible.
   */
  private async asEducator(actor: Actor, childId: string): Promise<ChildAccessResult | null> {
    const row = await this.db.one<{ is_own_child: boolean }>(
      `SELECT v.is_own_child
         FROM v_educator_visible_child v
        WHERE v.child_id = $1 AND v.educator_person_id = $2
        LIMIT 1`,
      [childId, actor.personId],
    );
    if (!row) return null;
    return { childId, via: 'educator_link', canSeePercentile: row.is_own_child };
  }

  /**
   * A proctor runs a final for the children on their venue roster.
   * task.md § 2.1: never a final where their own child competes — the roster
   * query excludes it, and `proctor_assignment_not_own` enforces it in the DB.
   */
  async checkProctor(actor: Actor, childId: string, venueId: string): Promise<ChildAccessResult | null> {
    if (!actor.staffRoles.includes('proctor')) return null;

    const row = await this.db.one<{ ok: boolean }>(
      `SELECT true AS ok
         FROM proctor_assignment pa
         JOIN olympiad_entry oe ON oe.venue_id = pa.venue_id
        WHERE pa.venue_id = $1
          AND pa.person_id = $2
          AND oe.child_id = $3
          AND NOT EXISTS (
                SELECT 1 FROM guardianship g
                 WHERE g.child_id = oe.child_id
                   AND g.person_id = pa.person_id
                   AND g.revoked_at IS NULL)
        LIMIT 1`,
      [venueId, actor.personId, childId],
    );
    if (!row) return null;
    // A proctor runs the session; they never read a report.
    return { childId, via: 'proctor', canSeePercentile: false };
  }
}
