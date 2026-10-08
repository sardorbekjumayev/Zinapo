import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { Actor } from '../actor';
import { Permission, hasPermission, permissionsOf } from '../staff-permissions';

/**
 * Staff authorisation. The role → permission map is a constant
 * (`staff-permissions.ts`); this class answers the questions that also need a
 * row from the database.
 */
@Injectable()
export class StaffPolicy {
  constructor(private readonly db: DbService) {}

  can(actor: Actor, permission: Permission): boolean {
    return hasPermission(actor.staffRoles, permission);
  }

  permissions(actor: Actor): Permission[] {
    return [...permissionsOf(actor.staffRoles)];
  }

  /**
   * `item_author` sees only their own items (task.md § 2.1). A `bank_editor` or
   * `item_reviewer` sees the whole bank.
   */
  async canReadItem(actor: Actor, itemId: string): Promise<boolean> {
    if (this.can(actor, 'item.read.all')) return true;
    if (!this.can(actor, 'item.read.own')) return false;

    const row = await this.db.one<{ ok: boolean }>(
      `SELECT true AS ok FROM item WHERE id = $1 AND author_person_id = $2`,
      [itemId, actor.personId],
    );
    return !!row;
  }

  /** An author edits only their own drafts; a frozen version is immutable (INV-09). */
  async canEditItem(actor: Actor, itemId: string): Promise<boolean> {
    if (this.can(actor, 'item.approve')) return true;
    if (!this.can(actor, 'item.create')) return false;

    const row = await this.db.one<{ ok: boolean }>(
      `SELECT true AS ok
         FROM item
        WHERE id = $1 AND author_person_id = $2 AND status IN ('draft', 'rejected')`,
      [itemId, actor.personId],
    );
    return !!row;
  }

  /**
   * Nobody reviews their own item (task.md § 8.5). The database enforces it too
   * (`item_review_no_self`); this is the check that produces a clean 403 instead
   * of a 500.
   */
  async canReviewItemVersion(actor: Actor, itemVersionId: string): Promise<boolean> {
    if (!this.can(actor, 'item.review')) return false;

    const row = await this.db.one<{ own: boolean }>(
      `SELECT (i.author_person_id = $2 OR iv.created_by = $2) AS own
         FROM item_version iv
         JOIN item i ON i.id = iv.item_id
        WHERE iv.id = $1`,
      [itemVersionId, actor.personId],
    );
    return !!row && !row.own;
  }

  /** A proctor is assigned to specific venues, and never to one with their own child. */
  async canProctorVenue(actor: Actor, venueId: string): Promise<boolean> {
    if (!this.can(actor, 'final.proctor')) return false;

    const row = await this.db.one<{ ok: boolean }>(
      `SELECT true AS ok
         FROM proctor_assignment pa
        WHERE pa.venue_id = $1
          AND pa.person_id = $2
          AND NOT EXISTS (
                SELECT 1
                  FROM olympiad_entry oe
                  JOIN guardianship g ON g.child_id = oe.child_id AND g.revoked_at IS NULL
                 WHERE oe.venue_id = pa.venue_id AND g.person_id = pa.person_id)`,
      [venueId, actor.personId],
    );
    return !!row;
  }
}
